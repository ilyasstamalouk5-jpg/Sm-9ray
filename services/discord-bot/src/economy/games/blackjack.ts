import { shuffle, type RandomInt, secureRandomInt } from "../rng.js";

// Cards are integers 0-51. rank = card % 13 (0 = Ace, 1-8 = 2-9, 9-12 = 10/J/Q/K)
// and suit = floor(card / 13).

export type BlackjackOutcome =
  | "blackjack" // player natural, dealer has none: pays the natural rate
  | "win"
  | "push"
  | "lose"
  | "bust"
  | "dealer_blackjack";

export type BlackjackState = {
  /** Secret: the remaining shuffled deck. */
  deck: number[];
  player: number[];
  dealer: number[];
  phase: "player" | "done";
  outcome: BlackjackOutcome | null;
};

export type BlackjackRules = {
  dealerHitsSoft17: boolean;
};

const RANK_NAMES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];

export function cardLabel(card: number): string {
  return `${RANK_NAMES[card % 13]}${SUIT_SYMBOLS[Math.floor(card / 13)]}`;
}

function cardPoints(card: number): number {
  const rank = card % 13;
  if (rank === 0) {
    return 11;
  }
  return rank >= 9 ? 10 : rank + 1;
}

/** Best hand value. Aces count 11 unless that would bust, then 1. */
export function handValue(cards: readonly number[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardPoints(card);
    if (card % 13 === 0) {
      aces += 1;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function isNatural(cards: readonly number[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

function draw(state: BlackjackState): { card: number; deck: number[] } {
  const [card, ...deck] = state.deck;
  if (card === undefined) {
    throw new Error("The deck is empty.");
  }
  return { card, deck };
}

export function startBlackjack(rand: RandomInt = secureRandomInt): BlackjackState {
  const deck = shuffle(Array.from({ length: 52 }, (_, card) => card), rand);
  const [p1, d1, p2, d2, ...rest] = deck as [number, number, number, number, ...number[]];
  const player = [p1, p2];
  const dealer = [d1, d2];
  const playerNatural = isNatural(player);
  const dealerNatural = isNatural(dealer);

  if (playerNatural || dealerNatural) {
    const outcome: BlackjackOutcome =
      playerNatural && dealerNatural
        ? "push"
        : playerNatural
          ? "blackjack"
          : "dealer_blackjack";
    return { deck: rest, player, dealer, phase: "done", outcome };
  }
  return { deck: rest, player, dealer, phase: "player", outcome: null };
}

export function hit(state: BlackjackState, rules: BlackjackRules): BlackjackState {
  if (state.phase !== "player") {
    return state;
  }
  const { card, deck } = draw(state);
  const player = [...state.player, card];
  const total = handValue(player).total;
  const next: BlackjackState = { ...state, deck, player };
  if (total > 21) {
    return { ...next, phase: "done", outcome: "bust" };
  }
  if (total === 21) {
    // Nothing useful left to do at 21, so the hand stands automatically.
    return stand(next, rules);
  }
  return next;
}

export function stand(state: BlackjackState, rules: BlackjackRules): BlackjackState {
  if (state.phase !== "player") {
    return state;
  }
  let working: BlackjackState = state;
  for (;;) {
    const { total, soft } = handValue(working.dealer);
    const mustHit = total < 17 || (total === 17 && soft && rules.dealerHitsSoft17);
    if (!mustHit) {
      break;
    }
    const { card, deck } = draw(working);
    working = { ...working, deck, dealer: [...working.dealer, card] };
  }
  const playerTotal = handValue(working.player).total;
  const dealerTotal = handValue(working.dealer).total;
  const outcome: BlackjackOutcome =
    dealerTotal > 21 || playerTotal > dealerTotal
      ? "win"
      : playerTotal === dealerTotal
        ? "push"
        : "lose";
  return { ...working, phase: "done", outcome };
}

/**
 * Total returned to the player (stake included) for an outcome.
 * win = 1:1, natural = naturalPayoutPercent (150 = 3:2), push = stake back.
 */
export function blackjackPayout(
  wager: number,
  outcome: BlackjackOutcome,
  naturalPayoutPercent: number,
  maxPayout: number,
): number {
  let payout = 0;
  switch (outcome) {
    case "blackjack":
      payout = wager + Math.floor((wager * naturalPayoutPercent) / 100);
      break;
    case "win":
      payout = wager * 2;
      break;
    case "push":
      payout = wager;
      break;
    default:
      payout = 0;
  }
  return Math.min(payout, maxPayout);
}
