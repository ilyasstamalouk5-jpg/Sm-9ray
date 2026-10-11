// Turns the richest-members list into the exact strings the money card shows.
// Pure functions only, so the wording and edge cases are easy to test without
// drawing anything. Paging works exactly like the voice card: the overall top
// three on the left of every page, seven carry-on rows on the right.

import {
  LEADERBOARD_PODIUM_SIZE,
  LEADERBOARD_SLOT_COUNT,
  cardName,
} from "./leaderboard-card-data.js";

export type MoneyCardMember = {
  /** Position on the leaderboard, starting at 1 (0 = not ranked). */
  rank: number;
  displayName: string;
  username: string | null;
  balance: number;
  avatarUrl: string | null;
};

export type MoneyCardInput = {
  serverName: string;
  /** Short currency label drawn after every amount, for example "DH". */
  currencySymbol: string;
  /** Zero-based page index. */
  page: number;
  pages: number;
  /** The overall top members (ranks 1-3), the same on every page. */
  podium: MoneyCardMember[];
  /** The rows of this page, in rank order. */
  rows: MoneyCardMember[];
  /** The member who ran the command; rank is 0 when their wallet is empty. */
  viewer: MoneyCardMember | null;
};

export type MoneyCardEntry = {
  rank: number;
  name: string;
  handle: string | null;
  amount: string;
  avatarUrl: string | null;
  /** First letter, drawn when there is no avatar picture. */
  initial: string;
};

export type MoneyCardData = {
  subtitle: string;
  pageLabel: string;
  /** Slot 0 is the big card, 1 and 2 the medium cards, 3-9 the rows. */
  slots: Array<MoneyCardEntry | null>;
  heroCaption: string | null;
  viewer: {
    rankText: string;
    name: string;
    handle: string | null;
    amount: string;
    avatarUrl: string | null;
    initial: string;
  } | null;
};

/** 231715 -> "231,715 DH". Whole numbers only; bad input shows as 0. */
export function formatMoney(amount: number, symbol: string): string {
  const whole = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  const label = symbol.trim();
  return label ? `${whole.toLocaleString("en-US")} ${label}` : whole.toLocaleString("en-US");
}

function toEntry(member: MoneyCardMember, symbol: string): MoneyCardEntry {
  const name = cardName(member.displayName, member.username);
  const handle = member.username?.trim();
  return {
    rank: member.rank,
    name,
    handle: handle ? `@${handle}` : null,
    amount: formatMoney(member.balance, symbol),
    avatarUrl: member.avatarUrl,
    initial: name.charAt(0).toUpperCase(),
  };
}

export function buildMoneyCardData(input: MoneyCardInput): MoneyCardData {
  const pages = Math.max(1, input.pages);
  const page = Math.min(Math.max(0, input.page), pages - 1);
  const slots: Array<MoneyCardEntry | null> = Array.from({ length: LEADERBOARD_SLOT_COUNT }, (_, index) => {
    const member =
      index < LEADERBOARD_PODIUM_SIZE
        ? input.podium[index]
        : input.rows[index - LEADERBOARD_PODIUM_SIZE];
    return member ? toEntry(member, input.currencySymbol) : null;
  });

  const first = slots[0];
  const serverName = input.serverName.trim().toUpperCase();

  let viewer: MoneyCardData["viewer"] = null;
  if (input.viewer) {
    const entry = toEntry(input.viewer, input.currencySymbol);
    viewer = {
      rankText: input.viewer.rank > 0 ? `Rank #${input.viewer.rank}` : "Unranked",
      name: entry.name,
      handle: entry.handle,
      amount: entry.amount,
      avatarUrl: entry.avatarUrl,
      initial: entry.initial,
    };
  }

  return {
    subtitle: serverName ? `${serverName} • RICHEST MEMBERS` : "RICHEST MEMBERS",
    pageLabel: `PAGE ${page + 1} / ${pages}`,
    slots,
    heroCaption: first ? `${first.handle ?? ""}${first.handle ? " • " : ""}#${first.rank} Richest` : null,
    viewer,
  };
}
