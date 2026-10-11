import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import type { Ctx2D } from "../src/milestones/milestone-card-draw.js";
import { WeeklyTaskService } from "../src/weekly/weekly-task-service.js";
import { drawWeeklyTaskCard, wrapLines } from "../src/weekly/weekly-task-draw.js";
import {
  WEEKLY_CLAIM_GRACE_MS,
  WEEKLY_MAX_OPEN,
  buildWeeklyCardData,
  formatDeadline,
  parseWeeklyId,
  progressBarText,
  taskProgress,
  weeklyIds,
} from "../src/weekly/weekly-task-rules.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";
import { MemoryWeeklyStore } from "./helpers/memory-weekly-store.js";

const START = new Date("2026-10-11T01:44:00Z");
const HOUR = 3600;

function setup() {
  const economy = new MemoryEconomyStore(0);
  const store = new MemoryWeeklyStore(economy.keys);
  let now = new Date(START);
  let n = 0;
  const studied = new Map<string, number>();
  const calls: Array<{ since: Date; until: Date }> = [];
  const service = new WeeklyTaskService({
    store,
    economy,
    config: loadEconomyConfig({}),
    voiceSeconds: async (userId, since, until) => {
      calls.push({ since, until });
      return studied.get(userId) ?? 0;
    },
    clock: () => now,
    newId: () => `t${(n += 1)}`,
  });
  return {
    economy, store, service, studied, calls,
    setNow: (d: Date) => { now = d; },
  };
}

async function create(service: WeeklyTaskService, over: Partial<Parameters<WeeklyTaskService["create"]>[0]> = {}) {
  const result = await service.create({ title: "Study Marathon", hours: 10, reward: 1500, createdBy: "admin", ...over });
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.task;
}

test("create builds a 7-day window and stores goal in seconds", async () => {
  const { service } = setup();
  const task = await create(service);
  assert.equal(task.goalSeconds, 10 * HOUR);
  assert.equal(task.endsAt.getTime() - task.startsAt.getTime(), 7 * 86_400_000);
  assert.equal(task.status, "active");
});

test("create rejects bad input and impossible goals", async () => {
  const { service } = setup();
  for (const over of [
    { title: "  " }, { title: "x".repeat(41) }, { hours: 0 }, { hours: 169 }, { hours: 1.5 },
    { reward: 0 }, { reward: 1_000_001 }, { days: 0 }, { days: 32 }, { hours: 50, days: 2 },
    { description: "d".repeat(141) },
  ]) {
    const result = await service.create({ title: "T", hours: 5, reward: 100, createdBy: "a", ...over });
    assert.equal(result.ok, false, JSON.stringify(over));
  }
});

test("at most three tasks can be open; ending one frees a slot", async () => {
  const { service } = setup();
  const tasks = [];
  for (let i = 0; i < WEEKLY_MAX_OPEN; i += 1) {
    tasks.push(await create(service));
  }
  const fourth = await service.create({ title: "No", hours: 1, reward: 1, createdBy: "a" });
  assert.equal(fourth.ok, false);
  assert.ok(await service.end(tasks[0]!.id));
  assert.equal((await service.create({ title: "Yes", hours: 1, reward: 1, createdBy: "a" })).ok, true);
});

test("progress and the percentage", () => {
  assert.deepEqual(taskProgress(10 * HOUR, 4 * HOUR), {
    seconds: 4 * HOUR, goalSeconds: 10 * HOUR, percent: 40, done: false, remainingSeconds: 6 * HOUR,
  });
  assert.equal(taskProgress(10 * HOUR, 99 * HOUR).percent, 100);
  assert.equal(taskProgress(10 * HOUR, 10 * HOUR).done, true);
  assert.equal(taskProgress(10 * HOUR, 10 * HOUR - 1).done, false);
  assert.equal(taskProgress(10 * HOUR, -5).seconds, 0);
  assert.equal(progressBarText(50), "▰▰▰▰▰▰▱▱▱▱▱▱");
});

test("claim pays once, before the goal it refuses", async () => {
  const { service, economy, studied } = setup();
  const task = await create(service);
  studied.set("u1", 9 * HOUR);
  const early = await service.claim(task.id, "u1");
  assert.equal(early.ok, false);
  assert.equal(await economy.getBalance("u1"), 0);

  studied.set("u1", 10 * HOUR);
  const first = await service.claim(task.id, "u1");
  assert.deepEqual(first.ok && [first.reward, first.balance], [1500, 1500]);
  const second = await service.claim(task.id, "u1");
  assert.equal(second.ok, false);
  assert.equal(await economy.getBalance("u1"), 1500);
  assert.equal(economy.ledger.filter((row) => row.kind === "weekly_task").length, 1);
  assert.equal(await service.countCompletions(task.id), 1);
});

