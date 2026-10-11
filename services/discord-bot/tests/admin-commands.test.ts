import assert from "node:assert/strict";
import test from "node:test";
import type { ChatInputCommandInteraction } from "discord.js";
import {
  handleAdminCommand,
  type AdminCommandDeps,
  type VoiceTimeAdjustMode,
} from "../src/commands/admin-commands.js";
import type { MilestoneDefinition } from "../src/milestones/types.js";
import {
  SeasonResetInProgressError,
  type SeasonResetOutcome,
} from "../src/season/season-service.js";

const ADMIN_ID = "300000000000000001";
const TARGET_ID = "300000000000000002";
const GUILD_ID = "300000000000000010";
const ROLE_1 = "400000000000000001";
const ROLE_2 = "400000000000000002";
const ROLE_3 = "400000000000000003";
const NEW_ROLE = "400000000000000099";

function createDefinitions(): MilestoneDefinition[] {
  const hours = [1, 2, 4, 8];
  const roles: Array<string | null> = [ROLE_1, ROLE_2, ROLE_3, null];
  return hours.map((value, index) => ({
    id: String(index + 1),
    requiredVoiceTimeSeconds: value * 3600,
    roleId: roles[index] ?? null,
    currencyRewardAmount: null,
  }));
}

type FakeMember = { id: string; removed: string[]; fail?: boolean };

function createRole(id: string, options: { managed?: boolean; editable?: boolean; members?: FakeMember[] } = {}) {
  const members = new Map<string, unknown>();
  for (const member of options.members ?? []) {
    members.set(member.id, {
      id: member.id,
      roles: {
        remove: async () => {
          if (member.fail) {
            throw new Error("denied");
          }
          member.removed.push(id);
        },
      },
    });
  }
  return { id, managed: options.managed ?? false, editable: options.editable ?? true, members };
}

function createGuild(roles: Array<ReturnType<typeof createRole>>) {
  const cache = new Map(roles.map((role) => [role.id, role]));
  return {
    id: GUILD_ID,
    roles: { cache, fetch: async (id: string) => cache.get(id) ?? null },
    members: { fetch: async () => undefined },
  };
}

function createInteraction(input: {
  subcommand: string;
  options?: Record<string, unknown>;
  isAdmin?: boolean;
  guild?: ReturnType<typeof createGuild> | null;
}) {
  const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
  let deferred = false;
  const options = input.options ?? {};
  const interaction = {
    commandName: "voiceadmin",
    user: { id: ADMIN_ID },
    guild: input.guild === undefined ? createGuild([]) : input.guild,
    memberPermissions: { has: () => input.isAdmin ?? true },
    get deferred() { return deferred; },
    replied: false,
    options: {
      getSubcommand: () => input.subcommand,
      getUser: (name: string) => options[name],
      getNumber: (name: string) => options[name],
      getInteger: (name: string) => options[name],
      getRole: (name: string) => options[name],
      getBoolean: (name: string) => options[name] ?? null,
      getString: (name: string) => (options[name] as string | undefined) ?? null,
    },
    reply: async (payload: { content?: string; ephemeral?: boolean }) => { replies.push(payload); },
    deferReply: async () => { deferred = true; },
    editReply: async (payload: { content?: string }) => { replies.push(payload); },
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, replies };
}

function createDeps(definitions = createDefinitions()) {
  const calls = {
    adjust: [] as Array<{ id: string; mode: VoiceTimeAdjustMode; seconds: number }>,
    saved: [] as Array<{ milestoneId: string; requiredVoiceTimeSeconds?: number; roleId?: string; updatedBy: string }>,
    rechecks: 0,
    seasonResets: [] as string[],
    seasonPreviews: 0,
  };
  let failAdjust = false;
  let seasonOutcome: Partial<SeasonResetOutcome> = {};
  let seasonError: Error | null = null;
  const deps: AdminCommandDeps = {
    definitions,
    adjustUserVoiceTime: async (id, mode, seconds) => {
      if (failAdjust) {
        throw new Error("db down");
      }
      calls.adjust.push({ id, mode, seconds });
      return { before: 3600, after: mode === "add" ? 3600 + seconds : 0 };
    },
    saveMilestoneSetting: async (input) => { calls.saved.push(input); },
    recheckMilestones: async () => { calls.rechecks += 1; },
    season: {
      preview: async () => {
        calls.seasonPreviews += 1;
        return { season: 1, members: 12, milestoneRecords: 30, activeSessions: 2 };
      },
      reset: async (startedBy) => {
        calls.seasonResets.push(startedBy);
        if (seasonError) {
          throw seasonError;
        }
        return {
          season: 2,
          members: 12,
          milestoneRecords: 30,
          activeSessions: 2,
          roles: { removed: 20, failed: 0, missingRoleIds: [] },
          protectedRoleIds: [],
          strippedRoleIds: [ROLE_1, ROLE_2, ROLE_3],
          ...seasonOutcome,
        };
      },
    },
  };
  return {
    deps,
    calls,
    failAdjustNext: () => { failAdjust = true; },
    setSeasonOutcome: (outcome: Partial<SeasonResetOutcome>) => { seasonOutcome = outcome; },
    failSeasonWith: (error: Error) => { seasonError = error; },
  };
}

