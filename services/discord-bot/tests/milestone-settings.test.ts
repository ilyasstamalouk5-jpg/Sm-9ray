import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMilestoneSettings,
  planMilestoneEdit,
} from "../src/milestones/milestone-settings.js";
import type { MilestoneDefinition } from "../src/milestones/types.js";

const ROLE_A = "200000000000000001";
const ROLE_B = "200000000000000002";
const ROLE_C = "200000000000000003";
const NEW_ROLE = "200000000000000099";

function createDefinitions(): MilestoneDefinition[] {
  const hours = [1, 2, 4, 8];
  return hours.map((value, index) => ({
    id: String(index + 1),
    requiredVoiceTimeSeconds: value * 3600,
    roleId: [ROLE_A, ROLE_B, ROLE_C, null][index] ?? null,
    currencyRewardAmount: null,
  }));
}

test("a valid hours edit returns the new value without changing the list", () => {
  const definitions = createDefinitions();
  const plan = planMilestoneEdit(definitions, { milestoneId: "3", hours: 5 });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.next.requiredVoiceTimeSeconds, 5 * 3600);
    assert.equal(plan.previous.requiredVoiceTimeSeconds, 4 * 3600);
  }
  assert.equal(definitions[2]?.requiredVoiceTimeSeconds, 4 * 3600);
});

test("decimal hours are converted to whole seconds", () => {
  const plan = planMilestoneEdit(createDefinitions(), {
    milestoneId: "2",
    hours: 1.5,
  });
  assert.equal(plan.ok && plan.next.requiredVoiceTimeSeconds, 5400);
});

test("hours must stay between the neighbouring tiers", () => {
  const definitions = createDefinitions();
  const tooHigh = planMilestoneEdit(definitions, { milestoneId: "3", hours: 8 });
  const tooLow = planMilestoneEdit(definitions, { milestoneId: "3", hours: 2 });
  assert.equal(tooHigh.ok, false);
  assert.equal(tooLow.ok, false);
  if (!tooHigh.ok) {
    assert.match(tooHigh.error, /tier 2/);
    assert.match(tooHigh.error, /tier 4/);
  }
});

test("the first and last tier only have one neighbour to respect", () => {
  const definitions = createDefinitions();
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "1", hours: 0.5 }).ok, true);
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "1", hours: 2 }).ok, false);
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "4", hours: 500 }).ok, true);
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "4", hours: 4 }).ok, false);
});

test("nonsense hours are rejected", () => {
  const definitions = createDefinitions();
  for (const hours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 10_001, 0.001]) {
    assert.equal(planMilestoneEdit(definitions, { milestoneId: "4", hours }).ok, false, String(hours));
  }
});

test("an unknown tier is rejected", () => {
  assert.equal(planMilestoneEdit(createDefinitions(), { milestoneId: "9", hours: 3 }).ok, false);
});

test("a role edit needs a valid, unused role", () => {
  const definitions = createDefinitions();
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "4", roleId: NEW_ROLE }).ok, true);
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "4", roleId: "not-a-role" }).ok, false);
  const duplicate = planMilestoneEdit(definitions, { milestoneId: "4", roleId: ROLE_A });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.match(duplicate.error, /tier 1/);
  }
  // Re-picking a tier's own role is not a duplicate.
  assert.equal(planMilestoneEdit(definitions, { milestoneId: "1", roleId: ROLE_A }).ok, true);
});

test("saved settings are applied on top of the defaults", () => {
  const definitions = createDefinitions();
  const result = applyMilestoneSettings(definitions, [
    { milestoneId: "3", requiredVoiceTimeSeconds: 5 * 3600, roleId: null },
    { milestoneId: "4", requiredVoiceTimeSeconds: null, roleId: NEW_ROLE },
    { milestoneId: "77", requiredVoiceTimeSeconds: 1, roleId: null },
  ]);
  assert.deepEqual(result, { applied: true, count: 2 });
  assert.equal(definitions[2]?.requiredVoiceTimeSeconds, 5 * 3600);
  assert.equal(definitions[2]?.roleId, ROLE_C);
  assert.equal(definitions[3]?.roleId, NEW_ROLE);
  assert.equal(definitions[3]?.requiredVoiceTimeSeconds, 8 * 3600);
});

test("invalid saved settings change nothing", () => {
  const definitions = createDefinitions();
  const before = JSON.stringify(definitions);
  const result = applyMilestoneSettings(definitions, [
    { milestoneId: "2", requiredVoiceTimeSeconds: 9 * 3600, roleId: null },
  ]);
  assert.equal(result.applied, false);
  assert.equal(JSON.stringify(definitions), before);

  const duplicateRole = applyMilestoneSettings(definitions, [
    { milestoneId: "4", requiredVoiceTimeSeconds: null, roleId: ROLE_A },
  ]);
  assert.equal(duplicateRole.applied, false);
  assert.equal(JSON.stringify(definitions), before);
});
