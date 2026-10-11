import { db, pool, runMigrations } from "@workspace/db";
import {
  discordBotMilestoneSettings,
  discordBotUsers,
  discordBotUserMilestones,
  discordBotVoiceSessions,
  discordBotWalletTransactions,
  type DiscordBotUser,
  type DiscordBotVoiceSession,
} from "@workspace/db";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { logger } from "../config/logger.js";
import type { MilestoneSettingRow } from "../milestones/milestone-settings.js";

export type { DiscordBotUser, DiscordBotVoiceSession };

export class DatabaseOperationError extends Error {
  constructor(operation: string) {
    super(`Database operation failed: ${operation}`);
    this.name = "DatabaseOperationError";
  }
}

async function runDatabaseOperation<T>(
  operation: string,
  callback: () => Promise<T>,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    logger.error({ err: error, operation }, "Discord bot database operation failed.");
    throw new DatabaseOperationError(operation);
  }
}

function assertNonnegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

function assertNonemptyString(value: string, field: string): void {
  if (!value.trim()) {
    throw new TypeError(`${field} must not be empty.`);
  }
}

export async function applyMigrations(): Promise<void> {
  await runDatabaseOperation("apply migrations", async () => {
    await runMigrations();
  });
  logger.info("Database migrations are up to date.");
}

export async function initializeDatabase(): Promise<void> {
  await runDatabaseOperation("initialize schema check", async () => {
    await db
      .select({ discordUserId: discordBotUsers.discordUserId })
      .from(discordBotUsers)
      .limit(0);
    await db
      .select({ id: discordBotVoiceSessions.id })
      .from(discordBotVoiceSessions)
      .limit(0);
    await db
      .select({ discordUserId: discordBotUserMilestones.discordUserId })
      .from(discordBotUserMilestones)
      .limit(0);
  });
  logger.info("Discord bot database schema is ready.");
}

export async function closeDatabase(): Promise<void> {
  await runDatabaseOperation("close connection pool", async () => {
    await pool.end();
  });
}

export async function getOrCreateUser(
  discordUserId: string,
): Promise<DiscordBotUser> {
  assertNonemptyString(discordUserId, "discordUserId");
  return runDatabaseOperation("get or create user", async () => {
    await db
      .insert(discordBotUsers)
      .values({ discordUserId })
      .onConflictDoNothing({ target: discordBotUsers.discordUserId });

    const [user] = await db
      .select()
      .from(discordBotUsers)
      .where(eq(discordBotUsers.discordUserId, discordUserId))
      .limit(1);

    if (!user) {
      throw new Error("User row was not returned after insert.");
    }
    return user;
  });
}

export async function getUserData(
  discordUserId: string,
): Promise<DiscordBotUser | null> {
  assertNonemptyString(discordUserId, "discordUserId");
  return runDatabaseOperation("get user", async () => {
    const [user] = await db
      .select()
      .from(discordBotUsers)
      .where(eq(discordBotUsers.discordUserId, discordUserId))
      .limit(1);
    return user ?? null;
  });
}

export async function updateTotalVoiceTime(
  discordUserId: string,
  secondsToAdd: number,
): Promise<DiscordBotUser> {
  assertNonnegativeSafeInteger(secondsToAdd, "secondsToAdd");
  await getOrCreateUser(discordUserId);

  return runDatabaseOperation("update total voice time", async () => {
    const [user] = await db
      .update(discordBotUsers)
      .set({
        totalVoiceTimeSeconds: sql`${discordBotUsers.totalVoiceTimeSeconds} + ${secondsToAdd}`,
        updatedAt: new Date(),
      })
      .where(eq(discordBotUsers.discordUserId, discordUserId))
      .returning();

    if (!user) {
      throw new Error("User row was not returned after update.");
    }
    return user;
  });
}

export type VoiceTimeAdjustMode = "add" | "remove" | "set";

/**
 * Admin correction of a member's saved voice time. "remove" never goes below
 * zero. Does not touch a session that is currently in progress.
 */
