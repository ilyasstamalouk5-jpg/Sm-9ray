import { db } from "@workspace/db";
import {
  discordBotCasinoGames,
  discordBotEconomyClaims,
  discordBotEconomySettings,
  discordBotVoiceRewardCheckpoints,
  discordBotWalletTransactions,
  discordBotWallets,
} from "@workspace/db";
import { and, asc, desc, eq, gt, lt, lte, or, sql } from "drizzle-orm";
import type {
  ClaimResult,
  ClaimType,
  CreditResult,
  EconomyStore,
  GameRecord,
  GameType,
  DebitResult,
  InstantGameResult,
  SettleResult,
  StartGameResult,
  TransferResult,
  VoiceRewardResult,
} from "./store.js";
import { voiceRewardKey } from "./ledger-keys.js";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type DeltaResult =
  | { status: "applied"; balance: number }
  | { status: "duplicate"; balance: number }
  | { status: "insufficient"; balance: number };

function assertAmount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class DrizzleEconomyStore implements EconomyStore {
  constructor(private readonly startingBalance: number) {}

  /**
   * Creates the wallet if needed, then locks its row for the rest of the
   * transaction. Every balance change goes through this lock, so two requests
   * for the same member are processed one after the other.
   */
  protected async lockWallet(
    tx: DbTransaction,
    userId: string,
  ): Promise<number> {
    const inserted = await tx
      .insert(discordBotWallets)
      .values({ discordUserId: userId, balance: this.startingBalance })
      .onConflictDoNothing({ target: discordBotWallets.discordUserId })
      .returning({ balance: discordBotWallets.balance });

    if (inserted.length > 0 && this.startingBalance > 0) {
      await tx.insert(discordBotWalletTransactions).values({
        discordUserId: userId,
        amount: this.startingBalance,
        balanceAfter: this.startingBalance,
        kind: "starting_balance",
        idempotencyKey: `starting:${userId}`,
      });
    }

    const [row] = await tx
      .select({ balance: discordBotWallets.balance })
      .from(discordBotWallets)
      .where(eq(discordBotWallets.discordUserId, userId))
      .for("update")
      .limit(1);
    if (!row) {
      throw new Error("Wallet row was not found after creation.");
    }
    return row.balance;
  }

  /** Applies a signed change to a wallet that is already locked. */
  protected async applyDelta(
    tx: DbTransaction,
    userId: string,
    currentBalance: number,
    delta: number,
    kind: string,
    idempotencyKey: string,
    note?: string,
  ): Promise<DeltaResult> {
    const [existing] = await tx
      .select({ id: discordBotWalletTransactions.id })
      .from(discordBotWalletTransactions)
      .where(eq(discordBotWalletTransactions.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) {
      return { status: "duplicate", balance: currentBalance };
    }

    const next = currentBalance + delta;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError("Wallet balance is out of range.");
    }
    if (next < 0) {
      return { status: "insufficient", balance: currentBalance };
    }
    if (delta === 0) {
      return { status: "applied", balance: currentBalance };
    }

    await tx
      .update(discordBotWallets)
      .set({ balance: next, updatedAt: new Date() })
      .where(eq(discordBotWallets.discordUserId, userId));
    await tx.insert(discordBotWalletTransactions).values({
      discordUserId: userId,
      amount: delta,
      balanceAfter: next,
      kind,
      idempotencyKey,
      note: note ?? null,
    });
    return { status: "applied", balance: next };
  }

  async getBalance(userId: string): Promise<number> {
    const [row] = await db
      .select({ balance: discordBotWallets.balance })
      .from(discordBotWallets)
      .where(eq(discordBotWallets.discordUserId, userId))
      .limit(1);
    return row?.balance ?? this.startingBalance;
  }

  async credit(input: {
    userId: string;
    amount: number;
    kind: string;
    idempotencyKey: string;
    note?: string;
  }): Promise<CreditResult> {
    assertAmount(input.amount, "amount");
    return db.transaction(async (tx) => {
      const balance = await this.lockWallet(tx, input.userId);
      const result = await this.applyDelta(
        tx,
        input.userId,
        balance,
        input.amount,
        input.kind,
        input.idempotencyKey,
        input.note,
      );
      return { applied: result.status === "applied", balance: result.balance };
    });
  }

  async debit(input: {
    userId: string;
    amount: number;
    kind: string;
    idempotencyKey: string;
    note?: string;
  }): Promise<DebitResult> {
    assertAmount(input.amount, "amount");
    return db.transaction(async (tx) => {
      const balance = await this.lockWallet(tx, input.userId);
      const result = await this.applyDelta(
        tx,
        input.userId,
        balance,
        -input.amount,
        input.kind,
        input.idempotencyKey,
        input.note,
      );
      if (result.status === "applied") {
        return { ok: true, balance: result.balance } as const;
      }
      return {
        ok: false,
        reason: result.status === "duplicate" ? "duplicate" : "insufficient_funds",
        balance: result.balance,
      } as const;
    });
  }

  async transfer(input: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    tax: number;
    idempotencyKey: string;
  }): Promise<TransferResult> {
    assertAmount(input.amount, "amount");
    assertAmount(input.tax, "tax");
    if (input.fromUserId === input.toUserId || input.tax >= input.amount) {
      throw new RangeError("Invalid transfer.");
    }
    const received = input.amount - input.tax;
    return db.transaction(async (tx) => {
      // Lock both wallets in a fixed order so two opposite transfers
      // (A pays B while B pays A) can never wait on each other forever.
      const balances = new Map<string, number>();
      for (const userId of [input.fromUserId, input.toUserId].sort()) {
        balances.set(userId, await this.lockWallet(tx, userId));
      }
      const out = await this.applyDelta(
        tx,
        input.fromUserId,
        balances.get(input.fromUserId) as number,
        -input.amount,
        "transfer_out",
        `${input.idempotencyKey}:out`,
        `Sent to ${input.toUserId} (tax ${input.tax})`,
      );
      if (out.status !== "applied") {
        return {
          ok: false,
          reason: out.status === "duplicate" ? "duplicate" : "insufficient_funds",
          fromBalance: out.balance,
        } as const;
      }
      const into = await this.applyDelta(
        tx,
        input.toUserId,
        balances.get(input.toUserId) as number,
        received,
        "transfer_in",
        `${input.idempotencyKey}:in`,
        `Received from ${input.fromUserId} (tax ${input.tax})`,
      );
      if (into.status !== "applied") {
        // Rolls the whole transaction back, including the sender's debit.
        throw new Error(`Transfer credit was not applied (${into.status}).`);
      }
      return { ok: true, fromBalance: out.balance, toBalance: into.balance } as const;
    });
  }

  async claimCooldownReward(input: {
    userId: string;
    claimType: ClaimType;
    amount: number;
    cooldownMs: number;
    now: Date;
  }): Promise<ClaimResult> {
    assertAmount(input.amount, "amount");
    return db.transaction(async (tx) => {
      const balance = await this.lockWallet(tx, input.userId);
      const [claim] = await tx
        .select()
        .from(discordBotEconomyClaims)
        .where(
          and(
            eq(discordBotEconomyClaims.discordUserId, input.userId),
            eq(discordBotEconomyClaims.claimType, input.claimType),
          ),
        )
        .limit(1);

      if (claim) {
        const nextAt = new Date(claim.lastClaimedAt.getTime() + input.cooldownMs);
        if (nextAt.getTime() > input.now.getTime()) {
          return { ok: false, nextClaimAt: nextAt } as const;
        }
      }

      await tx
        .insert(discordBotEconomyClaims)
        .values({
          discordUserId: input.userId,
          claimType: input.claimType,
          lastClaimedAt: input.now,
          claimCount: 1,
        })
        .onConflictDoUpdate({
          target: [
            discordBotEconomyClaims.discordUserId,
            discordBotEconomyClaims.claimType,
          ],
          set: {
            lastClaimedAt: input.now,
            claimCount: sql`${discordBotEconomyClaims.claimCount} + 1`,
          },
        });

      const result = await this.applyDelta(
        tx,
        input.userId,
        balance,
        input.amount,
        input.claimType,
        `${input.claimType}:${input.userId}:${input.now.getTime()}`,
      );
      return {
        ok: true,
        balance: result.balance,
        nextClaimAt: new Date(input.now.getTime() + input.cooldownMs),
      } as const;
    });
  }

  async settleInstantGame(input: {
    userId: string;
    kind: string;
    wager: number;
    payout: number;
    idempotencyKey: string;
  }): Promise<InstantGameResult> {
    assertAmount(input.wager, "wager");
    assertAmount(input.payout, "payout");
    return db.transaction(async (tx) => {
      const balance = await this.lockWallet(tx, input.userId);
      const bet = await this.applyDelta(
        tx,
        input.userId,
        balance,
        -input.wager,
        `${input.kind}_bet`,
        `${input.idempotencyKey}:bet`,
      );
      if (bet.status === "duplicate") {
        return { ok: false, reason: "duplicate", balance: bet.balance } as const;
      }
      if (bet.status === "insufficient") {
        return { ok: false, reason: "insufficient_funds", balance: bet.balance } as const;
      }
      let finalBalance = bet.balance;
      if (input.payout > 0) {
        const win = await this.applyDelta(
          tx,
          input.userId,
          bet.balance,
          input.payout,
          `${input.kind}_payout`,
          `${input.idempotencyKey}:payout`,
        );
        finalBalance = win.balance;
      }
      return { ok: true, balance: finalBalance } as const;
    });
  }

  private toGameRecord(row: typeof discordBotCasinoGames.$inferSelect): GameRecord {
    return {
      id: row.id,
      discordUserId: row.discordUserId,
      gameType: row.gameType as GameType,
      wager: row.wager,
      state: row.state,
      version: row.version,
      status: row.status as "active" | "settled",
      outcome: row.outcome,
      payout: row.payout,
      channelId: row.channelId,
      expiresAt: row.expiresAt,
    };
  }

  async startGame(input: {
    id: string;
    userId: string;
    gameType: GameType;
    wager: number;
    state: unknown;
    channelId: string | null;
    now: Date;
    expiresAt: Date;
  }): Promise<StartGameResult> {
    assertAmount(input.wager, "wager");
    try {
      return await db.transaction(async (tx) => {
        const balance = await this.lockWallet(tx, input.userId);
        const [active] = await tx
          .select({ id: discordBotCasinoGames.id })
          .from(discordBotCasinoGames)
          .where(
            and(
              eq(discordBotCasinoGames.discordUserId, input.userId),
              eq(discordBotCasinoGames.status, "active"),
            ),
          )
          .limit(1);
        if (active) {
          return { ok: false, reason: "active_game_exists", balance } as const;
        }

        const bet = await this.applyDelta(
          tx,
          input.userId,
          balance,
          -input.wager,
          `${input.gameType}_bet`,
          `game:${input.id}:bet`,
        );
        if (bet.status !== "applied") {
          return { ok: false, reason: "insufficient_funds", balance: bet.balance } as const;
        }

        await tx.insert(discordBotCasinoGames).values({
          id: input.id,
          discordUserId: input.userId,
          gameType: input.gameType,
          wager: input.wager,
          state: input.state,
          channelId: input.channelId,
          createdAt: input.now,
          updatedAt: input.now,
          expiresAt: input.expiresAt,
        });
        return { ok: true, balance: bet.balance } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The one-active-game-per-member index caught a simultaneous start.
        return {
          ok: false,
          reason: "active_game_exists",
          balance: await this.getBalance(input.userId),
        };
      }
      throw error;
    }
  }

  async getGame(id: string): Promise<GameRecord | null> {
    const [row] = await db
      .select()
      .from(discordBotCasinoGames)
      .where(eq(discordBotCasinoGames.id, id))
      .limit(1);
    return row ? this.toGameRecord(row) : null;
  }

  async saveGameState(input: {
    id: string;
    expectedVersion: number;
    state: unknown;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    const rows = await db
      .update(discordBotCasinoGames)
      .set({
        state: input.state,
        version: input.expectedVersion + 1,
        updatedAt: input.now,
        expiresAt: input.expiresAt,
      })
      .where(
        and(
          eq(discordBotCasinoGames.id, input.id),
          eq(discordBotCasinoGames.status, "active"),
          eq(discordBotCasinoGames.version, input.expectedVersion),
        ),
      )
      .returning({ id: discordBotCasinoGames.id });
    return rows.length > 0;
  }

  async settleGame(input: {
    id: string;
    expectedVersion: number;
    state: unknown;
    payout: number;
    outcome: string;
    now: Date;
  }): Promise<SettleResult> {
    assertAmount(input.payout, "payout");
    return db.transaction(async (tx) => {
      // The conditional UPDATE is what guarantees a game settles only once:
      // whoever flips status from 'active' first wins, everyone else gets zero rows.
      const rows = await tx
        .update(discordBotCasinoGames)
        .set({
          status: "settled",
          state: input.state,
          version: input.expectedVersion + 1,
          outcome: input.outcome,
          payout: input.payout,
          updatedAt: input.now,
          settledAt: input.now,
        })
        .where(
          and(
            eq(discordBotCasinoGames.id, input.id),
            eq(discordBotCasinoGames.status, "active"),
            eq(discordBotCasinoGames.version, input.expectedVersion),
          ),
        )
        .returning();
      const game = rows[0];
      if (!game) {
        const [walletRow] = await tx
          .select({ discordUserId: discordBotCasinoGames.discordUserId })
          .from(discordBotCasinoGames)
          .where(eq(discordBotCasinoGames.id, input.id))
          .limit(1);
        const balance = walletRow ? await this.getBalance(walletRow.discordUserId) : 0;
        return { settled: false, balance };
      }

      const balance = await this.lockWallet(tx, game.discordUserId);
      if (input.payout === 0) {
        return { settled: true, balance };
      }
      const result = await this.applyDelta(
        tx,
        game.discordUserId,
        balance,
        input.payout,
        `${game.gameType}_payout`,
        `game:${game.id}:payout`,
      );
      return { settled: true, balance: result.balance };
    });
  }

  async listExpiredGames(now: Date, limit: number): Promise<GameRecord[]> {
    const rows = await db
      .select()
      .from(discordBotCasinoGames)
      .where(
        and(
          eq(discordBotCasinoGames.status, "active"),
          lte(discordBotCasinoGames.expiresAt, now),
        ),
      )
      .orderBy(asc(discordBotCasinoGames.expiresAt))
      .limit(limit);
    return rows.map((row) => this.toGameRecord(row));
  }

  async processVoiceReward(input: {
    userId: string;
    totalSeconds: number;
    intervalSeconds: number;
    amountPerInterval: number;
    season?: number;
  }): Promise<VoiceRewardResult> {
    assertAmount(input.totalSeconds, "totalSeconds");
    if (input.intervalSeconds < 1 || input.amountPerInterval < 1) {
      return { intervals: 0, awarded: 0 };
    }

    return db.transaction(async (tx) => {
      await tx
        .insert(discordBotVoiceRewardCheckpoints)
        .values({ discordUserId: input.userId })
        .onConflictDoNothing({
          target: discordBotVoiceRewardCheckpoints.discordUserId,
        });
      const [checkpoint] = await tx
        .select()
        .from(discordBotVoiceRewardCheckpoints)
        .where(eq(discordBotVoiceRewardCheckpoints.discordUserId, input.userId))
        .for("update")
        .limit(1);
      if (!checkpoint) {
        throw new Error("Voice reward checkpoint was not found.");
      }

      if (input.totalSeconds < checkpoint.creditedSeconds) {
        // An admin lowered this member's voice time. Move the checkpoint down
        // so they can earn normally again; nothing is taken away.
        await tx
          .update(discordBotVoiceRewardCheckpoints)
          .set({ creditedSeconds: input.totalSeconds, updatedAt: new Date() })
          .where(eq(discordBotVoiceRewardCheckpoints.discordUserId, input.userId));
        return { intervals: 0, awarded: 0 };
      }

      const intervals = Math.floor(
        (input.totalSeconds - checkpoint.creditedSeconds) / input.intervalSeconds,
      );
      if (intervals < 1) {
        return { intervals: 0, awarded: 0 };
      }

      const awarded = intervals * input.amountPerInterval;
      const newCheckpoint = checkpoint.creditedSeconds + intervals * input.intervalSeconds;
      const balance = await this.lockWallet(tx, input.userId);
      const result = await this.applyDelta(
        tx,
        input.userId,
        balance,
        awarded,
        "voice_reward",
        voiceRewardKey(input.userId, newCheckpoint, input.season),
        `${intervals} voice interval(s)`,
      );
      if (result.status !== "applied") {
        return { intervals: 0, awarded: 0 };
      }
      await tx
        .update(discordBotVoiceRewardCheckpoints)
        .set({
          creditedSeconds: newCheckpoint,
          totalPaid: sql`${discordBotVoiceRewardCheckpoints.totalPaid} + ${awarded}`,
          updatedAt: new Date(),
        })
        .where(eq(discordBotVoiceRewardCheckpoints.discordUserId, input.userId));
      return { intervals, awarded };
    });
  }

  async getRichest(
    limit: number,
    offset: number,
  ): Promise<Array<{ discordUserId: string; balance: number }>> {
    return db
      .select({
        discordUserId: discordBotWallets.discordUserId,
        balance: discordBotWallets.balance,
      })
      .from(discordBotWallets)
      .where(gt(discordBotWallets.balance, 0))
      .orderBy(desc(discordBotWallets.balance), asc(discordBotWallets.discordUserId))
      .limit(limit)
      .offset(offset);
  }

  async countWallets(): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`COUNT(*)::int`.mapWith(Number) })
      .from(discordBotWallets)
      .where(gt(discordBotWallets.balance, 0));
    return row?.total ?? 0;
  }

  async getWalletRank(userId: string): Promise<number | null> {
    const [wallet] = await db
      .select({ balance: discordBotWallets.balance })
      .from(discordBotWallets)
      .where(eq(discordBotWallets.discordUserId, userId))
      .limit(1);
    if (!wallet || wallet.balance <= 0) {
      return null;
    }
    // Same order as getRichest: higher balance first, then the lower user id.
    const [row] = await db
      .select({ ahead: sql<number>`COUNT(*)::int`.mapWith(Number) })
      .from(discordBotWallets)
      .where(
        and(
          gt(discordBotWallets.balance, 0),
          or(
            gt(discordBotWallets.balance, wallet.balance),
            and(
              eq(discordBotWallets.balance, wallet.balance),
              lt(discordBotWallets.discordUserId, userId),
            ),
          ),
        ),
      );
    return (row?.ahead ?? 0) + 1;
  }

  async getSetting(key: string): Promise<string | null> {
    const [row] = await db
      .select({ value: discordBotEconomySettings.value })
      .from(discordBotEconomySettings)
      .where(eq(discordBotEconomySettings.key, key))
      .limit(1);
    return row?.value ?? null;
  }

  async setSetting(
    key: string,
    value: string | null,
    updatedBy: string,
  ): Promise<void> {
    if (value === null) {
      await db
        .delete(discordBotEconomySettings)
        .where(eq(discordBotEconomySettings.key, key));
      return;
    }
    await db
      .insert(discordBotEconomySettings)
      .values({ key, value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: discordBotEconomySettings.key,
        set: { value, updatedBy, updatedAt: new Date() },
      });
  }
}