test("two members can both claim, and two quick presses pay only once", async () => {
  const { service, economy, studied } = setup();
  const task = await create(service);
  studied.set("a", 10 * HOUR);
  studied.set("b", 12 * HOUR);
  const results = await Promise.all([
    service.claim(task.id, "a"), service.claim(task.id, "a"), service.claim(task.id, "b"),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(await economy.getBalance("a"), 1500);
  assert.equal(await economy.getBalance("b"), 1500);
});

test("voice time is counted from the start up to the deadline only", async () => {
  const { service, setNow, calls, studied } = setup();
  const task = await create(service);
  studied.set("u", HOUR);
  setNow(new Date(task.endsAt.getTime() + 3 * HOUR * 1000));
  await service.progress(task.id, "u");
  const last = calls.at(-1)!;
  assert.equal(last.since.getTime(), task.startsAt.getTime());
  assert.equal(last.until.getTime(), task.endsAt.getTime());
});

test("claims work during the 24h grace period, then stop", async () => {
  const { service, setNow, studied } = setup();
  const task = await create(service);
  studied.set("u", 10 * HOUR);
  setNow(new Date(task.endsAt.getTime() + WEEKLY_CLAIM_GRACE_MS - 1000));
  assert.equal((await service.claim(task.id, "u")).ok, true);
  studied.set("v", 10 * HOUR);
  setNow(new Date(task.endsAt.getTime() + WEEKLY_CLAIM_GRACE_MS + 1000));
  assert.equal((await service.claim(task.id, "v")).ok, false);
});

test("an ended task cannot be claimed and cannot be ended twice", async () => {
  const { service, studied } = setup();
  const task = await create(service);
  studied.set("u", 10 * HOUR);
  assert.ok(await service.end(task.id));
  assert.equal(await service.end(task.id), null);
  assert.equal((await service.claim(task.id, "u")).ok, false);
  assert.equal((await service.claim("missing", "u")).ok, false);
});

test("button ids round-trip and junk is rejected", () => {
  assert.deepEqual(parseWeeklyId(weeklyIds.claim("ab12")), { kind: "claim", taskId: "ab12" });
  assert.deepEqual(parseWeeklyId(weeklyIds.progress("ab12")), { kind: "progress", taskId: "ab12" });
  for (const bad of ["wk|claim", "wk|nope|x", "sh|claim|x", "wk|claim|"]) {
    assert.equal(parseWeeklyId(bad), null, bad);
  }
});

test("card text: goal, reward, deadline and plain-letters fallback for the title", () => {
  const task = {
    id: "t1", title: "ماراثون", description: null, goalSeconds: 10 * HOUR, reward: 1500,
    startsAt: START, endsAt: new Date("2026-10-18T01:44:00Z"), channelId: null, messageId: null,
    status: "active" as const, createdBy: null,
  };
  const data = buildWeeklyCardData({ serverName: "2bacsm", currencySymbol: "DH", task, completions: 1, now: START });
  assert.equal(data.kicker, "2BACSM • WEEKLY STUDY TASK");
  assert.equal(data.title, "Weekly Study Task");
  assert.equal(data.goalValue, "10 HOURS");
  assert.equal(data.goalSub, "of voice study time in 7 days");
  assert.equal(data.rewardValue, "1,500 DH");
  assert.equal(data.deadlineValue, "SUN 18 OCT · 01:44 UTC");
  assert.equal(data.statusLabel, "ACTIVE");
  assert.equal(data.completedText, "1 member completed");
  assert.equal(formatDeadline(task.endsAt), data.deadlineValue);
  const ended = buildWeeklyCardData({ serverName: "x", currencySymbol: "DH", task: { ...task, status: "ended" }, completions: 12, now: START });
  assert.equal(ended.statusLabel, "ENDED");
  assert.equal(ended.ended, true);
  assert.equal(ended.completedText, "12 members completed");
});

function fakeContext(): { ctx: Ctx2D; texts: string[] } {
  const texts: string[] = [];
  const gradient = { addColorStop() {} };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "measureText") return (value: string) => ({ width: value.length * 9 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      if (key === "fillText") return (value: string) => { texts.push(value); };
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key: string, value) { target[key] = value; return true; },
  }) as unknown as Ctx2D;
  return { ctx, texts };
}

test("the card draws every piece of text and never crashes on long input", () => {
  const task = {
    id: "t1", title: "Study Marathon", description: "Finish your revision plan and stay focused all week long with us",
    goalSeconds: 10 * HOUR, reward: 1500, startsAt: START, endsAt: new Date("2026-10-18T01:44:00Z"),
    channelId: null, messageId: null, status: "active" as const, createdBy: null,
  };
  const { ctx, texts } = fakeContext();
  drawWeeklyTaskCard(ctx, buildWeeklyCardData({ serverName: "2bacsm", currencySymbol: "DH", task, completions: 3, now: START }));
  for (const expected of ["Study Marathon", "10 HOURS", "1,500 DH", "ACTIVE", "3 members completed", "GOAL", "REWARD", "DEADLINE"]) {
    assert.ok(texts.includes(expected), `missing ${expected}`);
  }
  const long = fakeContext();
  drawWeeklyTaskCard(long.ctx, buildWeeklyCardData({
    serverName: "s".repeat(80), currencySymbol: "DH",
    task: { ...task, title: "T".repeat(40), description: "word ".repeat(28) }, completions: 99999, now: START,
  }));
  assert.ok(long.texts.length > 8);
  assert.ok(wrapLines(long.ctx, "word ".repeat(60), 500, 2).length <= 2);
});
