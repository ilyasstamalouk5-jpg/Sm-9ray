import { randomBytes } from "node:crypto";
import type { EconomyConfig } from "../economy/economy-config.js";
import type { EconomyStore } from "../economy/store.js";
import {
  WEEKLY_DEFAULT_DAYS,
  WEEKLY_DESCRIPTION_MAX,
  WEEKLY_MAX_DAYS,
  WEEKLY_MAX_HOURS,
  WEEKLY_MAX_OPEN,
  WEEKLY_MAX_REWARD,
  WEEKLY_MIN_HOURS,
  WEEKLY_TITLE_MAX,
  claimKey,
  countingUntil,
  isOpen,
  taskProgress,
  type TaskProgress,
  type WeeklyTask,
} from "./weekly-task-rules.js";
import type { WeeklyTaskStore } from "./weekly-task-store.js";

export type CreateWeeklyTaskInput = {
  title: string;
  description?: string | null;
  hours: number;
  reward: number;
  days?: number;
  createdBy: string;
};

export type CreateWeeklyTaskResult =
  | { ok: true; task: WeeklyTask }
  | { ok: false; message: string };

export type ProgressResult =
  | { ok: true; task: WeeklyTask; progress: TaskProgress; claimed: boolean; open: boolean }
  | { ok: false; message: string };

export type ClaimResult =
  | { ok: true; task: WeeklyTask; reward: number; balance: number }
  | { ok: false; message: string };

type Deps = {
  store: WeeklyTaskStore;
  economy: EconomyStore;
  config: Pick<EconomyConfig, "currencySymbol">;
  /** Voice seconds a member spent between two moments (from the session records). */
  voiceSeconds: (userId: string, since: Date, until: Date) => Promise<number>;
  clock?: () => Date;
  newId?: () => string;
};

function newTaskId(): string {
  return randomBytes(3).toString("hex");
}

export class WeeklyTaskService {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: Deps) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? newTaskId;
  }

  async create(input: CreateWeeklyTaskInput): Promise<CreateWeeklyTaskResult> {
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const days = input.days ?? WEEKLY_DEFAULT_DAYS;
    const symbol = this.deps.config.currencySymbol;
    if (title.length < 1 || title.length > WEEKLY_TITLE_MAX) {
      return { ok: false, message: `The title must be 1 to ${WEEKLY_TITLE_MAX} characters.` };
    }
    if (description && description.length > WEEKLY_DESCRIPTION_MAX) {
      return { ok: false, message: `The description must be at most ${WEEKLY_DESCRIPTION_MAX} characters.` };
    }
    if (!Number.isSafeInteger(input.hours) || input.hours < WEEKLY_MIN_HOURS || input.hours > WEEKLY_MAX_HOURS) {
      return { ok: false, message: `The goal must be a whole number of hours from ${WEEKLY_MIN_HOURS} to ${WEEKLY_MAX_HOURS}.` };
    }
    if (!Number.isSafeInteger(input.reward) || input.reward < 1 || input.reward > WEEKLY_MAX_REWARD) {
      return { ok: false, message: `The reward must be from 1 to ${WEEKLY_MAX_REWARD.toLocaleString("en-US")} ${symbol}.` };
    }
    if (!Number.isSafeInteger(days) || days < 1 || days > WEEKLY_MAX_DAYS) {
      return { ok: false, message: `The duration must be from 1 to ${WEEKLY_MAX_DAYS} days.` };
    }
    if (input.hours > days * 24) {
      return { ok: false, message: `${input.hours} hours do not fit in ${days} ${days === 1 ? "day" : "days"}.` };
    }

    const now = this.clock();
    const task: WeeklyTask = {
      id: this.newId(),
      title,
      description,
      goalSeconds: input.hours * 3600,
      reward: input.reward,
      startsAt: now,
      endsAt: new Date(now.getTime() + days * 86_400_000),
      channelId: null,
      messageId: null,
      status: "active",
      createdBy: input.createdBy,
    };
    const saved = await this.deps.store.create(task, now, WEEKLY_MAX_OPEN);
    if (!saved.ok) {
      return {
        ok: false,
        message: `There are already ${WEEKLY_MAX_OPEN} open weekly tasks. End one with /weekly-task end first.`,
      };
    }
    return { ok: true, task };
  }

  listOpen(): Promise<WeeklyTask[]> {
    return this.deps.store.listOpen(this.clock());
  }

  get(id: string): Promise<WeeklyTask | null> {
    return this.deps.store.get(id);
  }

  setMessage(id: string, channelId: string, messageId: string): Promise<void> {
    return this.deps.store.setMessage(id, channelId, messageId);
  }

  countCompletions(id: string): Promise<number> {
    return this.deps.store.countCompletions(id);
  }

  /** Ends the task. Returns the task as it was, or null if it was not open. */
  async end(id: string): Promise<WeeklyTask | null> {
    const task = await this.deps.store.get(id);
    if (!task || task.status === "ended") {
      return null;
    }
    const ended = await this.deps.store.end(id);
    return ended ? { ...task, status: "ended" } : null;
  }

  async progress(taskId: string, userId: string): Promise<ProgressResult> {
    const now = this.clock();
    const task = await this.deps.store.get(taskId);
    if (!task) {
      return { ok: false, message: "That task no longer exists." };
    }
    const [seconds, claimed] = await Promise.all([
      this.deps.voiceSeconds(userId, task.startsAt, countingUntil(task, now)),
      this.deps.store.hasClaimed(task.id, userId),
    ]);
    return {
      ok: true,
      task,
      progress: taskProgress(task.goalSeconds, seconds),
      claimed,
      open: isOpen(task, now),
    };
  }

  async claim(taskId: string, userId: string): Promise<ClaimResult> {
    const status = await this.progress(taskId, userId);
    if (!status.ok) {
      return status;
    }
    const { task, progress, claimed, open } = status;
    if (claimed) {
      return { ok: false, message: "You already claimed this reward. Nice work!" };
    }
    if (!open) {
      return { ok: false, message: "This task is closed, so its reward can no longer be claimed." };
    }
    if (!progress.done) {
      return { ok: false, message: "You have not reached the goal yet. Keep studying!" };
    }
    // The wallet ledger refuses a second payment with the same key, so even two
    // button presses at the same moment pay only once.
    const paid = await this.deps.economy.credit({
      userId,
      amount: task.reward,
      kind: "weekly_task",
      idempotencyKey: claimKey(task.id, userId),
      note: `Weekly task ${task.id}: ${task.title}`.slice(0, 200),
    });
    if (!paid.applied) {
      return { ok: false, message: "You already claimed this reward. Nice work!" };
    }
    return { ok: true, task, reward: task.reward, balance: paid.balance };
  }
}
