import assert from "node:assert/strict";
import test from "node:test";
import {
  MilestoneManager,
  type MilestoneAnnouncement,
} from "../src/milestones/milestone-manager.js";
import type {
  MilestoneDefinition,
  MilestoneProgressRecord,
  MilestoneStore,
  UserVoiceProgress,
} from "../src/milestones/types.js";

const MILESTONES: MilestoneDefinition[] = [1, 2, 4, 8].map((hours, index) => ({
  id: String(index + 1),
  requiredVoiceTimeSeconds: hours * 3600,
  roleId: `role-${index + 1}`,
  currencyRewardAmount: 100,
}));

function setup(announce: (event: MilestoneAnnouncement) => Promise<void>) {
  const progress = new Map<string, UserVoiceProgress>();
  const records = new Map<string, Map<string, MilestoneProgressRecord>>();
  const store = {
    getAllVoiceProgress: async () => [...progress.values()],
    getMilestoneProgress: async (userId: string) => [...(records.get(userId)?.values() ?? [])],
    recordReachedMilestones: async (userId: string, milestones: readonly MilestoneDefinition[]) => {
      const user = records.get(userId) ?? new Map();
      records.set(userId, user);
      for (const m of milestones) {
        user.set(m.id, {
          discordUserId: userId, milestoneId: m.id, requiredVoiceTimeSeconds: m.requiredVoiceTimeSeconds,
          roleId: m.roleId, currencyRewardAmount: m.currencyRewardAmount, reachedAt: new Date(),
          roleStatus: "granted", roleGrantedAt: new Date(), rewardStatus: "issued", rewardProcessingAt: null,
          rewardAttempts: 0, claimedAt: null, rewardLastError: null,
        });
      }
    },
    updateMilestoneRoleStatus: async () => {},
  } as unknown as MilestoneStore;
  const manager = new MilestoneManager(
    store,
    { assignHighestMilestoneRole: async () => "granted" } as never,
    { processUserRewards: async () => {} } as never,
    MILESTONES,
    30_000,
    undefined,
    { announce },
  );
  return { progress, records, manager };
}

test("only the highest newly reached milestone is announced, once", async () => {
  const events: MilestoneAnnouncement[] = [];
  const { progress, manager } = setup(async (event) => void events.push(event));
  progress.set("u1", { discordUserId: "u1", totalVoiceTimeSeconds: 5 * 3600, activeSessionStartedAt: null });

  await manager.checkAllUsers();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.milestone.id, "3"); // 4h is the highest reached at 5h
  assert.equal(events[0]?.totalSeconds, 5 * 3600);

  await manager.checkAllUsers();
  await manager.checkAllUsers();
  assert.equal(events.length, 1);

  progress.set("u1", { discordUserId: "u1", totalVoiceTimeSeconds: 8 * 3600, activeSessionStartedAt: null });
  await manager.checkAllUsers();
  assert.equal(events.length, 2);
  assert.equal(events[1]?.milestone.id, "4");
});

test("milestones that were already recorded before this feature are never announced", async () => {
  const events: MilestoneAnnouncement[] = [];
  const { progress, manager, records } = setup(async (event) => void events.push(event));
  progress.set("old", { discordUserId: "old", totalVoiceTimeSeconds: 5 * 3600, activeSessionStartedAt: null });
  const existing = new Map();
  for (const m of MILESTONES.slice(0, 3)) {
    existing.set(m.id, { milestoneId: m.id, requiredVoiceTimeSeconds: m.requiredVoiceTimeSeconds, roleId: m.roleId,
      currencyRewardAmount: m.currencyRewardAmount, roleStatus: "granted", rewardStatus: "issued" });
  }
  records.set("old", existing);
  await manager.checkAllUsers();
  assert.equal(events.length, 0);
});

test("a failing announcement never breaks the milestone check", async () => {
  let calls = 0;
  const { progress, manager, records } = setup(async () => {
    calls += 1;
    throw new Error("channel deleted");
  });
  progress.set("u1", { discordUserId: "u1", totalVoiceTimeSeconds: 2 * 3600, activeSessionStartedAt: null });
  await manager.checkAllUsers();
  assert.equal(calls, 1);
  assert.equal(records.get("u1")?.size, 2); // milestones were still recorded
  await manager.checkAllUsers();
  assert.equal(calls, 1);
});
