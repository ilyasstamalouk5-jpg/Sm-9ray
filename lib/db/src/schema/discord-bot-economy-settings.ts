import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Small key/value table for settings that admins change from Discord, such as
// the currency image URL. Nothing secret is stored here.
export const discordBotEconomySettings = pgTable(
  "discord_bot_economy_settings",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type DiscordBotEconomySetting =
  typeof discordBotEconomySettings.$inferSelect;
