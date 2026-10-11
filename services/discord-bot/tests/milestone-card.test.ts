import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnnouncementDescription,
  buildCardData,
  cleanRoleTitle,
  formatTimeLeft,
} from "../src/milestones/milestone-card-data.js";
import { loadEconomyConfig, validateEconomyConfig } from "../src/economy/economy-config.js";

const base = {
  serverName: "StudySouk #Academy",
  username: "madarauchiha06867",
  milestone: { id: "9", requiredVoiceTimeSeconds: 100 * 3600, currencyRewardAmount: 2500 as number | null },
  next: { id: "10", roleName: "High Achiever (140-180h)", requiredVoiceTimeSeconds: 140 * 3600 },
  totalSeconds: 100 * 3600,
  currencySymbol: "DH",
};

test("role names are cleaned for the card font and keep a lowercase h unit", () => {
  assert.equal(cleanRoleTitle("Speaker (10-15h)"), "SPEAKER (10-15h)");
  assert.equal(cleanRoleTitle("• ꜱᴛᴜᴅʏ ᴀ+ ꜱᴛᴜᴅᴇɴᴛ (100-140ʜ) ✦"), "STUDY A+ STUDENT (100-140h)");
  assert.equal(cleanRoleTitle("𝗣𝗿𝗼 𝗦𝗽𝗲𝗮𝗸𝗲𝗿"), "PRO SPEAKER");
  assert.equal(cleanRoleTitle("✦✦✦"), null);
  assert.equal(cleanRoleTitle(null), null);
});

test("card text with a reward matches the reference layout", () => {
  const data = buildCardData({ ...base, roleName: "Study A Student (100-140h)" });
  assert.equal(data.handle, "@madarauchiha06867");
  assert.equal(data.roleTitle, "STUDY A STUDENT (100-140h)");
  assert.equal(data.hoursLabel, "100h");
  assert.equal(data.requirementText, "100 Hours (6000 Minutes)");
  assert.equal(data.rewardTitle, "+2,500 DH");
  assert.equal(data.rewardSub, "Credited directly to your server vault");
  assert.equal(data.nextTitle, "HIGH ACHIEVER (140-180h)");
  assert.equal(data.nextSub, "40 hours left until next one");
});

test("no reward shows REWARD PENDING, and the last milestone has no next target", () => {
  const pending = buildCardData({ ...base, roleName: null, milestone: { ...base.milestone, currencyRewardAmount: null } });
  assert.equal(pending.rewardTitle, "REWARD PENDING");
  assert.equal(pending.hasReward, false);
  assert.equal(pending.roleTitle, "MILESTONE 9");
  const last = buildCardData({ ...base, roleName: "Legend", next: null });
  assert.equal(last.nextTitle, "ALL MILESTONES DONE");
});

test("time left is shown in friendly units", () => {
  assert.equal(formatTimeLeft(5 * 3600), "5 hours");
  assert.equal(formatTimeLeft(3600), "1 hour");
  assert.equal(formatTimeLeft(5400), "1.5 hours");
  assert.equal(formatTimeLeft(30 * 60), "30 minutes");
  assert.equal(formatTimeLeft(0), "1 minute");
});

test("the embed text is a quoted bullet list like the reference", () => {
  const text = buildAnnouncementDescription({
    bullet: "🩷", memberId: "111", roleId: "222",
    requiredVoiceTimeSeconds: 100 * 3600, rewardAmount: 2500, currencySymbol: "DH",
  });
  assert.equal(
    text,
    [
      "> 🩷 **Member:** <@111>",
      "> 🩷 **Unlocked Role:** <@&222>",
      "> 🩷 **Milestone Requirement:** `100h` `(6000 min)`",
      "> 🩷 **Milestone Reward:** `+2500 DH`",
    ].join("\n"),
  );
  const pending = buildAnnouncementDescription({
    bullet: "•", memberId: "1", roleId: null,
    requiredVoiceTimeSeconds: 3600, rewardAmount: null, currencySymbol: "DH",
  });
  assert.match(pending, /Milestone Reward:\*\* `Pending`/);
  assert.match(pending, /Unlocked Role:\*\* `None`/);
});

test("the announcement channel setting is optional and validated", () => {
  const ok = loadEconomyConfig({ TARGET_GUILD_ID: "123456789012345678" });
  assert.equal(ok.milestoneAnnounceChannelId, undefined);
  assert.deepEqual(validateEconomyConfig(ok), []);
  const bad = loadEconomyConfig({ TARGET_GUILD_ID: "123456789012345678", MILESTONE_ANNOUNCE_CHANNEL_ID: "general" });
  assert.ok(validateEconomyConfig(bad).some((p) => p.includes("MILESTONE_ANNOUNCE_CHANNEL_ID")));
});
