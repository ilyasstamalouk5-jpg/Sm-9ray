import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Persistent state for multi-step games (mines, appletower, blackjack). The
// state column holds secret information (mine positions, the deck), so it is
// never sent to Discord until the game ends.
export const discordBotCasinoGames = pgTable(
  "discord_bot_casino_games",
  {
    id: text("id").primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    gameType: text("game_type").notNull(),
    wager: bigint("wager", { mode: "number" }).notNull(),
    state: jsonb("state").notNull(),
    // Bumped on every change. Updates are conditional on the version the
    // caller saw, so two clicks racing each other cannot both succeed.
    version: integer("version").notNull().default(0),
    status: text("status").notNull().default("active"),
    outcome: text("outcome"),
    payout: bigint("payout", { mode: "number" }),
    channelId: text("channel_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("discord_bot_casino_games_one_active_per_user_idx")
      .on(table.discordUserId)
      .where(sql`${table.status} = 'active'`),
    index("discord_bot_casino_games_status_expires_idx").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "discord_bot_casino_games_type_valid",
      sql`${table.gameType} IN ('mines', 'appletower', 'blackjack')`,
    ),
    check(
      "discord_bot_casino_games_status_valid",
      sql`${table.status} IN ('active', 'settled')`,
    ),
    check("discord_bot_casino_games_wager_positive", sql`${table.wager} > 0`),
    check(
      "discord_bot_casino_games_payout_nonnegative",
      sql`${table.payout} IS NULL OR ${table.payout} >= 0`,
    ),
  ],
);

export type DiscordBotCasinoGame = typeof discordBotCasinoGames.$inferSelect;
