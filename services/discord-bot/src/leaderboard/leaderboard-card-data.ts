// Turns leaderboard rows into the exact strings the card shows. Pure functions
// only, so the wording and edge cases are easy to test without drawing anything.

import { cleanDisplayText } from "../milestones/milestone-card-data.js";

/** The name shown under the title (the card is made for this one server). */
export const LEADERBOARD_SERVER_LABEL = "2BACSM";

/** The top members shown on the left of every page (1 big card + 2 medium cards). */
export const LEADERBOARD_PODIUM_SIZE = 3;

/** How many rows the right side shows per page (page 1 = ranks 4-10, page 2 = 11-17, ...). */
export const LEADERBOARD_ROWS_PER_PAGE = 7;

/** Slots on the card: the podium plus one page of rows. */
export const LEADERBOARD_SLOT_COUNT = LEADERBOARD_PODIUM_SIZE + LEADERBOARD_ROWS_PER_PAGE;

/** How many pages a leaderboard of `total` members needs (always at least 1). */
export function leaderboardPageCount(total: number): number {
  const rowMembers = Math.max(0, total - LEADERBOARD_PODIUM_SIZE);
  return Math.max(1, Math.ceil(rowMembers / LEADERBOARD_ROWS_PER_PAGE));
}

/** Which positions (0-based indexes into the ranked list) a page's rows come from. */
export function leaderboardRowRange(page: number): { start: number; end: number } {
  const start = LEADERBOARD_PODIUM_SIZE + Math.max(0, page) * LEADERBOARD_ROWS_PER_PAGE;
  return { start, end: start + LEADERBOARD_ROWS_PER_PAGE };
}

export type LeaderboardCardMember = {
  /** Position on the leaderboard, starting at 1. */
  rank: number;
  displayName: string;
  username: string | null;
  seconds: number;
  avatarUrl: string | null;
};

export type LeaderboardCardInput = {
  serverName: string;
  /** Zero-based page index. */
  page: number;
  pages: number;
  /** The overall top members (ranks 1-3), the same on every page. */
  podium: LeaderboardCardMember[];
  /** The rows of this page, in rank order (at most LEADERBOARD_ROWS_PER_PAGE). */
  rows: LeaderboardCardMember[];
  /** The member who ran the command; rank is null when they have no record. */
  viewer: LeaderboardCardMember | null;
};

export type LeaderboardCardEntry = {
  rank: number;
  name: string;
  handle: string | null;
  time: string;
  avatarUrl: string | null;
  /** First letter, drawn when there is no avatar picture. */
  initial: string;
};

export type LeaderboardCardData = {
  subtitle: string;
  pageLabel: string;
  /** Slot 0 is the big card, 1 and 2 the medium cards, 3-9 the rows. */
  slots: Array<LeaderboardCardEntry | null>;
  heroPill: string;
  heroLabel: string;
  heroCaption: string | null;
  viewer: {
    rankText: string;
    name: string;
    handle: string | null;
    time: string;
    avatarUrl: string | null;
    initial: string;
  } | null;
};

/** 513h 33m, 451h, 42m, 30s. Whole hours drop the minutes; short times drop the hours. */
export function formatLeaderboardTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${total}s`;
}

/** A name the card font can draw; falls back to the username, then a plain label. */
export function cardName(displayName: string, username: string | null): string {
  return cleanDisplayText(displayName) ?? cleanDisplayText(username) ?? "Member";
}

function cardHandle(username: string | null): string | null {
  const clean = username?.trim();
  return clean ? `@${clean}` : null;
}

function toEntry(member: LeaderboardCardMember): LeaderboardCardEntry {
  const name = cardName(member.displayName, member.username);
  return {
    rank: member.rank,
    name,
    handle: cardHandle(member.username),
    time: formatLeaderboardTime(member.seconds),
    avatarUrl: member.avatarUrl,
    initial: name.charAt(0).toUpperCase(),
  };
}

export function buildLeaderboardCardData(input: LeaderboardCardInput): LeaderboardCardData {
  const pages = Math.max(1, input.pages);
  const page = Math.min(Math.max(0, input.page), pages - 1);
  const slots: Array<LeaderboardCardEntry | null> = Array.from(
    { length: LEADERBOARD_SLOT_COUNT },
    (_, index) => {
      const member =
        index < LEADERBOARD_PODIUM_SIZE
          ? input.podium[index]
          : input.rows[index - LEADERBOARD_PODIUM_SIZE];
      return member ? toEntry(member) : null;
    },
  );

  const first = slots[0];
  const serverName = input.serverName.trim().toUpperCase();

  let viewer: LeaderboardCardData["viewer"] = null;
  if (input.viewer) {
    const entry = toEntry(input.viewer);
    viewer = {
      rankText: input.viewer.rank > 0 ? `Rank #${input.viewer.rank}` : "Unranked",
      name: entry.name,
      handle: entry.handle,
      time: entry.time,
      avatarUrl: entry.avatarUrl,
      initial: entry.initial,
    };
  }

  return {
    subtitle: serverName ? `${serverName} • ALL TIME` : "ALL TIME",
    pageLabel: `PAGE ${page + 1} / ${pages}`,
    slots,
    heroPill: first ? "#1 TOP VOICE" : "",
    heroLabel: "TOTAL VOICE RECORDED",
    heroCaption: first ? `${first.handle ?? ""}${first.handle ? " • " : ""}#${first.rank} VOICE Rank` : null,
    viewer,
  };
}