test("non-admins are refused and nothing changes", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "time-add",
    isAdmin: false,
    options: { user: { id: TARGET_ID, bot: false }, hours: 1 },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /administrators/);
  assert.equal(replies[0]?.ephemeral, true);
  assert.equal(calls.adjust.length, 0);
});

test("the command only works inside a server", async () => {
  const { deps } = createDeps();
  const { interaction, replies } = createInteraction({ subcommand: "milestones", guild: null });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /server/);
});

test("time-add converts hours to seconds and re-checks milestones", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "time-add",
    options: { user: { id: TARGET_ID, bot: false }, hours: 1.5 },
  });
  await handleAdminCommand(interaction, deps);
  assert.deepEqual(calls.adjust, [{ id: TARGET_ID, mode: "add", seconds: 5400 }]);
  assert.equal(calls.rechecks, 1);
  assert.match(replies[0]?.content ?? "", /1h 30m/);
  assert.match(replies[0]?.content ?? "", new RegExp(TARGET_ID));
});

test("time-remove and time-set use their own modes", async () => {
  const { deps, calls } = createDeps();
  for (const subcommand of ["time-remove", "time-set"]) {
    const { interaction } = createInteraction({
      subcommand,
      options: { user: { id: TARGET_ID, bot: false }, hours: 2 },
    });
    await handleAdminCommand(interaction, deps);
  }
  assert.deepEqual(calls.adjust.map((call) => call.mode), ["remove", "set"]);
});

test("bots cannot be given voice time", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "time-add",
    options: { user: { id: TARGET_ID, bot: true }, hours: 1 },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /Bots/);
  assert.equal(calls.adjust.length, 0);
});

test("a database failure gives a safe message", async () => {
  const { deps, failAdjustNext } = createDeps();
  failAdjustNext();
  const { interaction, replies } = createInteraction({
    subcommand: "time-add",
    options: { user: { id: TARGET_ID, bot: false }, hours: 1 },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /Something went wrong/);
});

test("milestone-time saves the change and updates the live list", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "milestone-time",
    options: { tier: 3, hours: 5 },
  });
  await handleAdminCommand(interaction, deps);
  assert.equal(deps.definitions[2]?.requiredVoiceTimeSeconds, 5 * 3600);
  assert.deepEqual(calls.saved, [
    { milestoneId: "3", requiredVoiceTimeSeconds: 5 * 3600, updatedBy: ADMIN_ID },
  ]);
  assert.equal(calls.rechecks, 1);
  assert.match(replies[0]?.content ?? "", /now needs \*\*5h\*\*/);
  assert.match(replies[0]?.content ?? "", /was 4h/);
});

test("milestone-time rejects values outside the neighbouring tiers", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "milestone-time",
    options: { tier: 3, hours: 9 },
  });
  await handleAdminCommand(interaction, deps);
  assert.equal(deps.definitions[2]?.requiredVoiceTimeSeconds, 4 * 3600);
  assert.equal(calls.saved.length, 0);
  assert.match(replies[0]?.content ?? "", /tier 4/);
});

test("milestone-role saves the change and keeps the old role by default", async () => {
  const holder: FakeMember = { id: TARGET_ID, removed: [] };
  const oldRole = createRole(ROLE_3, { members: [holder] });
  const newRole = createRole(NEW_ROLE);
  const guild = createGuild([oldRole, newRole]);
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "milestone-role",
    guild,
    options: { tier: 3, role: { id: NEW_ROLE } },
  });
  await handleAdminCommand(interaction, deps);
  assert.equal(deps.definitions[2]?.roleId, NEW_ROLE);
  assert.deepEqual(calls.saved, [{ milestoneId: "3", roleId: NEW_ROLE, updatedBy: ADMIN_ID }]);
  assert.deepEqual(holder.removed, []);
  assert.match(replies[0]?.content ?? "", /keep it/);
  assert.match(replies[0]?.content ?? "", new RegExp(`was <@&${ROLE_3}>`));
});

test("milestone-role can remove the old role from its holders", async () => {
  const good: FakeMember = { id: "500000000000000001", removed: [] };
  const bad: FakeMember = { id: "500000000000000002", removed: [], fail: true };
  const oldRole = createRole(ROLE_3, { members: [good, bad] });
  const guild = createGuild([oldRole, createRole(NEW_ROLE)]);
  const { deps } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "milestone-role",
    guild,
    options: { tier: 3, role: { id: NEW_ROLE }, remove_old: true },
  });
  await handleAdminCommand(interaction, deps);
  assert.deepEqual(good.removed, [ROLE_3]);
  assert.match(replies[0]?.content ?? "", /1 member/);
  assert.match(replies[0]?.content ?? "", /1 could not/);
});

