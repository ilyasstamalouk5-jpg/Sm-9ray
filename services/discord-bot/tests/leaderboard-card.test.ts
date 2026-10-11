import assert from "node:assert/strict";
import test from "node:test";
import {
  LEADERBOARD_SLOT_COUNT,
  leaderboardPageCount,
  leaderboardRowRange,
  buildLeaderboardCardData,
  cardName,
  formatLeaderboardTime,
  type LeaderboardCardInput,
  type LeaderboardCardMember,
} from "../src/leaderboard/leaderboard-card-data.js";
import {
  drawLeaderboardCard,
  type LeaderboardCardImages,
} from "../src/leaderboard/leaderboard-card-draw.js";
import type { Ctx2D } from "../src/milestones/milestone-card-draw.js";

function member(rank: number, name: string, seconds: number, username: string | null = null): LeaderboardCardMember {
  return { rank, displayName: name, username, seconds, avatarUrl: null };
}

const names = ["Jumana", "Alpha", "LEONA", "QUALAE", "Chromi", "Amine", "RADAHN", "Yousuf.", "AltaxUno", "Ryuzaaki"];

/** `count` members with consecutive ranks starting at `startRank`. */
function ranks(startRank: number, count: number): LeaderboardCardMember[] {
  return Array.from({ length: count }, (_, index) => {
    const name = names[(startRank + index - 1) % names.length]!;
    return member(startRank + index, name, (600 - (startRank + index) * 4) * 3600 + 33 * 60, name.toLowerCase());
  });
}

const base: LeaderboardCardInput = {
  serverName: "2BACSM",
  page: 0,
  pages: 10,
  podium: ranks(1, 3),
  rows: ranks(4, 7),
  viewer: member(101, "lvxd", 0, "lvxd.124"),
};

test("times are shown as hours and minutes, dropping what is zero", () => {
  assert.equal(formatLeaderboardTime(513 * 3600 + 33 * 60 + 59), "513h 33m");
  assert.equal(formatLeaderboardTime(451 * 3600), "451h");
  assert.equal(formatLeaderboardTime(42 * 60 + 10), "42m");
  assert.equal(formatLeaderboardTime(0), "0s");
  assert.equal(formatLeaderboardTime(30), "30s");
  assert.equal(formatLeaderboardTime(-5), "0s");
  assert.equal(formatLeaderboardTime(Number.NaN), "0s");
});

test("names the font cannot draw fall back to the username, then a plain label", () => {
  assert.equal(cardName("Jumana", "jumana"), "Jumana");
  assert.equal(cardName("\u{1F525}\u{1F525}", "real.name"), "real.name");
  assert.equal(cardName("\u{1F525}", null), "Member");
});

test("the first page uses the podium wording and the page label", () => {
  const data = buildLeaderboardCardData(base);
  assert.equal(data.subtitle, "2BACSM • ALL TIME");
  assert.equal(data.pageLabel, "PAGE 1 / 10");
  assert.equal(data.slots.length, LEADERBOARD_SLOT_COUNT);
  assert.equal(data.heroPill, "#1 TOP VOICE");
  assert.equal(data.heroLabel, "TOTAL VOICE RECORDED");
  assert.equal(data.heroCaption, "@jumana • #1 VOICE Rank");
  assert.equal(data.slots[0]?.time, "596h 33m");
  assert.equal(data.slots[9]?.rank, 10);
  assert.equal(data.viewer?.rankText, "Rank #101");
  assert.equal(data.viewer?.time, "0s");
  assert.equal(data.viewer?.handle, "@lvxd.124");
});

test("later pages keep the overall top three and continue the rows", () => {
  const data = buildLeaderboardCardData({ ...base, page: 1, rows: ranks(11, 7) });
  assert.equal(data.pageLabel, "PAGE 2 / 10");
  assert.equal(data.heroPill, "#1 TOP VOICE");
  assert.equal(data.slots[0]?.rank, 1);
  assert.equal(data.slots[1]?.rank, 2);
  assert.equal(data.slots[2]?.rank, 3);
  assert.deepEqual(data.slots.slice(3).map((slot) => slot?.rank), [11, 12, 13, 14, 15, 16, 17]);
});

test("rows are split 4-10, 11-17, 18-24 and so on", () => {
  assert.deepEqual(leaderboardRowRange(0), { start: 3, end: 10 });
  assert.deepEqual(leaderboardRowRange(1), { start: 10, end: 17 });
  assert.deepEqual(leaderboardRowRange(2), { start: 17, end: 24 });
  assert.equal(leaderboardPageCount(0), 1);
  assert.equal(leaderboardPageCount(3), 1);
  assert.equal(leaderboardPageCount(10), 1);
  assert.equal(leaderboardPageCount(11), 2);
  assert.equal(leaderboardPageCount(17), 2);
  assert.equal(leaderboardPageCount(18), 3);
  assert.equal(leaderboardPageCount(100), 14);
});

test("a short page leaves the unused slots empty", () => {
  const data = buildLeaderboardCardData({ ...base, pages: 1, podium: ranks(1, 3), rows: ranks(4, 1) });
  assert.equal(data.slots.filter(Boolean).length, 4);
  assert.equal(data.slots[4], null);
  assert.equal(data.slots[9], null);
});

test("an empty page and out-of-range page numbers do not break", () => {
  const empty = buildLeaderboardCardData({ ...base, podium: [], rows: [], pages: 0, page: 7 });
  assert.equal(empty.pageLabel, "PAGE 1 / 1");
  assert.equal(empty.heroPill, "");
  assert.equal(empty.heroCaption, null);
  assert.ok(empty.slots.every((slot) => slot === null));
});

test("a viewer with no record is shown as unranked", () => {
  const data = buildLeaderboardCardData({ ...base, viewer: member(0, "New", 0) });
  assert.equal(data.viewer?.rankText, "Unranked");
  assert.equal(buildLeaderboardCardData({ ...base, viewer: null }).viewer, null);
});

/** A canvas stand-in that records text and never draws anything. */
function fakeContext(): { ctx: Ctx2D; texts: string[] } {
  const texts: string[] = [];
  const gradient = { addColorStop() {} };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "measureText") {
        return (value: string) => ({ width: value.length * 9 });
      }
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return () => gradient;
      }
      if (key === "fillText") {
        return (value: string) => {
          texts.push(value);
        };
      }
      if (key in target) {
        return target[key];
      }
      return () => undefined;
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, texts };
}

const noImages: LeaderboardCardImages = { background: null, avatars: new Map(), viewerAvatar: null };

test("drawing puts every member's name and time on the card", () => {
  const { ctx, texts } = fakeContext();
  drawLeaderboardCard(ctx, buildLeaderboardCardData(base), noImages);
  for (const expected of [
    "PAGE 1 / 10", "#1 TOP VOICE", "Jumana", "596h 33m", "#2 RANK", "#4", "#10",
    "YOUR CURRENT STANDING", "Rank #101", "@lvxd.124", "0s",
  ]) {
    assert.ok(texts.includes(expected), `missing "${expected}"`);
  }
});

test("drawing works with a short page, no viewer and no artwork", () => {
  const { ctx } = fakeContext();
  assert.doesNotThrow(() =>
    drawLeaderboardCard(
      ctx,
      buildLeaderboardCardData({ ...base, podium: ranks(1, 2), rows: [], viewer: null }),
      noImages,
    ),
  );
  assert.doesNotThrow(() =>
    drawLeaderboardCard(ctx, buildLeaderboardCardData({ ...base, podium: [], rows: [] }), noImages),
  );
});
