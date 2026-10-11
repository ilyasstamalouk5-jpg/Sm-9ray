import {
  WEEKLY_CLAIM_GRACE_MS,
  claimKey,
  type WeeklyTask,
} from "../../src/weekly/weekly-task-rules.js";
import type { CreateTaskResult, WeeklyTaskStore } from "../../src/weekly/weekly-task-store.js";

/** In-memory WeeklyTaskStore. Claims are read from the wallet store's idempotency keys, like the real one reads the ledger. */
export class MemoryWeeklyStore implements WeeklyTaskStore {
  readonly tasks = new Map<string, WeeklyTask>();

  constructor(private readonly walletKeys: ReadonlySet<string>) {}

  private open(now: Date): WeeklyTask[] {
    return [...this.tasks.values()].filter(
      (task) => task.status === "active" && task.endsAt.getTime() > now.getTime() - WEEKLY_CLAIM_GRACE_MS,
    );
  }

  async create(task: WeeklyTask, now: Date, maxOpen: number): Promise<CreateTaskResult> {
    if (this.open(now).length >= maxOpen) {
      return { ok: false, reason: "too_many_open" };
    }
    this.tasks.set(task.id, { ...task });
    return { ok: true };
  }

  async get(id: string) {
    const task = this.tasks.get(id);
    return task ? { ...task } : null;
  }

  async listOpen(now: Date) {
    return this.open(now).map((task) => ({ ...task }));
  }

  async setMessage(id: string, channelId: string, messageId: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.channelId = channelId;
      task.messageId = messageId;
    }
  }

  async end(id: string) {
    const task = this.tasks.get(id);
    if (!task || task.status === "ended") {
      return false;
    }
    task.status = "ended";
    return true;
  }

  async countCompletions(id: string) {
    return [...this.walletKeys].filter((key) => key.startsWith(`weekly_task:${id}:`)).length;
  }

  async hasClaimed(id: string, userId: string) {
    return this.walletKeys.has(claimKey(id, userId));
  }
}
