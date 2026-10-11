import type { UserVoiceProgress } from "../milestones/types.js";
import type { EconomyConfig } from "./economy-config.js";
import type { EconomyStore } from "./store.js";

export interface VoiceProgressSource {
  getAllVoiceProgress(): Promise<UserVoiceProgress[]>;
}

type Log = {
  info(obj: unknown, message?: string): void;
  error(obj: unknown, message?: string): void;
};

const silentLog: Log = { info() {}, error() {} };

/**
 * Pays voice Dirhams: VOICE_REWARD_AMOUNT for every full
 * VOICE_REWARD_INTERVAL_MINUTES of voice time. It reads the same voice totals
 * the milestone system uses (stored time + the running session), so AFK
 * channels count exactly like every other voice channel. It never changes any
 * voice-time data.
 */
export class VoiceRewardManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private pauseDepth = 0;
  private readonly lastEvaluatedTotal = new Map<string, number>();

  constructor(
    private readonly source: VoiceProgressSource,
    private readonly store: EconomyStore,
    private readonly config: EconomyConfig,
    private readonly clock: () => Date = () => new Date(),
    private readonly log: Log = silentLog,
    private readonly currentSeason: () => number = () => 1,
  ) {}

  start(): void {
    if (this.timer || this.stopped || this.config.voiceRewardAmount < 1) {
      return;
    }
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.voiceRewardCheckIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.running;
  }

  /**
   * Runs `work` while no voice-reward pass is running or can start. A pass in
   * progress finishes first, so it cannot pay for voice time that a season
   * reset has just wiped.
   */
  async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    this.pauseDepth += 1;
    try {
      await this.running?.catch(() => undefined);
      return await work();
    } finally {
      // Totals changed while paused: forget what was evaluated before.
      this.lastEvaluatedTotal.clear();
      this.pauseDepth -= 1;
    }
  }

  /** One pass over every member. Overlapping passes are skipped. */
  runOnce(): Promise<void> {
    if (this.pauseDepth > 0) {
      return Promise.resolve();
    }
    if (this.running) {
      return this.running;
    }
    const pass = this.pass().finally(() => {
      if (this.running === pass) {
        this.running = null;
      }
    });
    this.running = pass;
    return pass;
  }

  private async pass(): Promise<void> {
    let users: UserVoiceProgress[];
    try {
      users = await this.source.getAllVoiceProgress();
    } catch (error) {
      this.log.error({ err: error }, "Voice rewards could not load voice-time totals.");
      return;
    }

    const now = this.clock();
    const intervalSeconds = this.config.voiceRewardIntervalMinutes * 60;
    for (const user of users) {
      if (this.stopped || this.pauseDepth > 0) {
        return;
      }
      const activeSeconds = user.activeSessionStartedAt
        ? Math.max(0, Math.floor((now.getTime() - user.activeSessionStartedAt.getTime()) / 1000))
        : 0;
      const total = user.totalVoiceTimeSeconds + activeSeconds;
      if (this.lastEvaluatedTotal.get(user.discordUserId) === total) {
        continue; // Nothing new to pay for since the last pass.
      }
      try {
        const result = await this.store.processVoiceReward({
          userId: user.discordUserId,
          totalSeconds: total,
          intervalSeconds,
          amountPerInterval: this.config.voiceRewardAmount,
          season: this.currentSeason(),
        });
        this.lastEvaluatedTotal.set(user.discordUserId, total);
        if (result.awarded > 0) {
          this.log.info(
            { discordUserId: user.discordUserId, awarded: result.awarded, intervals: result.intervals },
            "Voice reward paid.",
          );
        }
      } catch (error) {
        this.log.error(
          { err: error, discordUserId: user.discordUserId },
          "Voice reward failed for one member; it will be retried.",
        );
      }
    }
  }
}
