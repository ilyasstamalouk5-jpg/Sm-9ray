import { pickDistinct, type RandomInt, secureRandomInt } from "../rng.js";

export const MINES_COLUMNS = 5;
export const MINES_ROWS = 4;
export const MINES_TILES = MINES_COLUMNS * MINES_ROWS; // 20

export type MinesState = {
  mineCount: number;
  /** Secret: tile indexes (0-19) holding mines. Never shown until the end. */
  mines: number[];
  /** Tile indexes the player has safely revealed. */
  revealed: number[];
};

export function createMinesState(
  mineCount: number,
  rand: RandomInt = secureRandomInt,
): MinesState {
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount >= MINES_TILES) {
    throw new RangeError("Invalid mine count.");
  }
  return {
    mineCount,
    mines: pickDistinct(MINES_TILES, mineCount, rand),
    revealed: [],
  };
}

export type RevealResult =
  | { kind: "safe"; state: MinesState; clearedBoard: boolean }
  | { kind: "mine"; state: MinesState }
  | { kind: "invalid" };

export function revealTile(state: MinesState, tile: number): RevealResult {
  if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_TILES) {
    return { kind: "invalid" };
  }
  if (state.revealed.includes(tile)) {
    return { kind: "invalid" };
  }
  if (state.mines.includes(tile)) {
    return { kind: "mine", state };
  }
  const revealed = [...state.revealed, tile];
  const next: MinesState = { ...state, revealed };
  return {
    kind: "safe",
    state: next,
    clearedBoard: revealed.length === MINES_TILES - state.mineCount,
  };
}

/**
 * Payout (total returned, including the stake) after `safeRevealed` safe tiles.
 *
 *   multiplier(k) = (1 - edge) * product for i in 0..k-1 of (T - i) / (T - M - i)
 *
 * where T = 20 tiles, M = mines and edge = house edge. This is the fair-odds
 * multiplier reduced by the house edge. The result is rounded DOWN to a whole
 * Dirham using exact integer arithmetic and capped at maxPayout.
 */
export function minesPayout(
  wager: number,
  mineCount: number,
  safeRevealed: number,
  houseEdgePercent: number,
  maxPayout: number,
): number {
  let numerator = BigInt(wager) * BigInt(100 - houseEdgePercent);
  let denominator = 100n;
  for (let index = 0; index < safeRevealed; index += 1) {
    numerator *= BigInt(MINES_TILES - index);
    denominator *= BigInt(MINES_TILES - mineCount - index);
  }
  const payout = numerator / denominator;
  const capped = payout > BigInt(maxPayout) ? BigInt(maxPayout) : payout;
  return Number(capped);
}

/** For display only. */
export function minesMultiplier(
  mineCount: number,
  safeRevealed: number,
  houseEdgePercent: number,
): number {
  let value = (100 - houseEdgePercent) / 100;
  for (let index = 0; index < safeRevealed; index += 1) {
    value *= (MINES_TILES - index) / (MINES_TILES - mineCount - index);
  }
  return value;
}
