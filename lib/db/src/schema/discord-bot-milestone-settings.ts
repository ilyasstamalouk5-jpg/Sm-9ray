import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Admin edits to the milestone list, made from Discord with /voiceadmin.
// A null column means "no override": the default from the code / environment
// variables is used instead.
export const discordBotMilestoneSettings = pgTable(
  "discord_bot_milestone_settings",
  {
    milestoneId: text("milestone_id").primaryKey(),
    requiredVoiceTimeSeconds: integer("required_voice_time_seconds"),
    roleId: text("role_id"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type DiscordBotMilestoneSetting =
  typeof discordBotMilestoneSettings.$inferSelect;
