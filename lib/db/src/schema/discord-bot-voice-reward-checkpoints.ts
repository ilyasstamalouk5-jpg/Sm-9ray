import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// How many seconds of a member's total voice time have already been paid for.
// Anything above this checkpoint (the "remainder") is carried forward until it
// adds up to a full reward interval.
export const discordBotVoiceRewardCheckpoints = pgTable(
  "discord_bot_voice_reward_checkpoints",
  {
    discordUserId: text("discord_user_id").primaryKey(),
    creditedSeconds: bigint("credited_seconds", { mode: "number" })
      .notNull()
      .default(0),
    totalPaid: bigint("total_paid", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "discord_bot_voice_reward_checkpoints_credited_nonnegative",
      sql`${table.creditedSeconds} >= 0`,
    ),
    check(
      "discord_bot_voice_reward_checkpoints_paid_nonnegative",
      sql`${table.totalPaid} >= 0`,
    ),
  ],
);

export type DiscordBotVoiceRewardCheckpoint =
  typeof discordBotVoiceRewardCheckpoints.$inferSelect;
