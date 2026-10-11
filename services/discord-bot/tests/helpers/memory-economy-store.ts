import { voiceRewardKey } from "../../src/economy/ledger-keys.js";
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
} from "../../src/economy/store.js";

/**
 * In-memory EconomyStore with the same rules as the PostgreSQL one: unique
 * idempotency keys, no negative balances, one active game per member, and
 * conditional (versioned) game updates. Every method body runs without
 * awaiting, so each call is atomic, like a database transaction.
 *
 * NOTE: this proves the rules and the service logic. It cannot prove
 * PostgreSQL's row locking; that needs a real database.
 */
export class MemoryEconomyStore implements EconomyStore {
  readonly balances = new Map<string, number>();
  readonly ledger: Array<{ userId: string; amount: number; kind: string; key: string }> = [];
  readonly keys = new Set<string>();
  readonly claims = new Map<string, Date>();
  readonly checkpoints = new Map<string, number>();
  readonly games = new Map<string, GameRecord>();
  readonly settings = new Map<string, string>();

  constructor(private readonly startingBalance = 0) {}

  /** Test helper: puts money in a wallet through the ledger. */
  seed(userId: string, amount: number): void {
    this.apply(userId, amount, "seed", `seed:${userId}:${this.ledger.length}`);
  }

  protected wallet(userId: string): number {
    if (!this.balances.has(userId)) {
      this.balances.set(userId, this.startingBalance);
    }
    return this.balances.get(userId) as number;
  }

  protected apply(
    userId: string,
    delta: number,
    kind: string,
    key: string,
  ): "applied" | "duplicate" | "insufficient" {
    const balance = this.wallet(userId);
    if (this.keys.has(key)) {
      return "duplicate";
    }
    if (balance + delta < 0) {
      return "insufficient";
    }
    if (delta !== 0) {
      this.balances.set(userId, balance + delta);
      this.ledger.push({ userId, amount: delta, kind, key });
    }
    this.keys.add(key);
    return "applied";
  }

  async getBalance(userId: string): Promise<number> {
    return this.balances.get(userId) ?? this.startingBalance;
  }

  async credit(input: {
    userId: string;
    amount: number;
    kind: string;
    idempotencyKey: string;
  }): Promise<CreditResult> {
    const status = this.apply(input.userId, input.amount, input.kind, input.idempotencyKey);
    return { applied: status === "applied", balance: this.wallet(input.userId) };
  }

  async debit(input: {
    userId: string;
    amount: number;
    kind: string;
    idempotencyKey: string;
  }): Promise<DebitResult> {
    const status = this.apply(input.userId, -input.amount, input.kind, input.idempotencyKey);
    const balance = this.wallet(input.userId);
    if (status === "applied") {
      return { ok: true, balance };
    }
    return { ok: false, reason: status === "duplicate" ? "duplicate" : "insufficient_funds", balance };
  }