export async function adjustUserVoiceTime(
  discordUserId: string,
  mode: VoiceTimeAdjustMode,
  seconds: number,
): Promise<{ before: number; after: number }> {
  assertNonemptyString(discordUserId, "discordUserId");
  assertNonnegativeSafeInteger(seconds, "seconds");
  await getOrCreateUser(discordUserId);

  return runDatabaseOperation("adjust user voice time", async () =>
    db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ total: discordBotUsers.totalVoiceTimeSeconds })
        .from(discordBotUsers)
        .where(eq(discordBotUsers.discordUserId, discordUserId))
        .for("update")
        .limit(1);
      if (!row) {
        throw new Error("User row was not found.");
      }

      const before = row.total;
      const after =
        mode === "add"
          ? before + seconds
          : mode === "remove"
            ? Math.max(0, before - seconds)
            : seconds;
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new RangeError("Adjusted voice time is out of range.");
      }

      await transaction
        .update(discordBotUsers)
        .set({ totalVoiceTimeSeconds: after, updatedAt: new Date() })
        .where(eq(discordBotUsers.discordUserId, discordUserId));
      return { before, after };
    }),
  );
}

export async function getMilestoneSettings(): Promise<MilestoneSettingRow[]> {
  return runDatabaseOperation("load milestone settings", async () => {
    const rows = await db.select().from(discordBotMilestoneSettings);
    return rows.map((row) => ({
      milestoneId: row.milestoneId,
      requiredVoiceTimeSeconds: row.requiredVoiceTimeSeconds,
      roleId: row.roleId,
    }));
  });
}

export async function saveMilestoneSetting(input: {
  milestoneId: string;
  requiredVoiceTimeSeconds?: number;
  roleId?: string;
  updatedBy: string;
}): Promise<void> {
  assertNonemptyString(input.milestoneId, "milestoneId");
  if (input.requiredVoiceTimeSeconds !== undefined) {
    assertNonnegativeSafeInteger(
      input.requiredVoiceTimeSeconds,
      "requiredVoiceTimeSeconds",
    );
  }
  const updatedAt = new Date();
  const changes: Partial<typeof discordBotMilestoneSettings.$inferInsert> = {
    updatedBy: input.updatedBy,
    updatedAt,
  };
  if (input.requiredVoiceTimeSeconds !== undefined) {
    changes.requiredVoiceTimeSeconds = input.requiredVoiceTimeSeconds;
  }
  if (input.roleId !== undefined) {
    changes.roleId = input.roleId;
  }

  await runDatabaseOperation("save milestone setting", async () => {
    await db
      .insert(discordBotMilestoneSettings)
      .values({
        milestoneId: input.milestoneId,
        requiredVoiceTimeSeconds: input.requiredVoiceTimeSeconds ?? null,
        roleId: input.roleId ?? null,
        updatedBy: input.updatedBy,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: discordBotMilestoneSettings.milestoneId,
        set: changes,
      });
  });
}

export async function upsertActiveVoiceSession(input: {
  discordUserId: string;
  voiceChannelId: string;
  startedAt?: Date;
}): Promise<DiscordBotVoiceSession> {
  assertNonemptyString(input.discordUserId, "discordUserId");
  assertNonemptyString(input.voiceChannelId, "voiceChannelId");
  if (input.startedAt && Number.isNaN(input.startedAt.getTime())) {
    throw new TypeError("startedAt must be a valid date.");
  }
  await getOrCreateUser(input.discordUserId);

  return runDatabaseOperation("upsert active voice session", async () => {
    const [session] = await db
      .insert(discordBotVoiceSessions)
      .values({
        discordUserId: input.discordUserId,
        voiceChannelId: input.voiceChannelId,
        startedAt: input.startedAt ?? new Date(),
        lastSeenAt: input.startedAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: discordBotVoiceSessions.discordUserId,
        targetWhere: sql`${discordBotVoiceSessions.active} = true`,
        set: {
          voiceChannelId: input.voiceChannelId,
          endedAt: null,
        },
      })
      .returning();

    if (!session) {
      throw new Error("Voice session row was not returned after upsert.");
    }
    return session;
  });
}

export async function startActiveVoiceSession(input: {
  discordUserId: string;
  voiceChannelId: string;
  startedAt: Date;
}): Promise<DiscordBotVoiceSession> {
  assertNonemptyString(input.discordUserId, "discordUserId");
  assertNonemptyString(input.voiceChannelId, "voiceChannelId");
  if (Number.isNaN(input.startedAt.getTime())) {
    throw new TypeError("startedAt must be a valid date.");
  }
  await getOrCreateUser(input.discordUserId);

  return runDatabaseOperation("recover active voice session", async () => {
    const [session] = await db
      .insert(discordBotVoiceSessions)
      .values({
        discordUserId: input.discordUserId,
        voiceChannelId: input.voiceChannelId,
        startedAt: input.startedAt,
        lastSeenAt: input.startedAt,
      })
      .onConflictDoUpdate({
        target: discordBotVoiceSessions.discordUserId,
        targetWhere: sql`${discordBotVoiceSessions.active} = true`,
        set: {
          voiceChannelId: input.voiceChannelId,
          startedAt: input.startedAt,
          lastSeenAt: input.startedAt,
          endedAt: null,
        },
      })
      .returning();

    if (!session) {
      throw new Error("Recovered voice session row was not returned.");
    }
    return session;
  });
}

