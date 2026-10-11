import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// A study task an admin posts for the week: "study N hours in voice before
// ends_at and claim R Dirhams". Progress is counted from the voice session
// records, and the reward is paid through the wallet ledger exactly once per
// member (idempotency key weekly_task:<id>:<member>), so no claims table is needed.
export const discordBotWeeklyTasks = pgTable(
  "discord_bot_weekly_tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    goalSeconds: bigint("goal_seconds", { mode: "number" }).notNull(),
    reward: bigint("reward", { mode: "number" }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    // "active" until an admin ends it (or it is closed after the claim window).
    status: text("status").notNull().default("active"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("discord_bot_weekly_tasks_status_idx").on(table.status, table.endsAt),
    check(
      "discord_bot_weekly_tasks_goal_positive",
      sql`${table.goalSeconds} > 0`,
    ),
    check(
      "discord_bot_weekly_tasks_reward_positive",
      sql`${table.reward} > 0`,
    ),
    check(
      "discord_bot_weekly_tasks_window_valid",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "discord_bot_weekly_tasks_status_valid",
      sql`${table.status} IN ('active', 'ended')`,
    ),
  ],
);

export type DiscordBotWeeklyTask = typeof discordBotWeeklyTasks.$inferSelect;
export type NewDiscordBotWeeklyTask = typeof discordBotWeeklyTasks.$inferInsert;
