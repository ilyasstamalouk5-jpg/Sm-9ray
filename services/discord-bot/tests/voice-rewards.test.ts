import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import { VoiceRewardManager } from "../src/economy/voice-rewards.js";
import type { UserVoiceProgress } from "../src/milestones/types.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

const MIN = 60;
function setup() {
  const store = new MemoryEconomyStore(0);
  const state = {
    users: [] as UserVoiceProgress[],
    now: new Date("2026-01-01T12:00:00Z"),
  };
  const make = () =>
    new VoiceRewardManager(
      { getAllVoiceProgress: async () => state.users },
      store,
      loadEconomyConfig({}),
      () => state.now,
    );
  return { store, state, manager: make(), make };
}
const user = (total: number, activeStartedAt: Date | null = null): UserVoiceProgress => ({
  discordUserId: "u1",
  totalVoiceTimeSeconds: total,
  activeSessionStartedAt: activeStartedAt,
});

test("exactly 50 DH is paid for each full 60 minutes", async () => {
  const { store, state, manager } = setup();
  state.users = [user(59 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 0);

  state.users = [user(60 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50);

  state.users = [user(180 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 150);
});

test("the leftover minutes carry over to the next interval", async () => {
  const { store, state, manager } = setup();
  state.users = [user(90 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50); // 30 minutes carried
  state.users = [user(119 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50);
  state.users = [user(120 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 100);
});

test("the running session counts, in any voice channel including AFK", async () => {
  // The manager only sees time totals, never channel names, so a session in
  // an AFK channel is counted exactly like any other.
  const { store, state, manager } = setup();
  state.users = [user(0, new Date(state.now.getTime() - 61 * MIN * 1000))];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50);
});

test("repeated passes, and simultaneous passes, never pay twice", async () => {
  const { store, state, manager } = setup();
  state.users = [user(60 * MIN)];
  await Promise.all([manager.runOnce(), manager.runOnce(), manager.runOnce()]);
  await manager.runOnce();
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50);
});

test("a restart (new manager, same storage) does not pay again and keeps the remainder", async () => {
  const { store, state, manager, make } = setup();
  state.users = [user(90 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50);

  const restarted = make();
  await restarted.runOnce();
  assert.equal(await store.getBalance("u1"), 50);
  state.users = [user(120 * MIN)]; // the carried 30 minutes + 30 more
  await restarted.runOnce();
  assert.equal(await store.getBalance("u1"), 100);
});

test("two managers racing on the same storage still pay once", async () => {
  const { store, state, make } = setup();
  state.users = [user(60 * MIN)];
  await Promise.all([make().runOnce(), make().runOnce()]);
  assert.equal(await store.getBalance("u1"), 50);
});

test("lowering a member's voice time never removes Dirhams", async () => {
  const { store, state, manager } = setup();
  state.users = [user(120 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 100);
  state.users = [user(30 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 100);
  state.users = [user(90 * MIN)]; // earns normally again from the lowered baseline
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 150);
});

test("after a season reset, members are paid again for the same voice time", async () => {
  const store = new MemoryEconomyStore(0);
  let season = 1;
  const state = { users: [] as UserVoiceProgress[] };
  const manager = new VoiceRewardManager(
    { getAllVoiceProgress: async () => state.users },
    store,
    loadEconomyConfig({}),
    () => new Date("2026-01-01T12:00:00Z"),
    undefined,
    () => season,
  );

  state.users = [user(60 * MIN)];
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50); // season 1

  // The reset: voice time and the reward checkpoint go back to zero.
  season = 2;
  store.checkpoints.set("u1", 0);
  state.users = [user(0)];
  await manager.runExclusive(async () => undefined);
  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 50);

  state.users = [user(60 * MIN)];
  await manager.runOnce();
  // Same voice time as season 1, but the wallet is credited again and the
  // Dirhams from season 1 are still there.
  assert.equal(await store.getBalance("u1"), 100);
});

test("runExclusive stops a running pass from paying and blocks new passes", async () => {
  const store = new MemoryEconomyStore(0);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const manager = new VoiceRewardManager(
    {
      getAllVoiceProgress: async () => {
        await gate;
        return [user(120 * MIN)];
      },
    },
    store,
    loadEconomyConfig({}),
  );

  const pass = manager.runOnce();
  const exclusive = manager.runExclusive(async () => {
    await manager.runOnce(); // ignored while paused
    return "ok";
  });
  release();
  assert.equal(await exclusive, "ok");
  await pass;
  // The pass had already loaded its totals, but it saw the pause before
  // paying anyone, so nothing was paid for the pre-reset time.
  assert.equal(await store.getBalance("u1"), 0);

  await manager.runOnce();
  assert.equal(await store.getBalance("u1"), 100);
});
