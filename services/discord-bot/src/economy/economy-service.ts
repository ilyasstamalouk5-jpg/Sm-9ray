import { randomUUID } from "node:crypto";
import {
  appleTowerMultiplier,
  appleTowerPayout,
  createAppleTowerState,
  pickApple,
  type AppleTowerState,
} from "./games/apple-tower.js";
import {
  blackjackPayout,
  handValue,
  hit,
  stand,
  startBlackjack,
  type BlackjackOutcome,
  type BlackjackState,
} from "./games/blackjack.js";
import {
  createMinesState,
  minesMultiplier,
  minesPayout,
  revealTile,
  type MinesState,
} from "./games/mines.js";
import type { EconomyConfig } from "./economy-config.js";
import { secureRandomInt, type RandomInt } from "./rng.js";
import type { ClaimType, EconomyStore, GameRecord } from "./store.js";

export type CoinSide = "heads" | "tails";

export type MinesView = {
  type: "mines";
  gameId: string;
  ownerId: string;
  wager: number;
  mineCount: number;
  revealed: number[];
  /** Only filled in once the game is over. */
  mines: number[] | null;
  ended: boolean;
  outcome: string | null;
  payout: number;
  cashoutValue: number;
  multiplier: number;
  balance: number | null;
};

export type AppleTowerView = {
  type: "appletower";
  gameId: string;
  ownerId: string;
  wager: number;
  levels: number;
  levelsCleared: number;
  picks: number[];
  /** Only filled in once the game is over. */
  safeApples: number[] | null;
  ended: boolean;
  outcome: string | null;
  payout: number;
  cashoutValue: number;
  multiplier: number;
  balance: number | null;
};

export type BlackjackView = {
  type: "blackjack";
  gameId: string;
  ownerId: string;
  wager: number;
  player: number[];
  dealer: number[];
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number | null;
  ended: boolean;
  outcome: BlackjackOutcome | "expired" | null;
  payout: number;
  balance: number | null;
};

export type GameView = MinesView | AppleTowerView | BlackjackView;

export type FailureReason =
  | "invalid_wager"
  | "insufficient_funds"
  | "active_game_exists"
  | "not_found"
  | "not_owner"
  | "already_settled"
  | "stale"
  | "expired"
  | "invalid_move"
  | "duplicate";

export type GameActionResult =
  | { ok: true; view: GameView }
  | { ok: false; reason: FailureReason; message: string };

export type CooldownResult =
  | { ok: true; amount: number; balance: number; nextClaimAt: Date }
  | { ok: false; nextClaimAt: Date };

export type CoinflipResult =
  | {
      ok: true;
      won: boolean;
      landed: CoinSide;
      choice: CoinSide;
      wager: number;
      payout: number;
      net: number;
      balance: number;
    }
  | { ok: false; reason: FailureReason; message: string };

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  invalid_wager: "That wager is not valid.",
  insufficient_funds: "You do not have enough Dirhams for that wager.",
  active_game_exists:
    "You already have a game in progress. Finish it (or cash out) before starting another.",
  not_found: "That game no longer exists.",
  not_owner: "This is not your game.",
  already_settled: "This game has already finished.",
  stale: "That action was already processed. Please use the latest buttons.",
  expired: "This game timed out and was settled automatically.",
  invalid_move: "That move is not available.",
  duplicate: "That request was already processed.",
};

function fail(reason: FailureReason, message?: string) {
  return { ok: false as const, reason, message: message ?? FAILURE_MESSAGES[reason] };
}

type EconomyServiceDeps = {
  store: EconomyStore;
  config: EconomyConfig;
  clock?: () => Date;
  rand?: RandomInt;
  newId?: () => string;
};

/** The most DH an admin can add to a wallet in one command. */
export const ADMIN_GIVE_MAX = 1_000_000_000;

export type AdminGiveResult =
  | { ok: true; amount: number; balance: number }
  | { ok: false; message: string };

export type AdminTakeResult = AdminGiveResult;

export type PayResult =
  | {
      ok: true;
      amount: number;
      tax: number;
      received: number;
      fromBalance: number;
      toBalance: number;
    }
  | { ok: false; message: string };

export class EconomyService {
  readonly store: EconomyStore;
  readonly config: EconomyConfig;
  private readonly clock: () => Date;
  private readonly rand: RandomInt;
  private readonly newId: () => string;

