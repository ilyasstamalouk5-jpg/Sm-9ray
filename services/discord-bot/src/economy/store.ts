// The economy talks to storage only through this interface. The real
// implementation (drizzle-store.ts) uses PostgreSQL transactions; tests use an
// in-memory copy with the same rules.

export type ClaimType = "work" | "daily";
export type GameType = "mines" | "appletower" | "blackjack";

export type GameRecord = {
  id: string;
  discordUserId: string;
  gameType: GameType;
  wager: number;
  state: unknown;
  version: number;
  status: "active" | "settled";
  outcome: string | null;
  payout: number | null;
  channelId: string | null;
  expiresAt: Date;
};

export type CreditResult = { applied: boolean; balance: number };

export type ClaimResult =
  | { ok: true; balance: number; nextClaimAt: Date }
  | { ok: false; nextClaimAt: Date };

export type InstantGameResult =
  | { ok: true; balance: number }
  | { ok: false; reason: "insufficient_funds" | "duplicate"; balance: number };

export type StartGameResult =
  | { ok: true; balance: number }
  | { ok: false; reason: "insufficient_funds" | "active_game_exists"; balance: number };

export type DebitResult =
  | { ok: true; balance: number }
  | { ok: false; reason: "insufficient_funds" | "duplicate"; balance: number };

export type TransferResult =
  | { ok: true; fromBalance: number; toBalance: number }
  | { ok: false; reason: "insufficient_funds" | "duplicate"; fromBalance: number };

export type SettleResult = { settled: boolean; balance: number };

export type VoiceRewardResult = { intervals: number; awarded: number };

export interface EconomyStore {
  getBalance(userId: string): Promise<number>;

  /** Adds `amount` DH exactly once per idempotency key. */
  credit(input: {
    userId: string;
    amount: number;
    kind: string;
    idempotencyKey: string;
    note?: string;
  }): Promise<CreditResult>;

  /**
   * Takes `amount` DH exactly once per idempotency key. Refuses (and changes
   * nothing) when the wallet holds less than `amount`.
   */
  debit(input: {
    userId: string;
    amount: number;
    kind: string;
    idempotencyKey: string;
    note?: string;
  }): Promise<DebitResult>;

  /**
   * Moves DH between two wallets in one atomic step: the sender loses `amount`,
   * the receiver gains `amount - tax`, and the tax leaves the economy. Either
   * everything happens or nothing does, exactly once per idempotency key.
   */
  transfer(input: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    tax: number;
    idempotencyKey: string;
  }): Promise<TransferResult>;

  /** Pays a /work or /daily reward if the cooldown has passed. */
  claimCooldownReward(input: {
    userId: string;
    claimType: ClaimType;
    amount: number;
    cooldownMs: number;
    now: Date;
  }): Promise<ClaimResult>;

  /** One-step games (coinflip): takes the wager and pays `payout` atomically. */
  settleInstantGame(input: {
    userId: string;
    kind: string;
    wager: number;
    payout: number;
    idempotencyKey: string;
  }): Promise<InstantGameResult>;

  /** Takes the wager and stores a new active game in one atomic step. */
  startGame(input: {
    id: string;
    userId: string;
    gameType: GameType;
    wager: number;
    state: unknown;
    channelId: string | null;
    now: Date;
    expiresAt: Date;
  }): Promise<StartGameResult>;

  getGame(id: string): Promise<GameRecord | null>;

  /** Saves progress only if the game is still active at `expectedVersion`. */
  saveGameState(input: {
    id: string;
    expectedVersion: number;
    state: unknown;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean>;

  /** Settles an active game exactly once and pays `payout` (may be 0). */
  settleGame(input: {
    id: string;
    expectedVersion: number;
    state: unknown;
    payout: number;
    outcome: string;
    now: Date;
  }): Promise<SettleResult>;

  listExpiredGames(now: Date, limit: number): Promise<GameRecord[]>;

  /** Pays whole reward intervals found in `totalSeconds` and keeps the rest. */
  processVoiceReward(input: {
    userId: string;
    totalSeconds: number;
    intervalSeconds: number;
    amountPerInterval: number;
    /**
     * The current season (default 1). Ledger keys are `voice:<user>:<checkpoint>`
     * and a reset sends checkpoints back to 0, so from season 2 on the season
     * is part of the key; otherwise the new season would collide with the old
     * season's keys and never be paid.
     */
    season?: number;
  }): Promise<VoiceRewardResult>;

  getRichest(limit: number, offset: number): Promise<Array<{ discordUserId: string; balance: number }>>;
  countWallets(): Promise<number>;
  /** 1-based position by balance (same order as getRichest), or null when the wallet is empty. */
  getWalletRank(userId: string): Promise<number | null>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null, updatedBy: string): Promise<void>;
}