export async function endActiveVoiceSession(
  discordUserId: string,
  endedAt = new Date(),
): Promise<DiscordBotVoiceSession | null> {
  assertNonemptyString(discordUserId, "discordUserId");
  if (Number.isNaN(endedAt.getTime())) {
    throw new TypeError("endedAt must be a valid date.");
  }
  return runDatabaseOperation("end active voice session", async () =>
    db.transaction(async (transaction) => {
      const [activeSession] = await transaction
        .select()
        .from(discordBotVoiceSessions)
        .where(
          and(
            eq(discordBotVoiceSessions.discordUserId, discordUserId),
            eq(discordBotVoiceSessions.active, true),
          ),
        )
        .for("update")
        .limit(1);

      if (!activeSession) {
        return null;
      }

      const effectiveEndedAt =
        endedAt.getTime() < activeSession.startedAt.getTime()
          ? activeSession.startedAt
          : endedAt;
      const [session] = await transaction
        .update(discordBotVoiceSessions)
        .set({ active: false, endedAt: effectiveEndedAt })
        .where(
          and(
            eq(discordBotVoiceSessions.id, activeSession.id),
            eq(discordBotVoiceSessions.active, true),
          ),
        )
        .returning();

      if (!session) {
        return null;
      }

      const secondsToAdd = Math.floor(
        (effectiveEndedAt.getTime() - activeSession.startedAt.getTime()) / 1000,
      );
      if (secondsToAdd > 0) {
        const [user] = await transaction
          .update(discordBotUsers)
          .set({
            totalVoiceTimeSeconds: sql`${discordBotUsers.totalVoiceTimeSeconds} + ${secondsToAdd}`,
            updatedAt: effectiveEndedAt,
          })
          .where(eq(discordBotUsers.discordUserId, discordUserId))
          .returning({ discordUserId: discordBotUsers.discordUserId });

        if (!user) {
          throw new Error("User row was not returned after voice-time update.");
        }
      }

      return session;
    }),
  );
}

/**
 * Heartbeat: marks every currently active session as "seen alive" at the given
 * time. One cheap UPDATE per call, no matter how many people are in voice.
 */
export async function touchActiveVoiceSessions(at: Date): Promise<void> {
  if (Number.isNaN(at.getTime())) {
    throw new TypeError("at must be a valid date.");
  }
  await runDatabaseOperation("touch active voice sessions", async () => {
    await db
      .update(discordBotVoiceSessions)
      .set({ lastSeenAt: at })
      .where(eq(discordBotVoiceSessions.active, true));
  });
}

export async function getActiveVoiceSession(
  discordUserId: string,
): Promise<DiscordBotVoiceSession | null> {
  assertNonemptyString(discordUserId, "discordUserId");
  return runDatabaseOperation("get active voice session", async () => {
    const [session] = await db
      .select()
      .from(discordBotVoiceSessions)
      .where(
        and(
          eq(discordBotVoiceSessions.discordUserId, discordUserId),
          eq(discordBotVoiceSessions.active, true),
        ),
      )
      .limit(1);
    return session ?? null;
  });
}

export async function getAllActiveVoiceSessions(): Promise<
  DiscordBotVoiceSession[]
> {
  return runDatabaseOperation("get all active voice sessions", async () =>
    db
      .select()
      .from(discordBotVoiceSessions)
      .where(eq(discordBotVoiceSessions.active, true))
      .orderBy(
        asc(discordBotVoiceSessions.startedAt),
        asc(discordBotVoiceSessions.discordUserId),
      ),
  );
}

function effectiveVoiceTimeExpression(checkedAt: Date) {
  return sql<number>`(
    ${discordBotUsers.totalVoiceTimeSeconds} +
    COALESCE(
      FLOOR(
        GREATEST(
          EXTRACT(EPOCH FROM (${checkedAt} - ${discordBotVoiceSessions.startedAt})),
          0
        )
      ),
      0
    )
  )::bigint`.mapWith(Number);
}