test("milestone-role refuses unusable roles", async () => {
  const cases: Array<[string, ReturnType<typeof createRole>, RegExp]> = [
    ["managed", createRole(NEW_ROLE, { managed: true }), /bot or integration/],
    ["not editable", createRole(NEW_ROLE, { editable: false }), /Manage Roles/],
    ["already used", createRole(ROLE_1), /tier 1/],
    ["everyone", createRole(GUILD_ID), /everyone/],
  ];
  for (const [label, role, pattern] of cases) {
    const guild = createGuild([role as ReturnType<typeof createRole>]);
    const { deps, calls } = createDeps();
    const { interaction, replies } = createInteraction({
      subcommand: "milestone-role",
      guild,
      options: { tier: 4, role: { id: role.id } },
    });
    await handleAdminCommand(interaction, deps);
    assert.match(replies[0]?.content ?? "", pattern, label);
    assert.equal(calls.saved.length, 0, label);
  }
});

test("milestones lists every tier", async () => {
  const { deps } = createDeps();
  const { interaction, replies } = createInteraction({ subcommand: "milestones" });
  await handleAdminCommand(interaction, deps);
  const content = replies[0]?.content ?? "";
  for (const tier of ["1", "2", "3", "4"]) {
    assert.match(content, new RegExp(`Tier ${tier} `));
  }
  assert.match(content, /no role set/);
});

test("season-reset without the confirmation word only previews", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({ subcommand: "season-reset" });
  await handleAdminCommand(interaction, deps);
  assert.equal(calls.seasonResets.length, 0);
  assert.equal(calls.seasonPreviews, 1);
  const text = replies[0]?.content ?? "";
  assert.match(text, /preview/i);
  assert.match(text, /\*\*12\*\* member/);
  assert.match(text, /season 1 → 2/);
  assert.match(text, /confirm:RESET/);
  assert.match(text, new RegExp(`<@&${ROLE_1}>`));
  // The reassurance about what stays untouched is part of the preview.
  assert.match(text, /wallets/);
  assert.match(text, /color roles/);
});

test("season-reset with a wrong word changes nothing and says so", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "yes" },
  });
  await handleAdminCommand(interaction, deps);
  assert.equal(calls.seasonResets.length, 0);
  assert.match(replies[0]?.content ?? "", /not the confirmation word/);
});

test("season-reset is case sensitive so it cannot be run by accident", async () => {
  const { deps, calls } = createDeps();
  const { interaction } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "reset" },
  });
  await handleAdminCommand(interaction, deps);
  assert.equal(calls.seasonResets.length, 0);
});

test("non-admins cannot reset the season", async () => {
  const { deps, calls } = createDeps();
  const { interaction } = createInteraction({
    subcommand: "season-reset",
    isAdmin: false,
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  assert.equal(calls.seasonResets.length, 0);
  assert.equal(calls.seasonPreviews, 0);
});

test("season-reset with RESET runs it and reports what was and was not touched", async () => {
  const { deps, calls } = createDeps();
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  assert.deepEqual(calls.seasonResets, [ADMIN_ID]);
  const text = replies[0]?.content ?? "";
  assert.match(text, /Season 2 has started/);
  assert.match(text, /Reset \*\*12\*\* member/);
  assert.match(text, /30\*\* milestone record/);
  assert.match(text, /\*\*20\*\* member role/);
  assert.match(text, /Wallets, the shop, purchases and owned color roles were not touched/);
  assert.doesNotMatch(text, /⚠️/);
});

test("season-reset warns when some roles could not be removed", async () => {
  const { deps, setSeasonOutcome } = createDeps();
  setSeasonOutcome({ roles: { removed: 18, failed: 2, missingRoleIds: ["999"] } });
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  const text = replies[0]?.content ?? "";
  assert.match(text, /\*\*2\*\* role removal\(s\) failed/);
  assert.match(text, /no longer exist: `999`/);
});

test("season-reset says so when progress was reset but roles could not be stripped at all", async () => {
  const { deps, setSeasonOutcome } = createDeps();
  setSeasonOutcome({ roles: { removed: 0, failed: -1, missingRoleIds: [] } });
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /could not remove the study roles/);
});

test("season-reset mentions a shop color role that was skipped", async () => {
  const { deps, setSeasonOutcome } = createDeps();
  setSeasonOutcome({ protectedRoleIds: [ROLE_2] });
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", new RegExp(`Skipped <@&${ROLE_2}>`));
});

test("a reset that is already running gets a clear message", async () => {
  const { deps, failSeasonWith } = createDeps();
  failSeasonWith(new SeasonResetInProgressError());
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /already running/);
});

test("a database failure during the reset gives the safe message", async () => {
  const { deps, failSeasonWith } = createDeps();
  failSeasonWith(new Error("db down"));
  const { interaction, replies } = createInteraction({
    subcommand: "season-reset",
    options: { confirm: "RESET" },
  });
  await handleAdminCommand(interaction, deps);
  assert.match(replies[0]?.content ?? "", /Something went wrong/);
});
