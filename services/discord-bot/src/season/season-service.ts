import { logger } from "../config/logger.js";

export type SeasonResetPreview = {
  /** The season members are in right now (1 before the first reset). */
  season: number;
  /** Members who have any voice time, XP or milestone progress to wipe. */
  members: number;
  milestoneRecords: number;
  activeSessions: number;
};

export type SeasonResetResult = SeasonResetPreview;

export interface SeasonStore {
  getCurrentSeason(): Promise<number>;
  getResetPreview(): Promise<SeasonResetPreview>;
  /** Wipes study progress in one transaction. Never touches wallets or the shop. */
  resetProgress(startedBy: string): Promise<SeasonResetResult>;
}

export type RoleStripResult = {
  removed: number;
  failed: number;
  /** Role IDs that no longer exist in the server. */
  missingRoleIds: string[];
};

export interface SeasonRoleOperations {
  /** Takes each of these roles away from every member who has it. */
  stripRoles(roleIds: readonly string[]): Promise<RoleStripResult>;
}

/** A background job that can be paused while a reset is running. */
export interface Pausable {
  runExclusive<T>(work: () => Promise<T>): Promise<T>;
}

export type SeasonResetOutcome = {
  season: number;
  members: number;
  milestoneRecords: number;
  activeSessions: number;
  roles: RoleStripResult;
  /** Role IDs that were deliberately skipped because the shop sells them. */
  protectedRoleIds: string[];
  /** The roles the reset tried to strip. */
  strippedRoleIds: string[];
};

export class SeasonResetInProgressError extends Error {
  constructor() {
    super("A season reset is already running.");
    this.name = "SeasonResetInProgressError";
  }
}

export type SeasonServiceDeps = {
  store: SeasonStore;
  roles: SeasonRoleOperations;
  /** Background jobs that read voice time (milestones, voice rewards). */
  pausables: readonly Pausable[];
  /** The study (milestone) role IDs currently configured. */
  milestoneRoleIds: () => readonly (string | null)[];
  /**
   * Role IDs that must never be removed: color roles the shop sells (past or
   * present) and the admin role. Color roles are not study roles, but if one
   * were ever configured as both, the shop role wins.
   */
  protectedRoleIds: () => Promise<readonly string[]>;
};

/**
 * Season reset: every student starts again from milestones and study roles.
 * Wallets, the wallet ledger, shop items and owned color roles are untouched.
 */
export class SeasonService {
  private running = false;
  private season = 1;

  constructor(private readonly deps: SeasonServiceDeps) {}

  /** The season in progress, as of the last load or reset. */
  get currentSeason(): number {
    return this.season;
  }

  async load(): Promise<void> {
    this.season = await this.deps.store.getCurrentSeason();
  }

  async preview(): Promise<SeasonResetPreview> {
    const preview = await this.deps.store.getResetPreview();
    this.season = preview.season;
    return preview;
  }

  async reset(startedBy: string): Promise<SeasonResetOutcome> {
    if (this.running) {
      throw new SeasonResetInProgressError();
    }
    this.running = true;
    try {
      return await this.runPaused(async () => {
        // Database first. If it fails nothing has changed, roles included.
        const stored = await this.deps.store.resetProgress(startedBy);
        this.season = stored.season;

        const protectedIds = new Set(await this.deps.protectedRoleIds());
        const studyRoleIds = [
          ...new Set(
            this.deps.milestoneRoleIds().filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
          ),
        ];
        const strippedRoleIds = studyRoleIds.filter((id) => !protectedIds.has(id));
        const protectedRoleIds = studyRoleIds.filter((id) => protectedIds.has(id));

        let roles: RoleStripResult = { removed: 0, failed: 0, missingRoleIds: [] };
        try {
          roles = await this.deps.roles.stripRoles(strippedRoleIds);
        } catch (error) {
          // The progress reset already happened and must not be reported as
          // failed. Say that the roles still need attention.
          logger.error(
            { err: error },
            "Season reset: progress was wiped but the study roles could not be removed.",
          );
          roles = { removed: 0, failed: -1, missingRoleIds: [] };
        }

        logger.info(
          {
            startedBy,
            season: stored.season,
            members: stored.members,
            milestoneRecords: stored.milestoneRecords,
            rolesRemoved: roles.removed,
            rolesFailed: roles.failed,
          },
          "Season reset finished.",
        );
        return {
          season: stored.season,
          members: stored.members,
          milestoneRecords: stored.milestoneRecords,
          activeSessions: stored.activeSessions,
          roles,
          protectedRoleIds,
          strippedRoleIds,
        };
      });
    } finally {
      this.running = false;
    }
  }

  private runPaused<T>(work: () => Promise<T>): Promise<T> {
    return this.deps.pausables.reduceRight<() => Promise<T>>(
      (inner, pausable) => () => pausable.runExclusive(inner),
      work,
    )();
  }
}
