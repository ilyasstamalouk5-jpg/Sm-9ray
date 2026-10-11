import type { MilestoneDefinition } from "./types.js";

// A stored admin edit for one milestone. null = no override for that field.
export type MilestoneSettingRow = {
  milestoneId: string;
  requiredVoiceTimeSeconds: number | null;
  roleId: string | null;
};

export const MAX_MILESTONE_HOURS = 10_000;
export const MIN_MILESTONE_SECONDS = 60;

export function validateMilestones(
  milestones: readonly MilestoneDefinition[],
): void {
  const ids = new Set<string>();
  const roleIds = new Set<string>();
  let previousRequiredSeconds = 0;
  for (const milestone of milestones) {
    if (!milestone.id.trim() || ids.has(milestone.id)) {
      throw new Error("Milestone IDs must be non-empty and unique.");
    }
    if (
      !Number.isSafeInteger(milestone.requiredVoiceTimeSeconds) ||
      milestone.requiredVoiceTimeSeconds <= previousRequiredSeconds
    ) {
      throw new Error(
        "Milestone voice-time requirements must be increasing positive safe integers.",
      );
    }
    if (
      milestone.currencyRewardAmount !== null &&
      (!Number.isSafeInteger(milestone.currencyRewardAmount) ||
        milestone.currencyRewardAmount < 0)
    ) {
      throw new Error(
        `Currency reward for milestone ${milestone.id} must be a non-negative safe integer or null.`,
      );
    }
    if (milestone.roleId && roleIds.has(milestone.roleId)) {
      throw new Error("Each configured milestone must use a unique role ID.");
    }
    ids.add(milestone.id);
    if (milestone.roleId) {
      roleIds.add(milestone.roleId);
    }
    previousRequiredSeconds = milestone.requiredVoiceTimeSeconds;
  }
}

export function formatHoursLabel(seconds: number): string {
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))}h`;
}

export type MilestoneEdit = {
  milestoneId: string;
  hours?: number;
  roleId?: string;
};

export type MilestoneEditPlan =
  | {
      ok: true;
      previous: MilestoneDefinition;
      next: MilestoneDefinition;
    }
  | { ok: false; error: string };

/**
 * Checks an admin edit against the current milestone list and returns the
 * edited milestone. It never changes the list itself.
 */
export function planMilestoneEdit(
  definitions: readonly MilestoneDefinition[],
  edit: MilestoneEdit,
): MilestoneEditPlan {
  const index = definitions.findIndex(
    (milestone) => milestone.id === edit.milestoneId,
  );
  const previous = definitions[index];
  if (index < 0 || !previous) {
    return { ok: false, error: `Milestone ${edit.milestoneId} does not exist.` };
  }

  // Work on copies, so later changes to the live list can't alter the plan.
  const before = { ...previous };
  const next: MilestoneDefinition = { ...previous };

  if (edit.hours !== undefined) {
    if (
      !Number.isFinite(edit.hours) ||
      edit.hours <= 0 ||
      edit.hours > MAX_MILESTONE_HOURS
    ) {
      return {
        ok: false,
        error: `Hours must be more than 0 and at most ${MAX_MILESTONE_HOURS}.`,
      };
    }
    const seconds = Math.round(edit.hours * 3600);
    if (seconds < MIN_MILESTONE_SECONDS) {
      return { ok: false, error: "A milestone must be at least 1 minute." };
    }

    const lowerTier = definitions[index - 1];
    const upperTier = definitions[index + 1];
    const tooLow =
      lowerTier !== undefined && seconds <= lowerTier.requiredVoiceTimeSeconds;
    const tooHigh =
      upperTier !== undefined && seconds >= upperTier.requiredVoiceTimeSeconds;
    if (tooLow || tooHigh) {
      const rules: string[] = [];
      if (lowerTier) {
        rules.push(
          `more than tier ${lowerTier.id} (${formatHoursLabel(lowerTier.requiredVoiceTimeSeconds)})`,
        );
      }
      if (upperTier) {
        rules.push(
          `less than tier ${upperTier.id} (${formatHoursLabel(upperTier.requiredVoiceTimeSeconds)})`,
        );
      }
      return {
        ok: false,
        error: `Tier ${previous.id} must be ${rules.join(" and ")}. Change the neighbouring tier first if you need a bigger jump.`,
      };
    }
    next.requiredVoiceTimeSeconds = seconds;
  }

  if (edit.roleId !== undefined) {
    if (!/^\d{17,20}$/.test(edit.roleId)) {
      return { ok: false, error: "That does not look like a valid Discord role." };
    }
    const other = definitions.find(
      (milestone) => milestone.id !== previous.id && milestone.roleId === edit.roleId,
    );
    if (other) {
      return {
        ok: false,
        error: `That role is already used for tier ${other.id}. Each tier needs its own role.`,
      };
    }
    next.roleId = edit.roleId;
  }

  return { ok: true, previous: before, next };
}

export type ApplySettingsResult =
  | { applied: true; count: number }
  | { applied: false; reason: string };

/**
 * Applies stored admin edits on top of the default milestone list, in place.
 * If the combined result would be invalid, nothing is changed and the reason
 * is returned, so a bad stored value can never stop the bot from starting.
 */
export function applyMilestoneSettings(
  definitions: MilestoneDefinition[],
  rows: readonly MilestoneSettingRow[],
): ApplySettingsResult {
  const candidate = definitions.map((milestone) => ({ ...milestone }));
  let count = 0;
  for (const row of rows) {
    const target = candidate.find((milestone) => milestone.id === row.milestoneId);
    if (!target) {
      continue;
    }
    if (row.requiredVoiceTimeSeconds !== null) {
      target.requiredVoiceTimeSeconds = row.requiredVoiceTimeSeconds;
    }
    if (row.roleId !== null) {
      target.roleId = row.roleId;
    }
    count += 1;
  }

  try {
    validateMilestones(candidate);
  } catch (error) {
    return {
      applied: false,
      reason: error instanceof Error ? error.message : "Invalid milestone settings.",
    };
  }

  definitions.forEach((milestone, index) => {
    const edited = candidate[index];
    if (edited) {
      milestone.requiredVoiceTimeSeconds = edited.requiredVoiceTimeSeconds;
      milestone.roleId = edited.roleId;
    }
  });
  return { applied: true, count };
}