  async transfer(input: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    tax: number;
    idempotencyKey: string;
  }): Promise<TransferResult> {
    if (this.keys.has(`${input.idempotencyKey}:out`)) {
      return { ok: false, reason: "duplicate", fromBalance: this.wallet(input.fromUserId) };
    }
    if (this.wallet(input.fromUserId) < input.amount) {
      return { ok: false, reason: "insufficient_funds", fromBalance: this.wallet(input.fromUserId) };
    }
    this.apply(input.fromUserId, -input.amount, "transfer_out", `${input.idempotencyKey}:out`);
    this.apply(input.toUserId, input.amount - input.tax, "transfer_in", `${input.idempotencyKey}:in`);
    return { ok: true, fromBalance: this.wallet(input.fromUserId), toBalance: this.wallet(input.toUserId) };
  }

  async claimCooldownReward(input: {
    userId: string;
    claimType: ClaimType;
    amount: number;
    cooldownMs: number;
    now: Date;
  }): Promise<ClaimResult> {
    const claimKey = `${input.userId}:${input.claimType}`;
    const last = this.claims.get(claimKey);
    if (last) {
      const next = new Date(last.getTime() + input.cooldownMs);
      if (next.getTime() > input.now.getTime()) {
        return { ok: false, nextClaimAt: next };
      }
    }
    this.claims.set(claimKey, input.now);
    this.apply(input.userId, input.amount, input.claimType, `${input.claimType}:${input.userId}:${input.now.getTime()}`);
    return {
      ok: true,
      balance: this.wallet(input.userId),
      nextClaimAt: new Date(input.now.getTime() + input.cooldownMs),
    };
  }

  async settleInstantGame(input: {
    userId: string;
    kind: string;
    wager: number;
    payout: number;
    idempotencyKey: string;
  }): Promise<InstantGameResult> {
    const bet = this.apply(input.userId, -input.wager, `${input.kind}_bet`, `${input.idempotencyKey}:bet`);
    if (bet === "duplicate") {
      return { ok: false, reason: "duplicate", balance: this.wallet(input.userId) };
    }
    if (bet === "insufficient") {
      return { ok: false, reason: "insufficient_funds", balance: this.wallet(input.userId) };
    }
    if (input.payout > 0) {
      this.apply(input.userId, input.payout, `${input.kind}_payout`, `${input.idempotencyKey}:payout`);
    }
    return { ok: true, balance: this.wallet(input.userId) };
  }

  async startGame(input: {
    id: string;
    userId: string;
    gameType: GameType;
    wager: number;
    state: unknown;
    channelId: string | null;
    now?: Date;
    expiresAt: Date;
  }): Promise<StartGameResult> {
    for (const game of this.games.values()) {
      if (game.discordUserId === input.userId && game.status === "active") {
        return { ok: false, reason: "active_game_exists", balance: this.wallet(input.userId) };
      }
    }
    const bet = this.apply(input.userId, -input.wager, `${input.gameType}_bet`, `game:${input.id}:bet`);
    if (bet !== "applied") {
      return { ok: false, reason: "insufficient_funds", balance: this.wallet(input.userId) };
    }
    this.games.set(input.id, {
      id: input.id,
      discordUserId: input.userId,
      gameType: input.gameType,
      wager: input.wager,
      state: structuredClone(input.state),
      version: 0,
      status: "active",
      outcome: null,
      payout: null,
      channelId: input.channelId,
      expiresAt: input.expiresAt,
    });
    return { ok: true, balance: this.wallet(input.userId) };
  }

  async getGame(id: string): Promise<GameRecord | null> {
    const game = this.games.get(id);
    return game ? structuredClone(game) : null;
  }

  async saveGameState(input: {
    id: string;
    expectedVersion: number;
    state: unknown;
    expiresAt: Date;
  }): Promise<boolean> {
    const game = this.games.get(input.id);
    if (!game || game.status !== "active" || game.version !== input.expectedVersion) {
      return false;
    }
    game.state = structuredClone(input.state);
    game.version += 1;
    game.expiresAt = input.expiresAt;
    return true;
  }

  async settleGame(input: {
    id: string;
    expectedVersion: number;
    state: unknown;
    payout: number;
    outcome: string;
  }): Promise<SettleResult> {
    const game = this.games.get(input.id);
    if (!game || game.status !== "active" || game.version !== input.expectedVersion) {
      return { settled: false, balance: game ? this.wallet(game.discordUserId) : 0 };
    }
    game.status = "settled";
    game.state = structuredClone(input.state);
    game.version += 1;
    game.outcome = input.outcome;
    game.payout = input.payout;
    if (input.payout > 0) {
      this.apply(game.discordUserId, input.payout, `${game.gameType}_payout`, `game:${game.id}:payout`);
    }
    return { settled: true, balance: this.wallet(game.discordUserId) };
  }

  async listExpiredGames(now: Date, limit: number): Promise<GameRecord[]> {
    return [...this.games.values()]
      .filter((game) => game.status === "active" && game.expiresAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map((game) => structuredClone(game));
  }

  async processVoiceReward(input: {
    userId: string;
    totalSeconds: number;
    intervalSeconds: number;
    amountPerInterval: number;
    season?: number;
  }): Promise<VoiceRewardResult> {
    const credited = this.checkpoints.get(input.userId) ?? 0;
    if (input.totalSeconds < credited) {
      this.checkpoints.set(input.userId, input.totalSeconds);
      return { intervals: 0, awarded: 0 };
    }
    const intervals = Math.floor((input.totalSeconds - credited) / input.intervalSeconds);
    if (intervals < 1) {
      this.checkpoints.set(input.userId, credited);
      return { intervals: 0, awarded: 0 };
    }
    const checkpoint = credited + intervals * input.intervalSeconds;
    const awarded = intervals * input.amountPerInterval;
    const status = this.apply(input.userId, awarded, "voice_reward", voiceRewardKey(input.userId, checkpoint, input.season));
    if (status !== "applied") {
      return { intervals: 0, awarded: 0 };
    }
    this.checkpoints.set(input.userId, checkpoint);
    return { intervals, awarded };
  }

  async getRichest(limit: number, offset: number) {
    return [...this.balances.entries()]
      .filter(([, balance]) => balance > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(offset, offset + limit)
      .map(([discordUserId, balance]) => ({ discordUserId, balance }));
  }

  async countWallets(): Promise<number> {
    return [...this.balances.values()].filter((balance) => balance > 0).length;
  }

  async getWalletRank(userId: string): Promise<number | null> {
    const balance = this.balances.get(userId) ?? 0;
    if (balance <= 0) {
      return null;
    }
    const ahead = [...this.balances.entries()].filter(
      ([id, other]) => other > balance || (other === balance && id.localeCompare(userId) < 0),
    ).length;
    return ahead + 1;
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    if (value === null) {
      this.settings.delete(key);
    } else {
      this.settings.set(key, value);
    }
  }
}
