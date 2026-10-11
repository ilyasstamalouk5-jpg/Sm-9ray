// Turns a member's voice facts into the exact words shown on the profile card.
// No dependencies besides the milestone text helpers, so it is easy to test.

import { cleanDisplayText, cleanRoleTitle } from "../milestones/milestone-card-data.js";

export type ProfileMilestone = {
  id: string;
  roleName: string | null;
  requiredVoiceTimeSeconds: number;
};

export type ProfileCardInput = {
  displayName: string;
  username: string;
  serverName: string;
  /** Eligible voice time, including a session that is still running. */
  totalSeconds: number;
  /** Voice time in the last 7 days. */
  weekSeconds: number;
  /** Leaderboard position, or null when the member has no record yet. */
  rank: number | null;
  /** Wallet balance, or null when the economy is not enabled. */
  balance: number | null;
  currencySymbol: string;
  currencyNamePlural: string;
  current: ProfileMilestone | null;
  next: ProfileMilestone | null;
  /** 0-100, progress from the current milestone to the next one. */
  progressPercent: number;
  remainingSeconds: number;
  /** True when no milestones are configured at all. */
  noMilestones: boolean;
};

export type ProfileCardData = {
  nameWords: string[];
  handle: string;
  pillText: string;
  rankLabel: string;
  rankValue: string;
  rankTitle: string;
  rankSub: string;
  nextPrefix: string;
  nextTitle: string;
  progressFraction: number;
  progressNote: string;
  totalValue: string;
  totalSub: string;
  weekValue: string;
  weekSub: string;
  walletValue: string;
  walletSub: string;
  hasWallet: boolean;
  footer: string;
};

function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "10h 59m" - total hours, never days, to match the milestone hours. */
export function formatHoursMinutes(seconds: number): string {
  const minutes = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatHoursMinutesUpper(seconds: number): string {
  return formatHoursMinutes(seconds).toUpperCase();
}

const RANGE_PATTERN = /^(.*?)\s*\((\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)h\)$/;

/**
 * Splits a cleaned role title such as "VOICE INTERMEDIATE (10-15h)" into the
 * name and the hours range. The range is null when the title has none.
 */
export function splitRoleRange(
  title: string,
): { name: string; from: string; to: string } | null {
  const match = RANGE_PATTERN.exec(title);
  if (!match || !match[1]) {
    return null;
  }
  return { name: match[1], from: match[2] ?? "", to: match[3] ?? "" };
}

function milestoneName(milestone: ProfileMilestone): string {
  return cleanRoleTitle(milestone.roleName) ?? `MILESTONE ${milestone.id}`;
}

function requiredHours(milestone: ProfileMilestone): string {
  return trimNumber(milestone.requiredVoiceTimeSeconds / 3600);
}

export function buildProfileCardData(input: ProfileCardInput): ProfileCardData {
  const name =
    cleanDisplayText(input.displayName) ?? cleanDisplayText(input.username) ?? "Member";
  const serverName = input.serverName.trim() || "Voice Academy";

  let rankTitle: string;
  let rankSub: string;
  if (input.current) {
    const title = milestoneName(input.current);
    const range = splitRoleRange(title);
    rankTitle = range ? range.name : title;
    rankSub = range
      ? `(${range.from}H - ${range.to}H TOTAL VOICE TIME)`
      : `(${requiredHours(input.current)}H+ TOTAL VOICE TIME)`;
  } else if (input.noMilestones) {
    rankTitle = "UNRANKED";
    rankSub = "(NO MILESTONES ARE SET UP YET)";
  } else {
    rankTitle = "NO RANK YET";
    rankSub = input.next
      ? `(UNDER ${requiredHours(input.next)}H TOTAL VOICE TIME)`
      : "(KEEP TALKING TO EARN ONE)";
  }

  let nextPrefix = "NEXT GOAL: ";
  let nextTitle: string;
  let progressNote: string;
  if (input.next) {
    const title = milestoneName(input.next);
    const range = splitRoleRange(title);
    nextTitle = range
      ? `${range.name} (${range.from}H - ${range.to}H)`
      : `${title} (${requiredHours(input.next)}H)`;
    progressNote = `${input.progressPercent}% \u2022 ${formatHoursMinutesUpper(input.remainingSeconds)} TO GO`;
  } else if (input.current) {
    nextPrefix = "";
    nextTitle = "ALL MILESTONES COMPLETE";
    progressNote = "MAX RANK REACHED";
  } else {
    nextPrefix = "";
    nextTitle = "NO MILESTONES YET";
    progressNote = "0%";
  }

  const hasWallet = input.balance !== null;
  return {
    nameWords: name.toUpperCase().split(" "),
    handle: `@${input.username}`,
    pillText: `${serverName.toUpperCase()} \u2022 VOICE PROFILE`,
    rankLabel: "SERVER VOICE ACTIVITY RANK",
    rankValue: input.rank === null ? "UNRANKED" : `#${input.rank}`,
    rankTitle,
    rankSub,
    nextPrefix,
    nextTitle,
    progressFraction: Math.min(1, Math.max(0, input.progressPercent / 100)),
    progressNote,
    totalValue: formatHoursMinutes(input.totalSeconds),
    totalSub: "Total hours logged",
    weekValue: formatHoursMinutes(input.weekSeconds),
    weekSub: "7-day active time",
    walletValue: hasWallet
      ? `${(input.balance ?? 0).toLocaleString("en-US")} ${input.currencySymbol}`
      : "\u2014",
    walletSub: hasWallet ? `${input.currencyNamePlural} held` : "Economy not enabled",
    hasWallet,
    footer: `${cleanDisplayText(serverName) ?? serverName} \u2022 Profile of ${name}`,
  };
}
