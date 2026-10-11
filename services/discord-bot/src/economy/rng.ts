import { randomInt } from "node:crypto";

/** Random integer in [0, maxExclusive) from the operating system's secure RNG. */
export type RandomInt = (maxExclusive: number) => number;

export const secureRandomInt: RandomInt = (maxExclusive) =>
  randomInt(maxExclusive);

/** Fisher-Yates shuffle using the supplied random source. Returns a new array. */
export function shuffle<T>(
  items: readonly T[],
  rand: RandomInt = secureRandomInt,
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = rand(index + 1);
    const held = copy[index] as T;
    copy[index] = copy[swapWith] as T;
    copy[swapWith] = held;
  }
  return copy;
}

/** Picks `count` distinct integers from [0, total). */
export function pickDistinct(
  total: number,
  count: number,
  rand: RandomInt = secureRandomInt,
): number[] {
  if (!Number.isInteger(total) || !Number.isInteger(count) || count < 0 || count > total) {
    throw new RangeError("Cannot pick that many distinct values.");
  }
  const all = Array.from({ length: total }, (_, index) => index);
  return shuffle(all, rand).slice(0, count).sort((a, b) => a - b);
}
