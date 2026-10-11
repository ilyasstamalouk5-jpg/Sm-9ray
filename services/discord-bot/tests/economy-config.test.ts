import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig, validateEconomyConfig } from "../src/economy/economy-config.js";
import { isEconomyAdmin, isTargetGuild } from "../src/economy/permissions.js";

test("defaults are the agreed Dirham economy values", () => {
  const config = loadEconomyConfig({});
  assert.equal(config.currencyName, "Dirham");
  assert.equal(config.currencyNamePlural, "Dirhams");
  assert.equal(config.currencySymbol, "DH");
  assert.equal(config.startingBalance, 0);
  assert.equal(config.voiceRewardAmount, 50);
  assert.equal(config.voiceRewardIntervalMinutes, 60);
  assert.equal(config.workRewardAmount, 400);
  assert.equal(config.workCooldownHours, 4);
  assert.equal(config.dailyRewardAmount, 1000);
  assert.equal(config.dailyCooldownHours, 24);
  assert.equal(config.minBet, 10);
  assert.equal(config.maxBet, 10000);
  assert.equal(config.minesDefaultCount, 3);
  assert.equal(config.blackjackNaturalPayoutPercent, 150);
});

test("environment variables override the defaults", () => {
  const config = loadEconomyConfig({
    WORK_REWARD_AMOUNT: "500",
    MAX_BET: "5000",
    BLACKJACK_DEALER_HITS_SOFT_17: "true",
  });
  assert.equal(config.workRewardAmount, 500);
  assert.equal(config.maxBet, 5000);
  assert.equal(config.blackjackDealerHitsSoft17, true);
});

test("invalid numbers fail loudly with the variable name", () => {
  assert.throws(() => loadEconomyConfig({ MIN_BET: "abc" }), /MIN_BET/);
  assert.throws(() => loadEconomyConfig({ MIN_BET: "0" }), /MIN_BET/);
  assert.throws(() => loadEconomyConfig({ WORK_COOLDOWN_HOURS: "1.5" }), /WORK_COOLDOWN_HOURS/);
});

test("TARGET_GUILD_ID is required and validated", () => {
  assert.ok(validateEconomyConfig(loadEconomyConfig({})).some((p) => p.includes("TARGET_GUILD_ID")));
  assert.ok(validateEconomyConfig(loadEconomyConfig({ TARGET_GUILD_ID: "abc" })).length > 0);
  assert.deepEqual(validateEconomyConfig(loadEconomyConfig({ TARGET_GUILD_ID: "123456789012345678" })), []);
  const bad = loadEconomyConfig({ TARGET_GUILD_ID: "123456789012345678", MIN_BET: "500", MAX_BET: "100" });
  assert.ok(validateEconomyConfig(bad).some((p) => p.includes("MIN_BET")));
  const badRole = loadEconomyConfig({ TARGET_GUILD_ID: "123456789012345678", ADMIN_ROLE_ID: "nope" });
  assert.ok(validateEconomyConfig(badRole).some((p) => p.includes("ADMIN_ROLE_ID")));
});

test("guild isolation: only the target server is accepted", () => {
  const config = loadEconomyConfig({ TARGET_GUILD_ID: "111111111111111111" });
  assert.equal(isTargetGuild("111111111111111111", config), true);
  assert.equal(isTargetGuild("222222222222222222", config), false);
  assert.equal(isTargetGuild(null, config), false);
  assert.equal(isTargetGuild("111111111111111111", loadEconomyConfig({})), false);
});

test("economy admin: Administrator permission or the configured role only", () => {
  const withRole = loadEconomyConfig({ ADMIN_ROLE_ID: "333333333333333333" });
  assert.equal(isEconomyAdmin({ isAdministrator: true, roleIds: [] }, withRole), true);
  assert.equal(isEconomyAdmin({ isAdministrator: false, roleIds: ["333333333333333333"] }, withRole), true);
  assert.equal(isEconomyAdmin({ isAdministrator: false, roleIds: ["444444444444444444"] }, withRole), false);
  const noRole = loadEconomyConfig({});
  assert.equal(isEconomyAdmin({ isAdministrator: false, roleIds: ["333333333333333333"] }, noRole), false);
});
