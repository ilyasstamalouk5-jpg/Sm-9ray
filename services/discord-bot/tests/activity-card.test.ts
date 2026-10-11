import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_ROWS,
  CALENDAR_WEEKS,
  addDays,
  buildActivityCardData,
  buildCalendar,
  bucketSessionsByDay,
  currentStreak,
  dayKey,
  isValidTimeZone,
  levelForSeconds,
  longestStreak,
  startOfLocalDay,
  weekdayIndex,
  type ActivityCardInput,
} from "../src/activity/activity-data.js";

const TODAY = "2026-10-10"; // a Saturday

function daysMap(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

const base: ActivityCardInput = {
  displayName: "ivxd.l24",
  username: "ivxd.l24",
  totalSeconds: 10 * 3600 + 59 * 60,
  days: new Map(),
  today: TODAY,
  balance: 58,
  currencySymbol: "DH",
  earnedToday: 4,
  earnedWeek: 160,
  earnedLifetime: 274,
  ratePerHour: 50,
};

test("day keys follow the chosen time zone", () => {
  const instant = new Date("2026-10-10T23:30:00Z");
  assert.equal(dayKey(instant, "UTC"), "2026-10-10");
  assert.equal(dayKey(instant, "Africa/Casablanca"), "2026-10-11"); // UTC+1
  assert.equal(dayKey(instant, "America/New_York"), "2026-10-10");
  assert.equal(isValidTimeZone("Africa/Casablanca"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
});

test("date helpers: add days and weekday (Monday = 0)", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekdayIndex("2026-10-05"), 0); // Monday
  assert.equal(weekdayIndex("2026-10-10"), 5); // Saturday
  assert.equal(weekdayIndex("2026-10-11"), 6); // Sunday
});

test("start of a local day is the exact instant the day begins", () => {
  assert.equal(startOfLocalDay("2026-10-10", "UTC").toISOString(), "2026-10-10T00:00:00.000Z");
  assert.equal(
    startOfLocalDay("2026-10-10", "America/New_York").toISOString(),
    "2026-10-10T04:00:00.000Z",
  );
  assert.equal(
    startOfLocalDay("2026-10-10", "Asia/Tokyo").toISOString(),
    "2026-10-09T15:00:00.000Z",
  );
});

test("a session that crosses midnight is split between both days", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const days = bucketSessionsByDay(
    [{ startedAt: new Date("2026-10-09T23:00:00Z"), endedAt: new Date("2026-10-10T01:30:00Z") }],
    now,
    "UTC",
  );
  assert.equal(days.get("2026-10-09"), 3600);
  assert.equal(days.get("2026-10-10"), 5400);
});

test("the same session lands on different days in a different time zone", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const days = bucketSessionsByDay(
    [{ startedAt: new Date("2026-10-09T23:00:00Z"), endedAt: new Date("2026-10-10T01:30:00Z") }],
    now,
    "Africa/Casablanca", // UTC+1: 00:00 - 02:30 local, all on the 10th
  );
  assert.equal(days.get("2026-10-10"), 9000);
  assert.equal(days.has("2026-10-09"), false);
});

test("a running session counts up to now and never past it", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const days = bucketSessionsByDay(
    [{ startedAt: new Date("2026-10-10T09:00:00Z"), endedAt: null }],
    now,
    "UTC",
  );
  assert.equal(days.get("2026-10-10"), 3600);
  const future = bucketSessionsByDay(
    [{ startedAt: new Date("2026-10-11T09:00:00Z"), endedAt: null }],
    now,
    "UTC",
  );
  assert.equal(future.size, 0);
});

test("a day with a daylight-saving change still adds up", () => {
  // Europe/Paris clocks go back on 2026-10-25 (that local day is 25 hours long).
  const days = bucketSessionsByDay(
    [{ startedAt: new Date("2026-10-24T22:00:00Z"), endedAt: new Date("2026-10-25T23:00:00Z") }],
    new Date("2026-10-30T00:00:00Z"),
    "Europe/Paris",
  );
  // 00:00 local on the 25th is 22:00Z; the day lasts until 23:00Z on the 25th.
  assert.equal(days.get("2026-10-25"), 25 * 3600);
});

test("streaks: current streak may end yesterday, longest streak is found anywhere", () => {
  const days = daysMap([
    ["2026-10-09", 600], ["2026-10-08", 600], ["2026-10-07", 600],
    ["2026-10-01", 600], ["2026-09-30", 600], ["2026-09-29", 600], ["2026-09-28", 600],
  ]);
  assert.equal(currentStreak(days, TODAY), 3); // today empty, yesterday counts
  assert.equal(longestStreak(days), 4);
  days.set(TODAY, 60);
  assert.equal(currentStreak(days, TODAY), 4);
  assert.equal(currentStreak(new Map(), TODAY), 0);
  assert.equal(longestStreak(new Map()), 0);
  assert.equal(longestStreak(daysMap([["2026-10-01", 0]])), 0);
});

test("gem levels grow with voice time", () => {
  assert.equal(levelForSeconds(0), 0);
  assert.equal(levelForSeconds(30), 1);
  assert.equal(levelForSeconds(29 * 60), 1);
  assert.equal(levelForSeconds(30 * 60), 2);
  assert.equal(levelForSeconds(90 * 60), 3);
  assert.equal(levelForSeconds(3 * 3600), 4);
  assert.equal(levelForSeconds(20 * 3600), 4);
});