export const getVoiceTimeLeaderboardData = (
  limit = 10,
  checkedAt = new Date(),
): Promise<Array<{ discordUserId: string; value: number }>> => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("limit must be an integer between 1 and 100.");
  }

  return runDatabaseOperation("get voice-time leaderboard data", async () => {
    const effectiveVoiceTime = effectiveVoiceTimeExpression(checkedAt);
    const rows = await db
      .select({
        discordUserId: discordBotUsers.discordUserId,
        value: effectiveVoiceTime,
      })
      .from(discordBotUsers)
      .leftJoin(
        discordBotVoiceSessions,
        and(
          eq(
            discordBotVoiceSessions.discordUserId,
            discordBotUsers.discordUserId,
          ),
          eq(discordBotVoiceSessions.active, true),
        ),
      )
      .orderBy(
        desc(effectiveVoiceTime),
        asc(discordBotUsers.discordUserId),
      )
      .limit(limit);
    return rows;
  });
};

export async function getVoiceTimeRank(
  discordUserId: string,
  checkedAt = new Date(),
): Promise<number | null> {
  assertNonemptyString(discordUserId, "discordUserId");

  return runDatabaseOperation("get voice-time rank", async () => {
    const userVoiceTime = effectiveVoiceTimeExpression(checkedAt);
    const [user] = await db
      .select({ value: userVoiceTime })
      .from(discordBotUsers)
      .leftJoin(
        discordBotVoiceSessions,
        and(
          eq(
            discordBotVoiceSessions.discordUserId,
            discordBotUsers.discordUserId,
          ),
          eq(discordBotVoiceSessions.active, true),
        ),
      )
      .where(eq(discordBotUsers.discordUserId, discordUserId))
      .limit(1);

    if (!user) {
      return null;
    }

    const otherUsersVoiceTime = effectiveVoiceTimeExpression(checkedAt);
    const [position] = await db
      .select({
        usersAhead: sql<number>`COUNT(*)::int`.mapWith(Number),
      })
      .from(discordBotUsers)
      .leftJoin(
        discordBotVoiceSessions,
        and(
          eq(
            discordBotVoiceSessions.discordUserId,
            discordBotUsers.discordUserId,
          ),
          eq(discordBotVoiceSessions.active, true),
        ),
      )
      .where(
        or(
          gt(otherUsersVoiceTime, user.value),
          and(
            eq(otherUsersVoiceTime, user.value),
            lt(discordBotUsers.discordUserId, discordUserId),
          ),
        ),
      );

    return (position?.usersAhead ?? 0) + 1;
  });
}

export type VoiceTimeSessionStats = {
  totalSessionRecords: number;
  completedSessionRecords: number;
  averageCompletedSessionSeconds: number;
  longestCompletedSessionSeconds: number;
  firstSessionAt: Date | null;
  mostRecentSessionAt: Date | null;
};

export async function getVoiceTimeSessionStats(
  discordUserId: string,
): Promise<VoiceTimeSessionStats> {
  assertNonemptyString(discordUserId, "discordUserId");

  return runDatabaseOperation("get voice-time session statistics", async () => {
    const [stats] = await db
      .select({
        totalSessionRecords: sql<number>`COUNT(*)::int`.mapWith(Number),
        completedSessionRecords:
          sql<number>`COUNT(*) FILTER (WHERE ${discordBotVoiceSessions.active} = false)::int`.mapWith(
            Number,
          ),
        averageCompletedSessionSeconds:
          sql<number>`COALESCE(
            AVG(
              GREATEST(
                EXTRACT(EPOCH FROM (${discordBotVoiceSessions.endedAt} - ${discordBotVoiceSessions.startedAt})),
                0
              )
            ) FILTER (WHERE ${discordBotVoiceSessions.active} = false),
            0
          )::float8`.mapWith(Number),
        longestCompletedSessionSeconds:
          sql<number>`COALESCE(
            MAX(
              GREATEST(
                FLOOR(EXTRACT(EPOCH FROM (${discordBotVoiceSessions.endedAt} - ${discordBotVoiceSessions.startedAt}))),
                0
              )
            ) FILTER (WHERE ${discordBotVoiceSessions.active} = false),
            0
          )::bigint`.mapWith(Number),
        firstSessionAt:
          sql<Date | null>`MIN(${discordBotVoiceSessions.startedAt})`,
        mostRecentSessionAt: sql<Date | null>`MAX(
          COALESCE(
            ${discordBotVoiceSessions.endedAt},
            ${discordBotVoiceSessions.startedAt}
          )
        )`,
      })
      .from(discordBotVoiceSessions)
      .where(eq(discordBotVoiceSessions.discordUserId, discordUserId));

    return (
      stats ?? {
        totalSessionRecords: 0,
        completedSessionRecords: 0,
        averageCompletedSessionSeconds: 0,
        longestCompletedSessionSeconds: 0,
        firstSessionAt: null,
        mostRecentSessionAt: null,
      }
    );
  });
}

