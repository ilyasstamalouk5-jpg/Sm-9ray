import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Last successful /work and /daily claim per user. Cooldowns are computed from
// last_claimed_at, so they survive restarts.
export const discordBotEconomyClaims = pgTable(
  "discord_bot_economy_claims",
  {
    discordUserId: text("discord_user_id").notNull(),
    claimType: text("claim_type").notNull(),
    lastClaimedAt: timestamp("last_claimed_at", {
      withTimezone: true,
    }).notNull(),
    claimCount: integer("claim_count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: "discord_bot_economy_claims_pk",
      columns: [table.discordUserId, table.claimType],
    }),
    check(
      "discord_bot_economy_claims_type_valid",
      sql`${table.claimType} IN ('work', 'daily')`,
    ),
  ],
);

export type DiscordBotEconomyClaim = typeof discordBotEconomyClaims.$inferSelect;
