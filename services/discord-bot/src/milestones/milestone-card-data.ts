// Turns raw milestone facts into the exact words shown on the card and in the
// announcement. No dependencies, so it is easy to test.

export type CardInput = {
  serverName: string;
  username: string;
  roleName: string | null;
  milestone: {
    id: string;
    requiredVoiceTimeSeconds: number;
    currencyRewardAmount: number | null;
  };
  next: {
    id: string;
    roleName: string | null;
    requiredVoiceTimeSeconds: number;
  } | null;
  /** The member's total voice time when the milestone was reached. */
  totalSeconds: number;
  currencySymbol: string;
};

export type CardData = {
  serverName: string;
  handle: string;
  roleTitle: string;
  hoursLabel: string;
  requirementText: string;
  rewardTitle: string;
  rewardSub: string;
  hasReward: boolean;
  nextTitle: string;
  nextSub: string;
};

const SMALL_CAPS: Record<string, string> = {
  "ᴀ": "A", "ʙ": "B", "ᴄ": "C", "ᴅ": "D", "ᴇ": "E", "ꜰ": "F", "ɢ": "G",
  "ʜ": "H", "ɪ": "I", "ᴊ": "J", "ᴋ": "K", "ʟ": "L", "ᴍ": "M", "ɴ": "N",
  "ᴏ": "O", "ᴘ": "P", "ǫ": "Q", "ʀ": "R", "ꜱ": "S", "ᴛ": "T", "ᴜ": "U",
  "ᴠ": "V", "ᴡ": "W", "ʏ": "Y", "ᴢ": "Z",
};

/**
 * Role names often contain decorative symbols the card font cannot draw. This
 * keeps letters, digits and basic punctuation, converts small-caps and styled
 * letters to plain ones, and returns null if nothing readable is left.
 */
export function cleanRoleTitle(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const mapped = [...name].map((char) => SMALL_CAPS[char] ?? char).join("");
  const plain = mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ()+\-./&'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ((plain.match(/[A-Za-z0-9]/g) ?? []).length < 3) {
    return null;
  }
  // Keep the unit lowercase after numbers: "(10-15h)", not "(10-15H)".
  return plain.toUpperCase().replace(/(\d)H\b/g, "$1h");
}

/**
 * Cleans a member's display name for the card font: keeps letters, digits and
 * simple punctuation, converts small-caps and styled letters to plain ones and
 * keeps the original capitalisation. Returns null if nothing readable is left.
 */
export function cleanDisplayText(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const plain = [...name]
    .map((char) => SMALL_CAPS[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ()+\-./&'’_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (plain.match(/[A-Za-z0-9]/g) ?? []).length >= 2 ? plain : null;
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatHoursShort(seconds: number): string {
  return `${trimNumber(seconds / 3600)}h`;
}

export function formatMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

function formatRequirement(seconds: number): string {
  const hours = seconds / 3600;
  const label = `${trimNumber(hours)} ${hours === 1 ? "Hour" : "Hours"}`;
  return `${label} (${formatMinutes(seconds)} Minutes)`;
}

export function formatTimeLeft(seconds: number): string {
  const remaining = Math.max(0, seconds);
  if (remaining < 3600) {
    const minutes = Math.max(1, Math.ceil(remaining / 60));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = remaining / 3600;
  const text = trimNumber(hours);
  return `${text} ${text === "1" ? "hour" : "hours"}`;
}

export function hasRewardAmount(amount: number | null): amount is number {
  return amount !== null && amount > 0;
}

export function buildCardData(input: CardInput): CardData {
  const roleTitle =
    cleanRoleTitle(input.roleName) ?? `MILESTONE ${input.milestone.id}`;
  const amount = input.milestone.currencyRewardAmount;
  const reward = hasRewardAmount(amount);

  let nextTitle = "ALL MILESTONES DONE";
  let nextSub = "You reached the highest rank";
  if (input.next) {
    nextTitle =
      cleanRoleTitle(input.next.roleName) ?? `MILESTONE ${input.next.id}`;
    nextSub = `${formatTimeLeft(
      input.next.requiredVoiceTimeSeconds - input.totalSeconds,
    )} left until next one`;
  }

  return {
    serverName: input.serverName.trim() || "VOICE ACADEMY",
    handle: `@${input.username}`,
    roleTitle,
    hoursLabel: formatHoursShort(input.milestone.requiredVoiceTimeSeconds),
    requirementText: formatRequirement(input.milestone.requiredVoiceTimeSeconds),
    rewardTitle: reward
      ? `+${amount.toLocaleString("en-US")} ${input.currencySymbol}`
      : "REWARD PENDING",
    rewardSub: reward
      ? "Credited directly to your server vault"
      : "Details will follow soon",
    hasReward: reward,
    nextTitle,
    nextSub,
  };
}

export type AnnouncementInput = {
  bullet: string;
  memberId: string;
  roleId: string | null;
  requiredVoiceTimeSeconds: number;
  rewardAmount: number | null;
  currencySymbol: string;
};

/** The quoted bullet list inside the embed. */
export function buildAnnouncementDescription(input: AnnouncementInput): string {
  const amount = input.rewardAmount;
  const reward = hasRewardAmount(amount)
    ? `+${amount} ${input.currencySymbol}`
    : "Pending";
  const lines = [
    `${input.bullet} **Member:** <@${input.memberId}>`,
    `${input.bullet} **Unlocked Role:** ${input.roleId ? `<@&${input.roleId}>` : "`None`"}`,
    `${input.bullet} **Milestone Requirement:** \`${formatHoursShort(input.requiredVoiceTimeSeconds)}\` \`(${formatMinutes(input.requiredVoiceTimeSeconds)} min)\``,
    `${input.bullet} **Milestone Reward:** \`${reward}\``,
  ];
  return lines.map((line) => `> ${line}`).join("\n");
}