  constructor(deps: EconomyServiceDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.clock = deps.clock ?? (() => new Date());
    this.rand = deps.rand ?? secureRandomInt;
    this.newId = deps.newId ?? randomUUID;
  }

  // ---------------------------------------------------------------- wallet

  getBalance(userId: string): Promise<number> {
    return this.store.getBalance(userId);
  }

  validateWager(wager: number): string | null {
    const { minBet, maxBet } = this.config;
    if (!Number.isSafeInteger(wager) || wager < minBet || wager > maxBet) {
      return `Wagers must be whole numbers from ${minBet.toLocaleString("en-US")} to ${maxBet.toLocaleString("en-US")} ${this.config.currencySymbol}.`;
    }
    return null;
  }

  // ------------------------------------------------------- work and daily

  private async claim(userId: string, type: ClaimType): Promise<CooldownResult> {
    const isWork = type === "work";
    const amount = isWork ? this.config.workRewardAmount : this.config.dailyRewardAmount;
    const hours = isWork ? this.config.workCooldownHours : this.config.dailyCooldownHours;
    const result = await this.store.claimCooldownReward({
      userId,
      claimType: type,
      amount,
      cooldownMs: hours * 60 * 60 * 1000,
      now: this.clock(),
    });
    if (!result.ok) {
      return { ok: false, nextClaimAt: result.nextClaimAt };
    }
    return { ok: true, amount, balance: result.balance, nextClaimAt: result.nextClaimAt };
  }

