// Rules and wording for the weekly study task. No dependencies, so it is
// tested on its own: progress maths, who can still claim, button IDs and the
// text printed on the card.

import { cleanDisplayText } from "../milestones/milestone-card-data.js";

/** Like cleanDisplayText but keeps sentence punctuation, for the card's description line. */
export function cleanSentence(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const plain = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ()+\-./&'’_,:;!?%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (plain.match(/[A-Za-z0-9]/g) ?? []).length >= 2 ? plain : null;
}

export type WeeklyTask = {
  id: string;
  title: string;
  description: string | null;
  goalSeconds: number;
  reward: number;
  startsAt: Date;
  endsAt: Date;
  channelId: string | null;
  messageId: string | null;
  status: "active" | "ended";
  createdBy: string | null;
};

export const WEEKLY_COMMAND_NAME = "weekly-task";
export const WEEKLY_BUTTON_PREFIX = "wk|";

export const WEEKLY_TITLE_MAX = 40;
export const WEEKLY_DESCRIPTION_MAX = 140;
export const WEEKLY_MIN_HOURS = 1;
export const WEEKLY_MAX_HOURS = 168;
export const WEEKLY_MAX_REWARD = 1_000_000;
export const WEEKLY_DEFAULT_DAYS = 7;
export const WEEKLY_MAX_DAYS = 31;
/** At most this many tasks can be open at once. */
export const WEEKLY_MAX_OPEN = 3;
/** Members can still press Claim this long after the deadline. */
export const WEEKLY_CLAIM_GRACE_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ button ids

export type WeeklyAction = { kind: "claim" | "progress"; taskId: string };

export const weeklyIds = {
  claim: (taskId: string) => `wk|claim|${taskId}`,
  progress: (taskId: string) => `wk|progress|${taskId}`,
};

export function parseWeeklyId(customId: string): WeeklyAction | null {
  const parts = customId.split("|");
  if (parts.length !== 3 || parts[0] !== "wk" || !parts[2]) {
    return null;
  }
  if (parts[1] !== "claim" && parts[1] !== "progress") {
    return null;
  }
  return { kind: parts[1], taskId: parts[2] };
}

// -------------------------------------------------------------- progress

/** Voice time only counts up to the deadline. */
export function countingUntil(task: Pick<WeeklyTask, "endsAt">, now: Date): Date {
  return now.getTime() < task.endsAt.getTime() ? now : task.endsAt;
}

export function claimWindowEnd(task: Pick<WeeklyTask, "endsAt">): Date {
  return new Date(task.endsAt.getTime() + WEEKLY_CLAIM_GRACE_MS);
}

/** True while the task has not been ended by an admin and the grace period is not over. */
export function isOpen(task: Pick<WeeklyTask, "status" | "endsAt">, now: Date): boolean {
  return task.status === "active" && now.getTime() <= claimWindowEnd(task).getTime();
}

export type TaskProgress = {
  seconds: number;
  goalSeconds: number;
  /** 0 to 100, whole number. */
  percent: number;
  done: boolean;
  remainingSeconds: number;
};

export function taskProgress(goalSeconds: number, voiceSeconds: number): TaskProgress {
  const seconds = Math.max(0, Math.floor(voiceSeconds));
  const percent = Math.min(100, Math.floor((seconds / goalSeconds) * 100));
  return {
    seconds,
    goalSeconds,
    percent,
    done: seconds >= goalSeconds,
    remainingSeconds: Math.max(0, goalSeconds - seconds),
  };
}

export function claimKey(taskId: string, userId: string): string {
  return `weekly_task:${taskId}:${userId}`;
}

// ------------------------------------------------------------ formatting

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "SUN 18 OCT · 01:44 UTC" */
export function formatDeadline(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} · ${hh}:${mm} UTC`;
}

export function progressBarText(percent: number, width = 12): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)}`;
}

// ------------------------------------------------------------- card data

export type WeeklyCardInput = {
  serverName: string;
  currencySymbol: string;
  task: WeeklyTask;
  completions: number;
  now: Date;
};

export type WeeklyCardData = {
  kicker: string;
  title: string;
  description: string;
  statusLabel: string;
  ended: boolean;
  goalValue: string;
  goalSub: string;
  rewardValue: string;
  rewardSub: string;
  deadlineValue: string;
  deadlineSub: string;
  completedText: string;
  howText: string;
};

/** The card font has no emoji or Arabic, so the card shows a plain-letters version of the text. */
export function buildWeeklyCardData(input: WeeklyCardInput): WeeklyCardData {
  const { task, now } = input;
  const open = isOpen(task, now);
  const deadlinePassed = now.getTime() > task.endsAt.getTime();
  const goalHours = task.goalSeconds / 3600;
  const hoursText = Number.isInteger(goalHours) ? String(goalHours) : goalHours.toFixed(1);
  const days = Math.max(1, Math.round((task.endsAt.getTime() - task.startsAt.getTime()) / 86_400_000));
  const server = cleanDisplayText(input.serverName)?.toUpperCase() ?? "STUDY SERVER";

  let statusLabel = "ACTIVE";
  if (!open) {
    statusLabel = "ENDED";
  } else if (deadlinePassed) {
    statusLabel = "LAST CALL";
  }

  return {
    kicker: `${server} • WEEKLY STUDY TASK`,
    title: cleanDisplayText(task.title) ?? "Weekly Study Task",
    description: cleanSentence(task.description) ?? "Study in a voice channel and earn Dirhams.",
    statusLabel,
    ended: !open,
    goalValue: `${hoursText} ${goalHours === 1 ? "HOUR" : "HOURS"}`,
    goalSub: `of voice study time in ${days} ${days === 1 ? "day" : "days"}`,
    rewardValue: `${task.reward.toLocaleString("en-US")} ${input.currencySymbol}`,
    rewardSub: "paid once when you finish",
    deadlineValue: formatDeadline(task.endsAt),
    deadlineSub: open ? (deadlinePassed ? "claim window closing" : "voice time counts until then") : "this task is closed",
    completedText:
      input.completions === 1 ? "1 member completed" : `${input.completions.toLocaleString("en-US")} members completed`,
    howText: open ? "Study in voice, then press Claim below" : "Thanks to everyone who studied",
  };
}
