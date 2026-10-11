import type { WeeklyTask } from "./weekly-task-rules.js";

export type CreateTaskResult = { ok: true } | { ok: false; reason: "too_many_open" };

/** Storage for weekly tasks. The real one uses PostgreSQL; tests use memory. */
export interface WeeklyTaskStore {
  /** Saves a new task unless `maxOpen` tasks are already open at `now`. */
  create(task: WeeklyTask, now: Date, maxOpen: number): Promise<CreateTaskResult>;
  get(id: string): Promise<WeeklyTask | null>;
  /** Tasks that are not ended and still inside their claim window, newest first. */
  listOpen(now: Date): Promise<WeeklyTask[]>;
  setMessage(id: string, channelId: string, messageId: string): Promise<void>;
  /** Marks the task ended. False when it was already ended or does not exist. */
  end(id: string): Promise<boolean>;
  /** How many members were paid for this task. */
  countCompletions(id: string): Promise<number>;
  hasClaimed(id: string, userId: string): Promise<boolean>;
}