/**
 * Voice seconds a member spent in the window [since, until], counted from the
 * stored session records. A session that is still active counts up to `until`.
 */
export async function getVoiceSecondsSince(
  discordUserId: string,
  since: Date,
  until = new Date(),
): Promise<number> {
  assertNonemptyString(discordUserId, "discordUserId");

  return runDatabaseOperation("get recent voice seconds", async () => {
    const sinceAt = sql`${since.toISOString()}::timestamptz`;
    const untilAt = sql`${until.toISOString()}::timestamptz`;
    const sessionEnd = sql`LEAST(COALESCE(${discordBotVoiceSessions.endedAt}, ${untilAt}), ${untilAt})`;
    const sessionStart = sql`GREATEST(${discordBotVoiceSessions.startedAt}, ${sinceAt})`;
    const [row] = await db
      .select({
        seconds: sql<number>`COALESCE(
          SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${sessionEnd} - ${sessionStart}))))),
          0
        )::bigint`.mapWith(Number),
      })
      .from(discordBotVoiceSessions)
      .where(
        and(
          eq(discordBotVoiceSessions.discordUserId, discordUserId),
          gt(sql`COALESCE(${discordBotVoiceSessions.endedAt}, ${untilAt})`, sinceAt),
        ),
      );
    return row?.seconds ?? 0;
  });
}

/**
 * Every stored voice session of a member (oldest first) as start/end pairs,
 * for the activity calendar. Active sessions have `endedAt: null`.
 */
export async function getVoiceSessionSpans(
  discordUserId: string,
): Promise<Array<{ startedAt: Date; endedAt: Date | null }>> {
  assertNonemptyString(discordUserId, "discordUserId");

  return runDatabaseOperation("get voice session spans", async () => {
    const rows = await db
      .select({
        startedAt: discordBotVoiceSessions.startedAt,
        endedAt: discordBotVoiceSessions.endedAt,
      })
      .from(discordBotVoiceSessions)
      .where(eq(discordBotVoiceSessions.discordUserId, discordUserId))
      .orderBy(asc(discordBotVoiceSessions.startedAt));
    return rows;
  });
}

export type VoiceRewardEarnings = {
  today: number;
  week: number;
  lifetime: number;
};

/**
 * Dirhams paid for voice time, read from the wallet ledger (kind
 * "voice_reward"). `todayStart` and `weekStart` are the instants the "today"
 * and "last 7 days" windows begin.
 */
export async function getVoiceRewardEarnings(
  discordUserId: string,
  todayStart: Date,
  weekStart: Date,
): Promise<VoiceRewardEarnings> {
  assertNonemptyString(discordUserId, "discordUserId");

  return runDatabaseOperation("get voice reward earnings", async () => {
    const amount = discordBotWalletTransactions.amount;
    const createdAt = discordBotWalletTransactions.createdAt;
    const [row] = await db
      .select({
        today: sql<number>`COALESCE(SUM(${amount}) FILTER (WHERE ${createdAt} >= ${todayStart.toISOString()}::timestamptz), 0)::bigint`.mapWith(Number),
        week: sql<number>`COALESCE(SUM(${amount}) FILTER (WHERE ${createdAt} >= ${weekStart.toISOString()}::timestamptz), 0)::bigint`.mapWith(Number),
        lifetime: sql<number>`COALESCE(SUM(${amount}), 0)::bigint`.mapWith(Number),
      })
      .from(discordBotWalletTransactions)
      .where(
        and(
          eq(discordBotWalletTransactions.discordUserId, discordUserId),
          eq(discordBotWalletTransactions.kind, "voice_reward"),
        ),
      );
    return row ?? { today: 0, week: 0, lifetime: 0 };
  });
}
