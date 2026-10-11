import assert from "node:assert/strict";
import test from "node:test";
import { LEADERBOARD_SLOT_COUNT } from "../src/leaderboard/leaderboard-card-data.js";
import {
  buildMoneyCardData,
  formatMoney,
  type MoneyCardInput,
  type MoneyCardMember,
} from "../src/leaderboard/money-leaderboard-card-data.js";
import {
  drawMoneyLeaderboardCard,
  type MoneyCardImages,
} from "../src/leaderboard/money-leaderboard-card-draw.js";
import type { Ctx2D } from "../src/milestones/milestone-card-draw.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

function member(rank: number, name: string, balance: number, username: string | null = null): MoneyCardMember {
  return { rank, displayName: name, username, balance, avatarUrl: null };
}

const names = ["hari", "oualae", "ayo", "kwr", "robux", "loser", "maryuush", "madviolette", "maniss", "deef"];

/** `count` members with consecutive ranks starting at `startRank`. */
function ranks(startRank: number, count: number): MoneyCardMember[] {
  return Array.from({ length: count }, (_, index) => {
    const name = names[(startRank + index - 1) % names.length]!;
    return member(startRank + index, name, 300_000 - (startRank + index) * 1_000, name);
  });
}

const base: MoneyCardInput = {
  serverName: "2BACSM",
  currencySymbol: "DH",
  page: 0,
  pages: 10,
  podium: ranks(1, 3),
  rows: ranks(4, 7),
  viewer: member(477, "lvxd", 1741, "lvxd.l24"),
};

test("amounts are whole numbers with thousands separators and the currency label", () => {
  assert.equal(formatMoney(231715, "DH"), "231,715 DH");
  assert.equal(formatMoney(1741.9, "DH"), "1,741 DH");
  assert.equal(formatMoney(0, "DH"), "0 DH");
  assert.equal(formatMoney(-50, "DH"), "0 DH");
  assert.equal(formatMoney(Number.NaN, "DH"), "0 DH");
  assert.equal(formatMoney(1000, ""), "1,000");
});

test("the first page has the richest wording, the page label and every slot", () => {
  const data = buildMoneyCardData(base);
  assert.equal(data.subtitle, "2BACSM • RICHEST MEMBERS");
  assert.equal(data.pageLabel, "PAGE 1 / 10");
  assert.equal(data.slots.length, LEADERBOARD_SLOT_COUNT);
  assert.equal(data.heroCaption, "@hari • #1 Richest");
  assert.equal(data.slots[0]?.amount, "299,000 DH");
  assert.equal(data.slots[9]?.rank, 10);
  assert.equal(data.viewer?.rankText, "Rank #477");
  assert.equal(data.viewer?.amount, "1,741 DH");
  assert.equal(data.viewer?.handle, "@lvxd.l24");
});

test("later pages keep the overall top three and continue the rows", () => {
  const data = buildMoneyCardData({ ...base, page: 1, rows: ranks(11, 7) });
  assert.equal(data.pageLabel, "PAGE 2 / 10");
  assert.deepEqual(data.slots.slice(0, 3).map((slot) => slot?.rank), [1, 2, 3]);
  assert.deepEqual(data.slots.slice(3).map((slot) => slot?.rank), [11, 12, 13, 14, 15, 16, 17]);
});

test("a short page leaves the unused slots empty", () => {
  const data = buildMoneyCardData({ ...base, pages: 1, rows: ranks(4, 1) });
  assert.equal(data.slots.filter(Boolean).length, 4);
  assert.equal(data.slots[4], null);
  assert.equal(data.slots[9], null);
});

test("an empty list and out-of-range page numbers do not break", () => {
  const empty = buildMoneyCardData({ ...base, podium: [], rows: [], pages: 0, page: 7 });
  assert.equal(empty.pageLabel, "PAGE 1 / 1");
  assert.equal(empty.heroCaption, null);
  assert.ok(empty.slots.every((slot) => slot === null));
});

test("a member with an empty wallet is shown as unranked with 0", () => {
  const data = buildMoneyCardData({ ...base, viewer: member(0, "New", 0) });
  assert.equal(data.viewer?.rankText, "Unranked");
  assert.equal(data.viewer?.amount, "0 DH");
  assert.equal(buildMoneyCardData({ ...base, viewer: null }).viewer, null);
});

test("names the font cannot draw fall back to the username", () => {
  const data = buildMoneyCardData({ ...base, podium: [member(1, "\u{1F525}\u{1F525}", 5, "real.name"), ...ranks(2, 2)] });
  assert.equal(data.slots[0]?.name, "real.name");
  assert.equal(data.slots[0]?.initial, "R");
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

const noImages: MoneyCardImages = { background: null, avatars: new Map(), viewerAvatar: null };

test("drawing puts every name and amount on the card", () => {
  const { ctx, texts } = fakeContext();
  drawMoneyLeaderboardCard(ctx, buildMoneyCardData(base), noImages);
  for (const expected of [
    "PAGE 1 / 10", "2BACSM • RICHEST MEMBERS", "hari", "@hari • #1 Richest", "296,000 DH",
    "#4", "#10", "Rank #477", "@lvxd.l24", "1,741 DH",
  ]) {
    assert.ok(texts.includes(expected), `missing "${expected}"`);
  }
  // The fixed labels ("#1 CHAMPION", "TOTAL NET WORTH", ...) are part of the artwork.
  assert.ok(!texts.includes("#1 CHAMPION"));
});

test("drawing works with a short page, no viewer and no artwork", () => {
  const { ctx } = fakeContext();
  assert.doesNotThrow(() =>
    drawMoneyLeaderboardCard(
      ctx,
      buildMoneyCardData({ ...base, podium: ranks(1, 2), rows: [], viewer: null }),
      noImages,
    ),
  );
  assert.doesNotThrow(() =>
    drawMoneyLeaderboardCard(ctx, buildMoneyCardData({ ...base, podium: [], rows: [] }), noImages),
  );
});

test("wallet rank follows the richest order, with ties going to the lower user id", async () => {
  const store = new MemoryEconomyStore(0);
  store.seed("b", 500);
  store.seed("a", 500);
  store.seed("c", 900);
  store.seed("d", 10);
  assert.equal(await store.getWalletRank("c"), 1);
  assert.equal(await store.getWalletRank("a"), 2);
  assert.equal(await store.getWalletRank("b"), 3);
  assert.equal(await store.getWalletRank("d"), 4);
  const richest = await store.getRichest(10, 0);
  assert.deepEqual(richest.map((entry) => entry.discordUserId), ["c", "a", "b", "d"]);
});

test("an empty or missing wallet has no rank", async () => {
  const store = new MemoryEconomyStore(0);
  store.seed("a", 100);
  assert.equal(await store.getWalletRank("nobody"), null);
  assert.equal(await store.getBalance("zero"), 0);
  assert.equal(await store.getWalletRank("zero"), null);
});
