import { db } from "@workspace/db";
import {
  discordBotWalletTransactions,
  discordBotWeeklyTasks,
  type DiscordBotWeeklyTask,
} from "@workspace/db";
import { and, count, desc, eq, gt, like, sql } from "drizzle-orm";
import { WEEKLY_CLAIM_GRACE_MS, claimKey, type WeeklyTask } from "./weekly-task-rules.js";
import type { CreateTaskResult, WeeklyTaskStore } from "./weekly-task-store.js";

function toTask(row: DiscordBotWeeklyTask): WeeklyTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    goalSeconds: row.goalSeconds,
    reward: row.reward,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    channelId: row.channelId,
    messageId: row.messageId,
    status: row.status === "ended" ? "ended" : "active",
    createdBy: row.createdBy,
  };
}

function openSince(now: Date): Date {
  return new Date(now.getTime() - WEEKLY_CLAIM_GRACE_MS);
}

export class DrizzleWeeklyTaskStore implements WeeklyTaskStore {
  async create(task: WeeklyTask, now: Date, maxOpen: number): Promise<CreateTaskResult> {
    return db.transaction(async (tx) => {
      // One admin at a time can create tasks; the lock keeps the limit exact.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('discord_bot_weekly_tasks'))`);
      const [row] = await tx
        .select({ open: count() })
        .from(discordBotWeeklyTasks)
        .where(
          and(
            eq(discordBotWeeklyTasks.status, "active"),
            gt(discordBotWeeklyTasks.endsAt, openSince(now)),
          ),
        );
      if ((row?.open ?? 0) >= maxOpen) {
        return { ok: false, reason: "too_many_open" } as const;
      }
      await tx.insert(discordBotWeeklyTasks).values({
        id: task.id,
        title: task.title,
        description: task.description,
        goalSeconds: task.goalSeconds,
        reward: task.reward,
        startsAt: task.startsAt,
        endsAt: task.endsAt,
        channelId: task.channelId,
        messageId: task.messageId,
        status: task.status,
        createdBy: task.createdBy,
      });
      return { ok: true } as const;
    });
  }

  async get(id: string): Promise<WeeklyTask | null> {
    const [row] = await db
      .select()
      .from(discordBotWeeklyTasks)
      .where(eq(discordBotWeeklyTasks.id, id))
      .limit(1);
    return row ? toTask(row) : null;
  }

  async listOpen(now: Date): Promise<WeeklyTask[]> {
    const rows = await db
      .select()
      .from(discordBotWeeklyTasks)
      .where(
        and(
          eq(discordBotWeeklyTasks.status, "active"),
          gt(discordBotWeeklyTasks.endsAt, openSince(now)),
        ),
      )
      .orderBy(desc(discordBotWeeklyTasks.createdAt));
    return rows.map(toTask);
  }

  async setMessage(id: string, channelId: string, messageId: string): Promise<void> {
    await db
      .update(discordBotWeeklyTasks)
      .set({ channelId, messageId })
      .where(eq(discordBotWeeklyTasks.id, id));
  }

  async end(id: string): Promise<boolean> {
    const rows = await db
      .update(discordBotWeeklyTasks)
      .set({ status: "ended" })
      .where(and(eq(discordBotWeeklyTasks.id, id), eq(discordBotWeeklyTasks.status, "active")))
      .returning({ id: discordBotWeeklyTasks.id });
    return rows.length > 0;
  }

  async countCompletions(id: string): Promise<number> {
    const [row] = await db
      .select({ paid: count() })
      .from(discordBotWalletTransactions)
      .where(like(discordBotWalletTransactions.idempotencyKey, `weekly_task:${id}:%`));
    return row?.paid ?? 0;
  }

  async hasClaimed(id: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: discordBotWalletTransactions.id })
      .from(discordBotWalletTransactions)
      .where(eq(discordBotWalletTransactions.idempotencyKey, claimKey(id, userId)))
      .limit(1);
    return Boolean(row);
  }
}