  /**
   * Admin tool: adds Dirhams to a member's wallet. Every use writes its own
   * ledger row (kind "admin_give") that names the admin, so it can be audited.
   */
  async adminGive(input: { adminId: string; userId: string; amount: number }): Promise<AdminGiveResult> {
    const { amount } = input;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > ADMIN_GIVE_MAX) {
      return {
        ok: false,
        message: `The amount must be a whole number from 1 to ${ADMIN_GIVE_MAX.toLocaleString("en-US")} ${this.config.currencySymbol}.`,
      };
    }
    try {
      const result = await this.store.credit({
        userId: input.userId,
        amount,
        kind: "admin_give",
        idempotencyKey: `admin_give:${this.newId()}`,
        note: `Added by admin ${input.adminId}`,
      });
      return { ok: true, amount, balance: result.balance };
    } catch (error) {
      if (error instanceof RangeError) {
        return { ok: false, message: "That would take the wallet past the largest balance the bot can store." };
      }
      throw error;
    }
  }

  /**
   * Admin tool: removes Dirhams from a member's wallet. It refuses (and changes
   * nothing) when the member has less than the amount, so a wallet never goes
   * below 0. Every use writes its own ledger row (kind "admin_take").
   */
  async adminTake(input: { adminId: string; userId: string; amount: number }): Promise<AdminTakeResult> {
    const { amount } = input;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > ADMIN_GIVE_MAX) {
      return {
        ok: false,
        message: `The amount must be a whole number from 1 to ${ADMIN_GIVE_MAX.toLocaleString("en-US")} ${this.config.currencySymbol}.`,
      };
    }
    const result = await this.store.debit({
      userId: input.userId,
      amount,
      kind: "admin_take",
      idempotencyKey: `admin_take:${this.newId()}`,
      note: `Removed by admin ${input.adminId}`,
    });
    if (!result.ok) {
      return {
        ok: false,
        message: `That member only has ${result.balance.toLocaleString("en-US")} ${this.config.currencySymbol}, so ${amount.toLocaleString("en-US")} ${this.config.currencySymbol} cannot be taken. Nothing was changed.`,
      };
    }
    return { ok: true, amount, balance: result.balance };
  }

  /** Tax on a transfer of `amount`: rounded down, so small payments can be tax-free. */
  payTax(amount: number): number {
    return Math.floor((amount * this.config.payTaxPercent) / 100);
  }

  /**
   * /pay: a member sends DH to another member. The sender loses `amount`, the
   * receiver gets `amount` minus the (low) tax. Atomic and exactly-once per
   * `interactionId`.
   */
  async pay(input: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    interactionId: string;
  }): Promise<PayResult> {
    const { minAmount, maxAmount } = { minAmount: this.config.payMinAmount, maxAmount: this.config.payMaxAmount };
    const symbol = this.config.currencySymbol;
    if (input.fromUserId === input.toUserId) {
      return { ok: false, message: "You cannot send Dirhams to yourself." };
    }
    if (!Number.isSafeInteger(input.amount) || input.amount < minAmount || input.amount > maxAmount) {
      return {
        ok: false,
        message: `You can send from ${minAmount.toLocaleString("en-US")} to ${maxAmount.toLocaleString("en-US")} ${symbol} at a time.`,
      };
    }
    const tax = this.payTax(input.amount);
    try {
      const result = await this.store.transfer({
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount,
        tax,
        idempotencyKey: `pay:${input.interactionId}`,
      });
      if (!result.ok) {
        return {
          ok: false,
          message:
            result.reason === "duplicate"
              ? FAILURE_MESSAGES.duplicate
              : `You only have ${result.fromBalance.toLocaleString("en-US")} ${symbol}, so you cannot send ${input.amount.toLocaleString("en-US")} ${symbol}.`,
        };
      }
      return {
        ok: true,
        amount: input.amount,
        tax,
        received: input.amount - tax,
        fromBalance: result.fromBalance,
        toBalance: result.toBalance,
      };
    } catch (error) {
      if (error instanceof RangeError) {
        return { ok: false, message: "That would take the receiver's wallet past the largest balance the bot can store." };
      }
      throw error;
    }
  }

  work(userId: string): Promise<CooldownResult> {
    return this.claim(userId, "work");
  }

  daily(userId: string): Promise<CooldownResult> {
    return this.claim(userId, "daily");
  }

  // -------------------------------------------------------------- coinflip

  async coinflip(input: {
    userId: string;
    wager: number;
    choice: CoinSide;
    interactionId: string;
  }): Promise<CoinflipResult> {
    const wagerProblem = this.validateWager(input.wager);
    if (wagerProblem) {
      return fail("invalid_wager", wagerProblem);
    }
    if (input.choice !== "heads" && input.choice !== "tails") {
      return fail("invalid_move");
    }

    const landed: CoinSide = this.rand(2) === 0 ? "heads" : "tails";
    const won = landed === input.choice;
    const payout = won
      ? Math.min(
          Math.floor((input.wager * this.config.coinflipPayoutPercent) / 100),
          this.config.maxGamePayout,
        )
      : 0;

    const settled = await this.store.settleInstantGame({
      userId: input.userId,
      kind: "coinflip",
      wager: input.wager,
      payout,
      idempotencyKey: `coinflip:${input.interactionId}`,
    });
    if (!settled.ok) {
      return fail(settled.reason === "duplicate" ? "duplicate" : "insufficient_funds");
    }
    return {
      ok: true,
      won,
      landed,
      choice: input.choice,
      wager: input.wager,
      payout,
      net: payout - input.wager,
      balance: settled.balance,
    };
  }

  // ----------------------------------------------------------------- mines

  async startMines(input: {
    userId: string;
    wager: number;
    channelId: string | null;
    mineCount?: number;
  }): Promise<GameActionResult> {
    const wagerProblem = this.validateWager(input.wager);
    if (wagerProblem) {
      return fail("invalid_wager", wagerProblem);
    }
    const mineCount = input.mineCount ?? this.config.minesDefaultCount;
    if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > this.config.minesMaxCount) {
      return fail("invalid_move", `Mines must be from 1 to ${this.config.minesMaxCount}.`);
    }

    const state = createMinesState(mineCount, this.rand);
    const started = await this.beginGame(input.userId, "mines", input.wager, state, input.channelId);
    if (!started.ok) {
      return started;
    }
    return { ok: true, view: this.minesView(started.game, state, false, null, 0, started.balance) };
  }

  async minesReveal(gameId: string, userId: string, tile: number): Promise<GameActionResult> {
    const loaded = await this.loadOwnedGame(gameId, userId, "mines");
    if (!loaded.ok) {
      return loaded;
    }
    const { game } = loaded;
    const state = game.state as MinesState;
    const result = revealTile(state, tile);
    if (result.kind === "invalid") {
      return fail("invalid_move");
    }

    if (result.kind === "mine") {
      return this.finishGame(game, state, 0, "mine", (g, s, payout, outcome, balance) =>
        this.minesView(g, s, true, outcome, payout, balance),
      );
    }
    if (result.clearedBoard) {
      const payout = this.minesCashoutValue(game.wager, result.state);
      return this.finishGame(game, result.state, payout, "cleared", (g, s, p, o, b) =>
        this.minesView(g, s, true, o, p, b),
      );
    }
    const saved = await this.store.saveGameState({
      id: game.id,
      expectedVersion: game.version,
      state: result.state,
      now: this.clock(),
      expiresAt: this.nextExpiry(),
    });
    if (!saved) {
      return fail("stale");
    }
    return { ok: true, view: this.minesView(game, result.state, false, null, 0, null) };
  }

  async minesCashout(gameId: string, userId: string): Promise<GameActionResult> {
    const loaded = await this.loadOwnedGame(gameId, userId, "mines");
    if (!loaded.ok) {
      return loaded;
    }
    const { game } = loaded;
    const state = game.state as MinesState;
    if (state.revealed.length < 1) {
      return fail("invalid_move", "Reveal at least one safe tile before cashing out.");
    }
    const payout = this.minesCashoutValue(game.wager, state);
    return this.finishGame(game, state, payout, "cashout", (g, s, p, o, b) =>
      this.minesView(g, s, true, o, p, b),
    );
  }

  private minesCashoutValue(wager: number, state: MinesState): number {
    return minesPayout(
      wager,
      state.mineCount,
      state.revealed.length,
      this.config.minesHouseEdgePercent,
      this.config.maxGamePayout,
    );
  }

  private minesView(
    game: Pick<GameRecord, "id" | "discordUserId" | "wager">,
    state: MinesState,
    ended: boolean,
    outcome: string | null,
    payout: number,
    balance: number | null,
  ): MinesView {
    return {
      type: "mines",
      gameId: game.id,
      ownerId: game.discordUserId,
      wager: game.wager,
      mineCount: state.mineCount,
      revealed: state.revealed,
      mines: ended ? state.mines : null,
      ended,
      outcome,
      payout,
      cashoutValue: this.minesCashoutValue(game.wager, state),
      multiplier: minesMultiplier(
        state.mineCount,
        state.revealed.length,
        this.config.minesHouseEdgePercent,
      ),
      balance,
    };
  }

  // ----------------------------------------------------------- apple tower

  async startAppleTower(input: {
    userId: string;
    wager: number;
    channelId: string | null;
  }): Promise<GameActionResult> {
    const wagerProblem = this.validateWager(input.wager);
    if (wagerProblem) {
      return fail("invalid_wager", wagerProblem);
    }
    const state = createAppleTowerState(this.config.appleTowerLevels, this.rand);
    const started = await this.beginGame(input.userId, "appletower", input.wager, state, input.channelId);
    if (!started.ok) {
      return started;
    }
    return { ok: true, view: this.towerView(started.game, state, false, null, 0, started.balance) };
  }

  async towerPick(gameId: string, userId: string, choice: number): Promise<GameActionResult> {
    const loaded = await this.loadOwnedGame(gameId, userId, "appletower");
    if (!loaded.ok) {
      return loaded;
    }
    const { game } = loaded;
    const state = game.state as AppleTowerState;
    const result = pickApple(state, choice);
    if (result.kind === "invalid") {
      return fail("invalid_move");
    }
    if (result.kind === "wrong") {
      return this.finishGame(game, state, 0, "wrong_apple", (g, s, p, o, b) =>
        this.towerView(g, s, true, o, p, b),
      );
    }
    if (result.topReached) {
      const payout = this.towerCashoutValue(game.wager, result.state);
      return this.finishGame(game, result.state, payout, "top_reached", (g, s, p, o, b) =>
        this.towerView(g, s, true, o, p, b),
      );
    }
    const saved = await this.store.saveGameState({
      id: game.id,
      expectedVersion: game.version,
      state: result.state,
      now: this.clock(),
      expiresAt: this.nextExpiry(),
    });
    if (!saved) {
      return fail("stale");
    }
    return { ok: true, view: this.towerView(game, result.state, false, null, 0, null) };
  }

  async towerCashout(gameId: string, userId: string): Promise<GameActionResult> {
    const loaded = await this.loadOwnedGame(gameId, userId, "appletower");
    if (!loaded.ok) {
      return loaded;
    }
    const { game } = loaded;
    const state = game.state as AppleTowerState;
    if (state.picks.length < 1) {
      return fail("invalid_move", "Clear at least one level before cashing out.");
    }
    const payout = this.towerCashoutValue(game.wager, state);
    return this.finishGame(game, state, payout, "cashout", (g, s, p, o, b) =>
      this.towerView(g, s, true, o, p, b),
    );
  }

  private towerCashoutValue(wager: number, state: AppleTowerState): number {
    return appleTowerPayout(
      wager,
      state.picks.length,
      this.config.appleTowerHouseEdgePercent,
      this.config.maxGamePayout,
    );
  }

  private towerView(
    game: Pick<GameRecord, "id" | "discordUserId" | "wager">,
    state: AppleTowerState,
    ended: boolean,
    outcome: string | null,
    payout: number,
    balance: number | null,
  ): AppleTowerView {
    return {
      type: "appletower",
      gameId: game.id,
      ownerId: game.discordUserId,
      wager: game.wager,
      levels: state.levels,
      levelsCleared: state.picks.length,
      picks: state.picks,
      safeApples: ended ? state.safe : null,
      ended,
      outcome,
      payout,
      cashoutValue: this.towerCashoutValue(game.wager, state),
      multiplier: appleTowerMultiplier(state.picks.length, this.config.appleTowerHouseEdgePercent),
      balance,
    };
  }

  // ------------------------------------------------------------- blackjack

  async startBlackjack(input: {
    userId: string;
    wager: number;
    channelId: string | null;
  }): Promise<GameActionResult> {
    const wagerProblem = this.validateWager(input.wager);
    if (wagerProblem) {
      return fail("invalid_wager", wagerProblem);
    }
    const state = startBlackjack(this.rand);
    const started = await this.beginGame(input.userId, "blackjack", input.wager, state, input.channelId);
    if (!started.ok) {
      return started;
    }
    if (state.phase === "done") {
      // A natural blackjack on either side ends the hand immediately.
      return this.finishBlackjack(started.game, state);
    }
    return { ok: true, view: this.blackjackView(started.game, state, 0, started.balance) };
  }

  async blackjackHit(gameId: string, userId: string): Promise<GameActionResult> {
    return this.blackjackMove(gameId, userId, "hit");
  }

  async blackjackStand(gameId: string, userId: string): Promise<GameActionResult> {
    return this.blackjackMove(gameId, userId, "stand");
  }

  private async blackjackMove(
    gameId: string,
    userId: string,
    move: "hit" | "stand",
  ): Promise<GameActionResult> {
    const loaded = await this.loadOwnedGame(gameId, userId, "blackjack");
    if (!loaded.ok) {
      return loaded;
    }
    const { game } = loaded;
    const state = game.state as BlackjackState;
    if (state.phase !== "player") {
      return fail("already_settled");
    }
    const rules = { dealerHitsSoft17: this.config.blackjackDealerHitsSoft17 };
    const next = move === "hit" ? hit(state, rules) : stand(state, rules);

    if (next.phase === "done") {
      return this.finishBlackjack(game, next);
    }
    const saved = await this.store.saveGameState({
      id: game.id,
      expectedVersion: game.version,
      state: next,
      now: this.clock(),
      expiresAt: this.nextExpiry(),
    });
    if (!saved) {
      return fail("stale");
    }
    return { ok: true, view: this.blackjackView(game, next, 0, null) };
  }

  private blackjackPayoutFor(wager: number, outcome: BlackjackOutcome): number {
    return blackjackPayout(
      wager,
      outcome,
      this.config.blackjackNaturalPayoutPercent,
      this.config.maxGamePayout,
    );
  }

  private async finishBlackjack(
    game: Pick<GameRecord, "id" | "discordUserId" | "wager" | "version">,
    state: BlackjackState,
  ): Promise<GameActionResult> {
    const outcome = state.outcome as BlackjackOutcome;
    const payout = this.blackjackPayoutFor(game.wager, outcome);
    const settled = await this.store.settleGame({
      id: game.id,
      expectedVersion: game.version,
      state,
      payout,
      outcome,
      now: this.clock(),
    });
    if (!settled.settled) {
      return fail("stale");
    }
    return { ok: true, view: this.blackjackView(game, state, payout, settled.balance) };
  }

  private blackjackView(
    game: Pick<GameRecord, "id" | "discordUserId" | "wager">,
    state: BlackjackState,
    payout: number,
    balance: number | null,
    outcomeOverride?: BlackjackOutcome | "expired",
  ): BlackjackView {
    const ended = state.phase === "done";
    return {
      type: "blackjack",
      gameId: game.id,
      ownerId: game.discordUserId,
      wager: game.wager,
      player: state.player,
      dealer: state.dealer,
      dealerHidden: !ended,
      playerTotal: handValue(state.player).total,
      dealerTotal: ended ? handValue(state.dealer).total : null,
      ended,
      outcome: outcomeOverride ?? state.outcome,
      payout,
      balance,
    };
  }

  // -------------------------------------------------------- shared helpers

  private nextExpiry(): Date {
    return new Date(this.clock().getTime() + this.config.gameTimeoutMinutes * 60_000);
  }

  private async beginGame(
    userId: string,
    gameType: GameRecord["gameType"],
    wager: number,
    state: unknown,
    channelId: string | null,
  ): Promise<
    | { ok: true; game: Pick<GameRecord, "id" | "discordUserId" | "wager" | "version">; balance: number }
    | { ok: false; reason: FailureReason; message: string }
  > {
    const id = this.newId();
    const now = this.clock();
    const started = await this.store.startGame({
      id,
      userId,
      gameType,
      wager,
      state,
      channelId,
      now,
      expiresAt: this.nextExpiry(),
    });
    if (!started.ok) {
      return fail(started.reason);
    }
    return {
      ok: true,
      game: { id, discordUserId: userId, wager, version: 0 },
      balance: started.balance,
    };
  }

  /** Loads a game for a button press and enforces owner, status and timeout. */
  private async loadOwnedGame(
    gameId: string,
    userId: string,
    gameType: GameRecord["gameType"],
  ): Promise<{ ok: true; game: GameRecord } | { ok: false; reason: FailureReason; message: string }> {
    const game = await this.store.getGame(gameId);
    if (!game || game.gameType !== gameType) {
      return fail("not_found");
    }
    if (game.discordUserId !== userId) {
      return fail("not_owner");
    }
    if (game.status !== "active") {
      return fail("already_settled");
    }
    if (game.expiresAt.getTime() <= this.clock().getTime()) {
      await this.resolveExpiredGame(game);
      return fail("expired");
    }
    return { ok: true, game };
  }

  private async finishGame<TState>(
    game: GameRecord,
    state: TState,
    payout: number,
    outcome: string,
    makeView: (
      game: GameRecord,
      state: TState,
      payout: number,
      outcome: string,
      balance: number,
    ) => GameView,
  ): Promise<GameActionResult> {
    const settled = await this.store.settleGame({
      id: game.id,
      expectedVersion: game.version,
      state,
      payout,
      outcome,
      now: this.clock(),
    });
    if (!settled.settled) {
      return fail("stale");
    }
    return { ok: true, view: makeView(game, state, payout, outcome, settled.balance) };
  }

  /**
   * Timeout policy for unfinished games (runs on a timer, at startup, and when
   * someone presses a button on an old game):
   *  - mines / appletower: the player's progress is cashed out; with no
   *    progress yet the stake is refunded.
   *  - blackjack: the hand stands automatically and is played out normally.
   */
  async resolveExpiredGame(game: GameRecord): Promise<boolean> {
    if (game.status !== "active") {
      return false;
    }
    let state: unknown = game.state;
    let payout = game.wager;
    let outcome = "expired_refund";

    if (game.gameType === "mines") {
      const mines = game.state as MinesState;
      if (mines.revealed.length > 0) {
        payout = this.minesCashoutValue(game.wager, mines);
        outcome = "expired_cashout";
      }
    } else if (game.gameType === "appletower") {
      const tower = game.state as AppleTowerState;
      if (tower.picks.length > 0) {
        payout = this.towerCashoutValue(game.wager, tower);
        outcome = "expired_cashout";
      }
    } else {
      let blackjack = game.state as BlackjackState;
      if (blackjack.phase === "player") {
        blackjack = stand(blackjack, { dealerHitsSoft17: this.config.blackjackDealerHitsSoft17 });
      }
      state = blackjack;
      const finalOutcome = blackjack.outcome as BlackjackOutcome;
      payout = this.blackjackPayoutFor(game.wager, finalOutcome);
      outcome = `expired_${finalOutcome}`;
    }

    const settled = await this.store.settleGame({
      id: game.id,
      expectedVersion: game.version,
      state,
      payout,
      outcome,
      now: this.clock(),
    });
    return settled.settled;
  }

  /** Settles every overdue game. Returns how many were settled. */
  async resolveExpiredGames(limit = 100): Promise<number> {
    const overdue = await this.store.listExpiredGames(this.clock(), limit);
    let settled = 0;
    for (const game of overdue) {
      if (await this.resolveExpiredGame(game)) {
        settled += 1;
      }
    }
    return settled;
  }
}
