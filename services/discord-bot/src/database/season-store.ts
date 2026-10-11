import { db } from "@workspace/db";
import {
  discordBotSeasons,
  discordBotUserMilestones,
  discordBotUsers,
  discordBotVoiceRewardCheckpoints,
  discordBotVoiceSessions,
} from "@workspace/db";
import { count, eq, gt, or, sql } from "drizzle-orm";
import { logger } from "../config/logger.js";
import type {
  SeasonResetPreview,
  SeasonResetResult,
  SeasonStore,
} from "../season/season-service.js";

/**
 * Season data in PostgreSQL.
 *
 * What a reset changes (study progress only):
 *   - discord_bot_users: voice time, current/claimed milestones and XP go to 0
 *   - discord_bot_user_milestones: every row is deleted
 *   - discord_bot_voice_reward_checkpoints: credited seconds go to 0
 *     (the lifetime total_paid counter is kept)
 *   - discord_bot_voice_sessions: only the sessions running right now are
 *     split at the reset moment. Old session rows are kept, so weekly-task
 *     progress and the activity calendar do not lose history.
 *
 * What it never touches: wallets, the wallet ledger, shop items, shop
 * purchases, weekly tasks, economy settings and milestone settings.
 */
export class DrizzleSeasonStore implements SeasonStore {
  async getCurrentSeason(): Promise<number> {
    const [row] = await db
      .select({ resets: count() })
      .from(discordBotSeasons);
    return (row?.resets ?? 0) + 1;
  }

  async getResetPreview(): Promise<SeasonResetPreview> {
    const [members] = await db
      .select({ value: count() })
      .from(discordBotUsers)
      .where(hasStudyProgress());
    const [records] = await db
      .select({ value: count() })
      .from(discordBotUserMilestones);
    const [sessions] = await db
      .select({ value: count() })
      .from(discordBotVoiceSessions)
      .where(eq(discordBotVoiceSessions.active, true));
    return {
      season: await this.getCurrentSeason(),
      members: members?.value ?? 0,
      milestoneRecords: records?.value ?? 0,
      activeSessions: sessions?.value ?? 0,
    };
  }

  async resetProgress(startedBy: string): Promise<SeasonResetResult> {
    const result = await db.transaction(async (tx) => {
      // Two admins pressing the button together must produce one reset.
      await tx.execute(
        sql`LOCK TABLE ${discordBotSeasons} IN EXCLUSIVE MODE`,
      );
      const now = new Date();

      // 1. Close the running sessions at the reset moment and open a fresh one
      //    right away in the same channel. The seconds before the reset stay
      //    in the closed row (kept for history); they are not added to any
      //    total, so the new season starts from zero.
      const closed = await tx
        .update(discordBotVoiceSessions)
        .set({
          active: false,
          endedAt: sql`GREATEST(${discordBotVoiceSessions.startedAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(eq(discordBotVoiceSessions.active, true))
        .returning({
          discordUserId: discordBotVoiceSessions.discordUserId,
          voiceChannelId: discordBotVoiceSessions.voiceChannelId,
        });
      if (closed.length > 0) {
        await tx.insert(discordBotVoiceSessions).values(
          closed.map((session) => ({
            discordUserId: session.discordUserId,
            voiceChannelId: session.voiceChannelId,
            startedAt: now,
            lastSeenAt: now,
          })),
        );
      }

      // 2. Study progress. Rows are updated in place (never deleted), because
      //    deleting a user would cascade to the voice session history.
      const members = await tx
        .update(discordBotUsers)
        .set({
          totalVoiceTimeSeconds: 0,
          currentMilestone: null,
          claimedMilestones: sql`ARRAY[]::text[]`,
          totalXp: 0,
          updatedAt: now,
        })
        .where(hasStudyProgress())
        .returning({ discordUserId: discordBotUsers.discordUserId });
      const milestoneRecords = await tx
        .delete(discordBotUserMilestones)
        .returning({ discordUserId: discordBotUserMilestones.discordUserId });

      // 3. Voice-reward checkpoint. Without this a member would earn nothing
      //    until the new voice time passed the old checkpoint. total_paid
      //    (lifetime Dirhams paid) is intentionally left alone.
      await tx
        .update(discordBotVoiceRewardCheckpoints)
        .set({ creditedSeconds: 0, updatedAt: now })
        .where(gt(discordBotVoiceRewardCheckpoints.creditedSeconds, 0));

      // 4. Record the reset. The season number is the number of rows + 1.
      await tx.insert(discordBotSeasons).values({
        startedAt: now,
        startedBy,
        membersReset: members.length,
        milestoneRecordsCleared: milestoneRecords.length,
      });
      const [total] = await tx.select({ resets: count() }).from(discordBotSeasons);

      return {
        season: (total?.resets ?? 0) + 1,
        members: members.length,
        milestoneRecords: milestoneRecords.length,
        activeSessions: closed.length,
      };
    });
    logger.info(result, "Season reset stored.");
    return result;
  }
}

function hasStudyProgress() {
  return or(
    gt(discordBotUsers.totalVoiceTimeSeconds, 0),
    gt(discordBotUsers.totalXp, 0),
    sql`${discordBotUsers.currentMilestone} IS NOT NULL`,
    sql`cardinality(${discordBotUsers.claimedMilestones}) > 0`,
  );
}

