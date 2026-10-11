import assert from "node:assert/strict";
import test from "node:test";
import { cleanDisplayText } from "../src/milestones/milestone-card-data.js";
import {
  buildProfileCardData,
  formatHoursMinutes,
  splitRoleRange,
  type ProfileCardInput,
} from "../src/profile/profile-card-data.js";

const base: ProfileCardInput = {
  displayName: "2BACSM Academy",
  username: "2bacsm.academy",
  serverName: "2 BACSM #Academy",
  totalSeconds: 10 * 3600 + 59 * 60,
  weekSeconds: 6 * 3600 + 25 * 60,
  rank: 7,
  balance: 58,
  currencySymbol: "DH",
  currencyNamePlural: "Dirhams",
  current: { id: "4", roleName: "Voice Intermediate (10-15h)", requiredVoiceTimeSeconds: 10 * 3600 },
  next: { id: "5", roleName: "Voice Focused (15-25h)", requiredVoiceTimeSeconds: 15 * 3600 },
  progressPercent: 19,
  remainingSeconds: 4 * 3600 + 60,
  noMilestones: false,
};

test("durations are shown as total hours and minutes", () => {
  assert.equal(formatHoursMinutes(10 * 3600 + 59 * 60 + 30), "10h 59m");
  assert.equal(formatHoursMinutes(160 * 3600), "160h 0m");
  assert.equal(formatHoursMinutes(-5), "0h 0m");
  assert.equal(formatHoursMinutes(Number.NaN), "0h 0m");
});

test("role titles split into a name and an hours range", () => {
  assert.deepEqual(splitRoleRange("VOICE INTERMEDIATE (10-15h)"), {
    name: "VOICE INTERMEDIATE", from: "10", to: "15",
  });
  assert.equal(splitRoleRange("LEGEND"), null);
});

test("a member with a rank and a next goal gets the reference wording", () => {
  const data = buildProfileCardData(base);
  assert.deepEqual(data.nameWords, ["2BACSM", "ACADEMY"]);
  assert.equal(data.handle, "@2bacsm.academy");
  assert.equal(data.pillText, "2 BACSM #ACADEMY \u2022 VOICE PROFILE");
  assert.equal(data.rankValue, "#7");
  assert.equal(data.rankTitle, "VOICE INTERMEDIATE");
  assert.equal(data.rankSub, "(10H - 15H TOTAL VOICE TIME)");
  assert.equal(data.nextPrefix, "NEXT GOAL: ");
  assert.equal(data.nextTitle, "VOICE FOCUSED (15H - 25H)");
  assert.equal(data.progressNote, "19% \u2022 4H 1M TO GO");
  assert.equal(data.progressFraction, 0.19);
  assert.equal(data.totalValue, "10h 59m");
  assert.equal(data.weekValue, "6h 25m");
  assert.equal(data.walletValue, "58 DH");
  assert.equal(data.walletSub, "Dirhams held");
  assert.equal(data.footer, "2 BACSM Academy \u2022 Profile of 2BACSM Academy");
});

test("the last milestone has no next goal and a full bar", () => {
  const data = buildProfileCardData({ ...base, next: null, progressPercent: 100, remainingSeconds: 0 });
  assert.equal(data.nextPrefix, "");
  assert.equal(data.nextTitle, "ALL MILESTONES COMPLETE");
  assert.equal(data.progressNote, "MAX RANK REACHED");
  assert.equal(data.progressFraction, 1);
});

test("a new member without a milestone, rank or economy still gets a card", () => {
  const data = buildProfileCardData({
    ...base, current: null, rank: null, balance: null,
    next: { id: "1", roleName: null, requiredVoiceTimeSeconds: 3600 },
    progressPercent: 41, remainingSeconds: 2100, totalSeconds: 1500, weekSeconds: 1500,
  });
  assert.equal(data.rankValue, "UNRANKED");
  assert.equal(data.rankTitle, "NO RANK YET");
  assert.equal(data.rankSub, "(UNDER 1H TOTAL VOICE TIME)");
  assert.equal(data.nextTitle, "MILESTONE 1 (1H)");
  assert.equal(data.walletValue, "\u2014");
  assert.equal(data.hasWallet, false);
  assert.equal(data.totalValue, "0h 25m");
});

test("no configured milestones is shown as unranked", () => {
  const data = buildProfileCardData({ ...base, current: null, next: null, noMilestones: true, progressPercent: 0 });
  assert.equal(data.rankTitle, "UNRANKED");
  assert.equal(data.nextTitle, "NO MILESTONES YET");
});

test("decorated display names fall back to something the font can draw", () => {
  assert.equal(cleanDisplayText("ᴍᴀᴅᴀʀᴀ ✦ Uchiha"), "MADARA Uchiha");
  assert.equal(cleanDisplayText("✦✦✦"), null);
  const data = buildProfileCardData({ ...base, displayName: "🔥🔥", username: "fire.user" });
  assert.deepEqual(data.nameWords, ["FIRE.USER"]);
  const none = buildProfileCardData({ ...base, displayName: "🔥", username: "✦" });
  assert.deepEqual(none.nameWords, ["MEMBER"]);
});
