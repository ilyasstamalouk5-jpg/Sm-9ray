import { logger } from "../config/logger.js";
import { validateMilestones } from "./milestone-settings.js";
import type { MilestoneStore, UserVoiceProgress } from "./types.js";
import type {
  MilestoneDefinition,
  MilestoneProgressRecord,
} from "./types.js";
import type { MilestoneRoleManager } from "./role-manager.js";
import type { RewardManager } from "../rewards/reward-manager.js";

export type MilestoneAnnouncement = {
  discordUserId: string;
  milestone: MilestoneDefinition;
  /** The member's total voice time at the moment of the check. */
  totalSeconds: number;
};

/** Optional: told once about the highest milestone a member newly reached. */
export interface MilestoneAnnouncer {
  announce(event: MilestoneAnnouncement): Promise<void>;
}

function activeVoiceSeconds(
  progress: UserVoiceProgress,
  now: Date,
): number {
  if (!progress.activeSessionStartedAt) {
    return 0;
  }
  return Math.max(
    0,
    Math.floor(
      (now.getTime() - progress.activeSessionStartedAt.getTime()) / 1_000,
    ),
  );
}

export class MilestoneManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningCheck: Promise<void> | null = null;
  private started = false;
  private stopped = false;
  private pauseDepth = 0;

  constructor(
    private readonly store: MilestoneStore,
    private readonly roleManager: MilestoneRoleManager,
    private readonly rewardManager: RewardManager,
    private readonly milestones: readonly MilestoneDefinition[],
    private readonly checkIntervalMs: number,
    private readonly clock: () => Date = () => new Date(),
    private readonly announcer?: MilestoneAnnouncer,
  ) {
    validateMilestones(milestones);
    if (!Number.isSafeInteger(checkIntervalMs) || checkIntervalMs < 10_000) {
      throw new Error("Milestone check interval must be at least 10 seconds.");
    }
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    await this.checkAllUsers();
    if (this.stopped) {
      return;
    }
    this.timer = setInterval(() => {
      void this.checkAllUsers();
    }, this.checkIntervalMs);
    this.timer.unref?.();
    logger.info(
      { intervalMs: this.checkIntervalMs },
      "Voice-time milestone checks started.",
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.runningCheck;
  }

  /**
   * Runs `work` while no milestone check is running or can start. A check that
   * is already in progress finishes first, so it cannot write stale progress
   * after `work` (a season reset, for example) has changed the data.
   */
  async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    this.pauseDepth += 1;
    try {
      await this.runningCheck?.catch(() => undefined);
      return await work();
    } finally {
      this.pauseDepth -= 1;
    }
  }

  async checkAllUsers(): Promise<void> {
    if (this.pauseDepth > 0) {
      return;
    }
    if (this.runningCheck) {
      return this.runningCheck;
    }

    const check = this.checkAllUsersInternal();
    this.runningCheck = check;
    try {
      await check;
    } finally {
      if (this.runningCheck === check) {
        this.runningCheck = null;
      }
    }
  }

  private async checkAllUsersInternal(): Promise<void> {
    let users: UserVoiceProgress[];
    try {
      users = await this.store.getAllVoiceProgress();
    } catch (error) {
      logger.error({ err: error }, "Milestone check could not load voice-time totals.");
      return;
    }

    const now = this.clock();
    for (const user of users) {
      if (this.stopped || this.pauseDepth > 0) {
        return;
      }
      try {
        await this.checkUser(user, now);
      } catch (error) {
        logger.error(
          { err: error, discordUserId: user.discordUserId },
          "Milestone check failed for one Discord user.",
        );
      }
    }
  }

  private async checkUser(
    user: UserVoiceProgress,
    checkedAt: Date,
  ): Promise<void> {
    const earnedVoiceSeconds =
      user.totalVoiceTimeSeconds + activeVoiceSeconds(user, checkedAt);
    const progressBefore = await this.store.getMilestoneProgress(
      user.discordUserId,
    );
    const previouslyReached = new Set(
      progressBefore.map((milestone) => milestone.milestoneId),
    );
    const earnedMilestones = this.milestones.filter(
      (milestone) =>
        milestone.requiredVoiceTimeSeconds <= earnedVoiceSeconds ||
        previouslyReached.has(milestone.id),
    );
    if (earnedMilestones.length === 0) {
      return;
    }
    // Only milestones with no saved record are new, so a restart or a repeated
    // check can never announce the same milestone twice.
    const newlyReached = earnedMilestones
      .filter((milestone) => !previouslyReached.has(milestone.id))
      .at(-1);

    const progressByIdBefore = new Map(
      progressBefore.map((milestone) => [milestone.milestoneId, milestone]),
    );
    const milestonesNeedingPersistence = earnedMilestones.filter(
      (milestone) => {
        const existing = progressByIdBefore.get(milestone.id);
        return (
          !existing ||
          existing.requiredVoiceTimeSeconds !==
            milestone.requiredVoiceTimeSeconds ||
          existing.roleId !== milestone.roleId ||
          (existing.rewardStatus !== "issued" &&
            existing.currencyRewardAmount !== milestone.currencyRewardAmount)
        );
      },
    );
    if (milestonesNeedingPersistence.length > 0) {
      await this.store.recordReachedMilestones(
        user.discordUserId,
        milestonesNeedingPersistence,
        checkedAt,
      );
    }
    const progress = await this.store.getMilestoneProgress(user.discordUserId);
    const progressById = new Map(
      progress.map((milestone) => [milestone.milestoneId, milestone]),
    );
    const highestReached = earnedMilestones.at(-1);
    if (!highestReached) {
      return;
    }

    const highestConfiguredRole = earnedMilestones
      .filter((milestone) => milestone.roleId !== null)
      .at(-1);

    if (!highestConfiguredRole) {
      await this.roleManager.assignHighestMilestoneRole(
        user.discordUserId,
        highestReached,
      );
      for (const milestone of earnedMilestones) {
        const existing = progressById.get(milestone.id);
        if (existing?.roleStatus !== "unconfigured") {
          await this.store.updateMilestoneRoleStatus(
            user.discordUserId,
            milestone.id,
            "unconfigured",
          );
        }
      }
      await this.rewardManager.processUserRewards(user.discordUserId);
      await this.announceMilestone(user.discordUserId, newlyReached, earnedVoiceSeconds);
      return;
    }

    const highestProgress = progressById.get(highestConfiguredRole.id);
    let highestRoleStatus = highestProgress?.roleStatus;
    if (
      !highestProgress ||
      highestProgress.roleId !== highestConfiguredRole.roleId ||
      this.needsRoleSynchronization(highestProgress)
    ) {
      const roleStatus = await this.roleManager.assignHighestMilestoneRole(
        user.discordUserId,
        highestConfiguredRole,
      );
      await this.store.updateMilestoneRoleStatus(
        user.discordUserId,
        highestConfiguredRole.id,
        roleStatus,
        roleStatus === "granted" ? checkedAt : undefined,
      );
      highestRoleStatus = roleStatus;
    }

    for (const milestone of earnedMilestones) {
      if (milestone.id === highestConfiguredRole.id) {
        continue;
      }
      const existing = progressById.get(milestone.id);
      const desiredStatus = milestone.roleId ? "superseded" : "unconfigured";
      if (existing?.roleStatus === desiredStatus) {
        continue;
      }
      if (
        !milestone.roleId ||
        highestRoleStatus === "granted" ||
        highestRoleStatus === "superseded"
      ) {
        await this.store.updateMilestoneRoleStatus(
          user.discordUserId,
          milestone.id,
          desiredStatus,
        );
      }
    }

    await this.rewardManager.processUserRewards(user.discordUserId);
    await this.announceMilestone(user.discordUserId, newlyReached, earnedVoiceSeconds);
  }

  private async announceMilestone(
    discordUserId: string,
    milestone: MilestoneDefinition | undefined,
    totalSeconds: number,
  ): Promise<void> {
    if (!this.announcer || !milestone) {
      return;
    }
    try {
      await this.announcer.announce({ discordUserId, milestone, totalSeconds });
    } catch (error) {
      logger.error(
        { err: error, discordUserId, milestoneId: milestone.id },
        "Could not announce a reached milestone.",
      );
    }
  }

  private needsRoleSynchronization(
    progress: MilestoneProgressRecord,
  ): boolean {
    return (
      progress.roleStatus === "pending" ||
      progress.roleStatus === "missing" ||
      progress.roleStatus === "member_not_found" ||
      progress.roleStatus === "failed"
    );
  }
}
