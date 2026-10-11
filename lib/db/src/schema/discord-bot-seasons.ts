import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// One row per season reset. The season a member is in right now is
// (number of rows) + 1: before the first reset everybody is in season 1.
//
// A reset wipes only study progress (voice time, milestones, the voice-reward
// checkpoint). Wallets, the wallet ledger, shop items and purchases are never
// touched, so nothing in those tables refers to a season.
export const discordBotSeasons = pgTable(
  "discord_bot_seasons",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedBy: text("started_by"),
    membersReset: integer("members_reset").notNull().default(0),
    milestoneRecordsCleared: integer("milestone_records_cleared")
      .notNull()
      .default(0),
  },
  (table) => [
    check(
      "discord_bot_seasons_counts_nonnegative",
      sql`${table.membersReset} >= 0 AND ${table.milestoneRecordsCleared} >= 0`,
    ),
  ],
);

export type DiscordBotSeason = typeof discordBotSeasons.$inferSelect;