test("the calendar has 46 weeks of Monday-to-Sunday columns ending this week", () => {
  const { cells, monthLabels } = buildCalendar(daysMap([[TODAY, 3600]]), TODAY);
  assert.equal(cells.length, CALENDAR_WEEKS);
  assert.ok(cells.every((week) => week.length === CALENDAR_ROWS));
  assert.equal(cells[0]![0]!.key, addDays(addDays(TODAY, -5), -7 * 45)); // Monday 45 weeks back
  const last = cells[CALENDAR_WEEKS - 1]!;
  assert.equal(last[0]!.key, "2026-10-05");
  assert.equal(last[5]!.key, TODAY);
  assert.equal(last[5]!.isToday, true);
  assert.equal(last[5]!.level, 2);
  assert.equal(last[6]!.level, -1); // tomorrow has not happened
  assert.equal(cells.flat().filter((cell) => cell.isToday).length, 1);
  assert.ok(monthLabels.length >= 9);
  assert.ok(monthLabels.every((label, i) => i === 0 || label.column - monthLabels[i - 1]!.column >= 3));
  assert.equal(monthLabels[monthLabels.length - 1]!.label, "Oct");
});

test("card text matches the layout of the design", () => {
  const days = daysMap([
    [TODAY, 11 * 60], [addDays(TODAY, -1), 3600], [addDays(TODAY, -2), 3600],
    [addDays(TODAY, -3), 3600], [addDays(TODAY, -4), 3600],
  ]);
  const data = buildActivityCardData({ ...base, days });
  assert.equal(data.name, "ivxd.l24");
  assert.equal(data.pill, "STUDY FOCUS TRACKER");
  assert.equal(data.streak.value, "5 Days");
  assert.equal(data.streak.sub, "Personal best record");
  assert.equal(data.today.value, "11m");
  assert.equal(data.today.subBold, "+4 DH");
  assert.match(data.today.sub, /earned/);
  assert.equal(data.wallet.value, "58 DH");
  assert.equal(data.wallet.subBold, "+4 DH");
  assert.match(data.wallet.sub, /today · 50 DH\/hr rate/);
  assert.equal(data.week.value, "4h 11m");
  assert.equal(data.week.subBold, "+160 DH");
  assert.equal(data.lifetime.value, "10h 59m");
  assert.equal(data.lifetime.subBold, "+274 DH");
  assert.equal(data.activeDays.value, "5 Days");
  assert.deepEqual(data.footer, [
    "Active Days: 5",
    "Longest Streak: 5d",
    "Wallet Balance: 58 DH",
    "7-Day Average: 35m/d",
  ]);
});

test("singular wording and an old best streak", () => {
  const days = daysMap([
    [TODAY, 600],
    ["2026-09-01", 600], ["2026-09-02", 600], ["2026-09-03", 600],
  ]);
  const data = buildActivityCardData({ ...base, days });
  assert.equal(data.streak.value, "1 Day");
  assert.equal(data.streak.sub, "Best streak: 3 days");
  assert.equal(data.activeDays.value, "4 Days");
});

test("a brand-new member gets zeros and friendly text, never NaN", () => {
  const data = buildActivityCardData({
    ...base, totalSeconds: 0, balance: 0, earnedToday: 0, earnedWeek: 0, earnedLifetime: 0,
  });
  assert.equal(data.streak.value, "0 Days");
  assert.equal(data.streak.sub, "Join voice to start one");
  assert.equal(data.today.value, "0m");
  assert.equal(data.week.value, "0h 0m");
  assert.equal(data.lifetime.value, "0h 0m");
  assert.equal(data.activeDays.sub, "0m/day past 7-day average");
  assert.ok(!JSON.stringify(data).includes("NaN"));
});

test("without the economy the wallet is a dash and no DH amounts appear", () => {
  const data = buildActivityCardData({
    ...base, balance: null, earnedToday: null, earnedWeek: null, earnedLifetime: null, ratePerHour: null,
  });
  assert.equal(data.hasWallet, false);
  assert.equal(data.wallet.value, "\u2014");
  assert.equal(data.wallet.sub, "Economy not enabled");
  assert.equal(data.week.subBold, "");
  assert.equal(data.lifetime.sub, "Total hours logged");
  assert.equal(data.footer[2], "Wallet: not enabled");
  assert.ok(!JSON.stringify(data).includes(" DH"));
});

test("if earnings could not be loaded the card still shows the wallet", () => {
  const data = buildActivityCardData({ ...base, earnedToday: null, earnedWeek: null, earnedLifetime: null });
  assert.equal(data.wallet.value, "58 DH");
  assert.equal(data.today.subBold, "");
  assert.equal(data.week.subBold, "");
});

test("today is compared with the six days before it", () => {
  const steady = daysMap([[TODAY, 3600], ...[1, 2, 3, 4, 5, 6].map((i): [string, number] => [addDays(TODAY, -i), 3600])]);
  assert.match(buildActivityCardData({ ...base, days: steady }).today.sub, /matches 7d avg/);
  const strong = daysMap([[TODAY, 7200], ...[1, 2, 3, 4, 5, 6].map((i): [string, number] => [addDays(TODAY, -i), 3600])]);
  assert.match(buildActivityCardData({ ...base, days: strong }).today.sub, /above 7d avg/);
  const weak = daysMap([[TODAY, 600], ...[1, 2, 3, 4, 5, 6].map((i): [string, number] => [addDays(TODAY, -i), 3600])]);
  assert.match(buildActivityCardData({ ...base, days: weak }).today.sub, /below 7d avg/);
});

test("a very long or symbol-only name falls back safely", () => {
  assert.equal(buildActivityCardData({ ...base, displayName: "", username: "fallback.user" }).name, "fallback.user");
  assert.equal(buildActivityCardData({ ...base, displayName: "", username: "" }).name, "Member");
});
