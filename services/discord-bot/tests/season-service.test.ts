import assert from "node:assert/strict";
import test from "node:test";
import {
  SeasonResetInProgressError,
  SeasonService,
  type Pausable,
  type RoleStripResult,
  type SeasonResetPreview,
  type SeasonResetResult,
  type SeasonRoleOperations,
  type SeasonStore,
} from "../src/season/season-service.js";

const ADMIN = "300000000000000001";

class FakeStore implements SeasonStore {
  season = 1;
  fail = false;
  log: string[];
  constructor(log: string[]) {
    this.log = log;
  }
  async getCurrentSeason() {
    return this.season;
  }
  async getResetPreview(): Promise<SeasonResetPreview> {
    return { season: this.season, members: 4, milestoneRecords: 9, activeSessions: 1 };
  }
  async resetProgress(startedBy: string): Promise<SeasonResetResult> {
    this.log.push(`db:${startedBy}`);
    if (this.fail) {
      throw new Error("db down");
    }
    this.season += 1;
    return { season: this.season, members: 4, milestoneRecords: 9, activeSessions: 1 };
  }
}

class FakeRoles implements SeasonRoleOperations {
  stripped: string[][] = [];
  result: RoleStripResult = { removed: 7, failed: 0, missingRoleIds: [] };
  throws = false;
  constructor(private readonly log: string[]) {}
  async stripRoles(roleIds: readonly string[]) {
    this.log.push("roles");
    this.stripped.push([...roleIds]);
    if (this.throws) {
      throw new Error("discord down");
    }
    return this.result;
  }
}

function pausable(name: string, log: string[]): Pausable {
  return {
    async runExclusive<T>(work: () => Promise<T>) {
      log.push(`pause:${name}`);
      try {
        return await work();
      } finally {
        log.push(`resume:${name}`);
      }
    },
  };
}

function setup(options: { protectedIds?: string[]; roleIds?: Array<string | null> } = {}) {
  const log: string[] = [];
  const store = new FakeStore(log);
  const roles = new FakeRoles(log);
  const service = new SeasonService({
    store,
    roles,
    pausables: [pausable("milestones", log), pausable("rewards", log)],
    milestoneRoleIds: () => options.roleIds ?? ["r1", "r2", null, "r2", "r3"],
    protectedRoleIds: async () => options.protectedIds ?? [],
  });
  return { log, store, roles, service };
}

test("reset wipes progress while both background jobs are paused, then strips study roles", async () => {
  const { log, roles, service } = setup();
  const outcome = await service.reset(ADMIN);

  assert.deepEqual(log, [
    "pause:milestones",
    "pause:rewards",
    `db:${ADMIN}`,
    "roles",
    "resume:rewards",
    "resume:milestones",
  ]);
  // Unconfigured (null) and duplicate role IDs are dropped.
  assert.deepEqual(roles.stripped, [["r1", "r2", "r3"]]);
  assert.equal(outcome.season, 2);
  assert.equal(outcome.members, 4);
  assert.equal(outcome.roles.removed, 7);
  assert.equal(service.currentSeason, 2);
});

test("a role the shop sells is never stripped, even if it is also a study role", async () => {
  const { roles, service } = setup({ protectedIds: ["r2"] });
  const outcome = await service.reset(ADMIN);
  assert.deepEqual(roles.stripped, [["r1", "r3"]]);
  assert.deepEqual(outcome.protectedRoleIds, ["r2"]);
});

test("if the database reset fails nothing else changes", async () => {
  const { log, store, roles, service } = setup();
  store.fail = true;
  await assert.rejects(() => service.reset(ADMIN), /db down/);
  assert.equal(roles.stripped.length, 0);
  assert.equal(service.currentSeason, 1);
  // The background jobs are resumed even though the reset failed.
  assert.deepEqual(log.slice(-2), ["resume:rewards", "resume:milestones"]);
});

test("if only the role removal fails, the reset still counts and says so", async () => {
  const { roles, service } = setup();
  roles.throws = true;
  const outcome = await service.reset(ADMIN);
  assert.equal(outcome.season, 2);
  assert.equal(outcome.roles.failed, -1);
  assert.equal(service.currentSeason, 2);
});

test("a second reset while one is running is refused", async () => {
  const { service } = setup();
  const first = service.reset(ADMIN);
  await assert.rejects(() => service.reset(ADMIN), SeasonResetInProgressError);
  await first;
  // And it can run again once the first has finished.
  const third = await service.reset(ADMIN);
  assert.equal(third.season, 3);
});

test("preview changes nothing", async () => {
  const { log, roles, service } = setup();
  const preview = await service.preview();
  assert.equal(preview.members, 4);
  assert.deepEqual(log, []);
  assert.equal(roles.stripped.length, 0);
});
