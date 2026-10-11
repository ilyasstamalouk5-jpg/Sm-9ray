// Turns voice-session records into the numbers and words shown on the activity
// card. No database or canvas imports, so every rule here is easy to test.

import { cleanDisplayText } from "../milestones/milestone-card-data.js";

export const CALENDAR_WEEKS = 46;
export const CALENDAR_ROWS = 7; // Monday .. Sunday

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionSpan = { startedAt: Date; endedAt: Date | null };

/** "YYYY-MM-DD" key of the calendar day `date` falls on in `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function keyToUtcMs(key: string): number {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return utcMsToKey(keyToUtcMs(key) + days * DAY_MS);
}

/** 0 = Monday ... 6 = Sunday for a "YYYY-MM-DD" key. */
export function weekdayIndex(key: string): number {
  return (new Date(keyToUtcMs(key)).getUTCDay() + 6) % 7;
}

/** True when `timeZone` is a valid IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Smallest whole second in (lo, hi] whose local day satisfies `isLater`.
 * `lo` must not satisfy it and `hi` must. Local midnights always fall on whole
 * seconds, so searching in whole seconds gives the exact instant.
 */
function firstSecondWhere(lo: number, hi: number, isLater: (second: number) => boolean): number {
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (isLater(mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}

/** The instant the local day `key` ("YYYY-MM-DD") begins in `timeZone`. */
export function startOfLocalDay(key: string, timeZone: string): Date {
  const utcMidnight = keyToUtcMs(key) / 1000;
  // Offsets range from UTC-12 to UTC+14, so local midnight is inside this window.
  const second = firstSecondWhere(
    utcMidnight - 15 * 3600,
    utcMidnight + 13 * 3600,
    (t) => dayKey(new Date(t * 1000), timeZone) >= key,
  );
  return new Date(second * 1000);
}

/** The first instant after `fromMs` that falls on a different local day. */
function nextLocalMidnight(fromMs: number, timeZone: string): number {
  const key = dayKey(new Date(fromMs), timeZone);
  const from = Math.floor(fromMs / 1000);
  const second = firstSecondWhere(
    from,
    from + 26 * 3600, // always on a later day
    (t) => dayKey(new Date(t * 1000), timeZone) !== key,
  );
  return second * 1000;
}

/**
 * Splits sessions into voice seconds per calendar day. A session that crosses
 * midnight is divided between the days it touches. Sessions with no end count
 * up to `now`.
 */
export function bucketSessionsByDay(
  sessions: SessionSpan[],
  now: Date,
  timeZone: string,
): Map<string, number> {
  const days = new Map<string, number>();
  const nowMs = now.getTime();
  for (const session of sessions) {
    const startMs = session.startedAt.getTime();
    const endMs = Math.min((session.endedAt ?? now).getTime(), nowMs);
    let cursor = startMs;
    while (cursor < endMs) {
      const key = dayKey(new Date(cursor), timeZone);
      const sliceEnd = Math.min(nextLocalMidnight(cursor, timeZone), endMs);
      days.set(key, (days.get(key) ?? 0) + (sliceEnd - cursor) / 1000);
      cursor = sliceEnd;
    }
  }
  for (const [key, seconds] of days) {
    days.set(key, Math.floor(seconds));
  }
  return days;
}

/** Length of the run of active days ending today (or yesterday if today is empty). */
export function currentStreak(days: Map<string, number>, today: string): number {
  let cursor = (days.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  let streak = 0;
  while ((days.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function longestStreak(days: Map<string, number>): number {
  const keys = [...days.entries()]
    .filter(([, seconds]) => seconds > 0)
    .map(([key]) => key)
    .sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of keys) {
    run = previous !== null && addDays(previous, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

export type CalendarCell = {
  key: string;
  /** 0 = nothing, 1..4 = gem brightness. -1 = a day that has not happened yet. */
  level: number;
  isToday: boolean;
  seconds: number;
};

export type CalendarMonthLabel = { column: number; label: string };

/** Minutes of voice time needed for each gem level (1..4). */
export const LEVEL_MINUTES = [1, 30, 90, 180] as const;

export function levelForSeconds(seconds: number): number {
  if (seconds <= 0) {
    return 0;
  }
  const minutes = seconds / 60;
  let level = 1;
  for (let i = 1; i < LEVEL_MINUTES.length; i += 1) {
    if (minutes >= LEVEL_MINUTES[i]!) {
      level = i + 1;
    }
  }
  return level;
}

/**
 * The calendar grid: `CALENDAR_WEEKS` columns (oldest first, the last one is
 * the current week), 7 rows Monday..Sunday. cells[column][row].
 */
export function buildCalendar(
  days: Map<string, number>,
  today: string,
): { cells: CalendarCell[][]; monthLabels: CalendarMonthLabel[] } {
  const thisMonday = addDays(today, -weekdayIndex(today));
  const firstMonday = addDays(thisMonday, -7 * (CALENDAR_WEEKS - 1));
  const cells: CalendarCell[][] = [];
  for (let column = 0; column < CALENDAR_WEEKS; column += 1) {
    const weekStart = addDays(firstMonday, column * 7);
    const week: CalendarCell[] = [];
    for (let row = 0; row < CALENDAR_ROWS; row += 1) {
      const key = addDays(weekStart, row);
      const future = key > today;
      const seconds = future ? 0 : days.get(key) ?? 0;
      week.push({
        key,
        level: future ? -1 : levelForSeconds(seconds),
        isToday: key === today,
        seconds,
      });
    }
    cells.push(week);
  }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabels: CalendarMonthLabel[] = [];
  let lastMonth = -1;
  for (let column = 0; column < CALENDAR_WEEKS; column += 1) {
    // A month is labelled on the first column that contains its 1st..7th day.
    const firstOfMonthRow = cells[column]!.findIndex((cell) => cell.key.endsWith("-01"));
    const month = Number((firstOfMonthRow >= 0 ? cells[column]![firstOfMonthRow]! : cells[column]![0]!).key.slice(5, 7)) - 1;
    if (month !== lastMonth && (firstOfMonthRow >= 0 || column === 0)) {
      // Skip a label that would be squeezed against the next one.
      monthLabels.push({ column, label: monthNames[month]! });
      lastMonth = month;
    }
  }
  if (monthLabels.length > 1 && monthLabels[1]!.column - monthLabels[0]!.column < 3) {
    monthLabels.shift();
  }
  return { cells, monthLabels };
}

/** "10h 59m" - total hours, never days. */
export function formatHoursMinutes(seconds: number): string {
  const minutes = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "11m" under an hour, otherwise "1h 05m". */
export function formatShort(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function dh(amount: number, symbol: string): string {
  return `${Math.max(0, Math.round(amount)).toLocaleString("en-US")} ${symbol}`;
}

export type ActivityCardInput = {
  displayName: string;
  username: string;
  /** Stored + running voice time (same total /profile shows). */
  totalSeconds: number;
  /** Voice seconds per day from the session records. */
  days: Map<string, number>;
  /** "YYYY-MM-DD" of today in the bot's time zone. */
  today: string;
  /** Wallet balance, or null when the economy is not enabled. */
  balance: number | null;
  currencySymbol: string;
  /** DH paid for voice time, or null when it could not be loaded. */
  earnedToday: number | null;
  earnedWeek: number | null;
  earnedLifetime: number | null;
  /** DH paid per full hour of voice time, or null when unknown. */
  ratePerHour: number | null;
};

export type StatBox = {
  value: string;
  /** Bold lead-in of the sub line (for example "+4 DH"), may be empty. */
  subBold: string;
  sub: string;
};

export type ActivityCardData = {
  name: string;
  pill: string;
  streak: StatBox;
  today: StatBox;
  wallet: StatBox;
  week: StatBox;
  lifetime: StatBox;
  activeDays: StatBox;
  hasWallet: boolean;
  cells: CalendarCell[][];
  monthLabels: CalendarMonthLabel[];
  footer: [string, string, string, string];
};

export function buildActivityCardData(input: ActivityCardInput): ActivityCardData {
  const { days, today } = input;
  const symbol = input.currencySymbol;
  const hasWallet = input.balance !== null;

  const todaySeconds = days.get(today) ?? 0;
  let weekSeconds = 0;
  let activeLast7 = 0;
  for (let i = 0; i < 7; i += 1) {
    const seconds = days.get(addDays(today, -i)) ?? 0;
    weekSeconds += seconds;
    if (seconds > 0) {
      activeLast7 += 1;
    }
  }
  const sevenDayAverage = weekSeconds / 7;
  const activeDays = [...days.values()].filter((seconds) => seconds > 0).length;
  const streak = currentStreak(days, today);
  const best = longestStreak(days);

  const streakBox: StatBox = {
    value: `${streak} ${streak === 1 ? "Day" : "Days"}`,
    subBold: "",
    sub:
      streak === 0
        ? best > 0
          ? `Best streak: ${best} ${best === 1 ? "day" : "days"}`
          : "Join voice to start one"
        : streak >= best
          ? "Personal best record"
          : `Best streak: ${best} ${best === 1 ? "day" : "days"}`,
  };

  // Compare today with the average of the six days before it, so a quiet
  // morning is not judged against a total that already includes today.
  let before = 0;
  for (let i = 1; i <= 6; i += 1) {
    before += days.get(addDays(today, -i)) ?? 0;
  }
  const baseline = before / 6;
  const compare =
    baseline <= 0
      ? todaySeconds > 0
        ? "first day in a while"
        : "no activity yet"
      : Math.abs(todaySeconds - baseline) <= Math.max(300, baseline * 0.1)
        ? "matches 7d avg"
        : todaySeconds > baseline
          ? "above 7d avg"
          : "below 7d avg";
  const todayBox: StatBox =
    input.earnedToday !== null && hasWallet
      ? { value: formatShort(todaySeconds), subBold: `+${dh(input.earnedToday, symbol)}`, sub: ` earned \u00b7 ${compare}` }
      : { value: formatShort(todaySeconds), subBold: "", sub: compare[0]!.toUpperCase() + compare.slice(1) };

  const walletBox: StatBox = hasWallet
    ? {
        value: dh(input.balance ?? 0, symbol),
        subBold: input.earnedToday !== null ? `+${dh(input.earnedToday, symbol)}` : "",
        sub:
          (input.earnedToday !== null ? " today" : "") +
          (input.ratePerHour !== null && input.ratePerHour > 0
            ? `${input.earnedToday !== null ? " \u00b7 " : ""}${input.ratePerHour} ${symbol}/hr rate`
            : ""),
      }
    : { value: "\u2014", subBold: "", sub: "Economy not enabled" };

  const weekBox: StatBox = {
    value: formatHoursMinutes(weekSeconds),
    subBold: hasWallet && input.earnedWeek !== null ? `+${dh(input.earnedWeek, symbol)}` : "",
    sub: hasWallet && input.earnedWeek !== null ? " voice rewards earned" : "Last 7 days",
  };

  const lifetimeBox: StatBox = {
    value: formatHoursMinutes(input.totalSeconds),
    subBold: hasWallet && input.earnedLifetime !== null ? `+${dh(input.earnedLifetime, symbol)}` : "",
    sub: hasWallet && input.earnedLifetime !== null ? " total voice earnings" : "Total hours logged",
  };

  const activeBox: StatBox = {
    value: `${activeDays} ${activeDays === 1 ? "Day" : "Days"}`,
    subBold: "",
    sub: `${formatShort(sevenDayAverage)}/day past 7-day average`,
  };
  void activeLast7;

  const name =
    cleanDisplayText(input.displayName) ?? cleanDisplayText(input.username) ?? "Member";
  const { cells, monthLabels } = buildCalendar(days, today);

  return {
    name,
    pill: "STUDY FOCUS TRACKER",
    streak: streakBox,
    today: todayBox,
    wallet: walletBox,
    week: weekBox,
    lifetime: lifetimeBox,
    activeDays: activeBox,
    hasWallet,
    cells,
    monthLabels,
    footer: [
      `Active Days: ${activeDays}`,
      `Longest Streak: ${best}d`,
      hasWallet ? `Wallet Balance: ${dh(input.balance ?? 0, symbol)}` : "Wallet: not enabled",
      `7-Day Average: ${formatShort(sevenDayAverage)}/d`,
    ],
  };
}
