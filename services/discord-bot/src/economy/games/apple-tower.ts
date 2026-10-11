import { type RandomInt, secureRandomInt } from "../rng.js";

export const APPLE_CHOICES = 3;

export type AppleTowerState = {
  levels: number;
  /** Secret: the safe apple (0-2) for every level, chosen when the game starts. */
  safe: number[];
  /** The apple the player picked on each cleared level. */
  picks: number[];
};

export function createAppleTowerState(
  levels: number,
  rand: RandomInt = secureRandomInt,
): AppleTowerState {
  if (!Number.isInteger(levels) || levels < 1) {
    throw new RangeError("Invalid level count.");
  }
  return {
    levels,
    safe: Array.from({ length: levels }, () => rand(APPLE_CHOICES)),
    picks: [],
  };
}

export type PickResult =
  | { kind: "safe"; state: AppleTowerState; topReached: boolean }
  | { kind: "wrong"; state: AppleTowerState; safeApple: number }
  | { kind: "invalid" };

export function pickApple(state: AppleTowerState, choice: number): PickResult {
  if (!Number.isInteger(choice) || choice < 0 || choice >= APPLE_CHOICES) {
    return { kind: "invalid" };
  }
  const level = state.picks.length;
  if (level >= state.levels) {
    return { kind: "invalid" };
  }
  const safeApple = state.safe[level] as number;
  if (choice !== safeApple) {
    return { kind: "wrong", state, safeApple };
  }
  const next: AppleTowerState = { ...state, picks: [...state.picks, choice] };
  return { kind: "safe", state: next, topReached: next.picks.length === state.levels };
}

/**
 * Payout (total returned, including the stake) after clearing `levelsCleared`
 * levels:  payout = wager * (1 - edge) * 3^levelsCleared, rounded down, capped.
 * Each level is a 1-in-3 chance, so 3^n is the fair-odds multiplier.
 */
export function appleTowerPayout(
  wager: number,
  levelsCleared: number,
  houseEdgePercent: number,
  maxPayout: number,
): number {
  const numerator =
    BigInt(wager) * BigInt(100 - houseEdgePercent) * 3n ** BigInt(levelsCleared);
  const payout = numerator / 100n;
  const capped = payout > BigInt(maxPayout) ? BigInt(maxPayout) : payout;
  return Number(capped);
}

/** For display only. */
export function appleTowerMultiplier(
  levelsCleared: number,
  houseEdgePercent: number,
): number {
  return ((100 - houseEdgePercent) / 100) * 3 ** levelsCleared;
}
