import assert from "node:assert/strict";
import test from "node:test";
import type { Ctx2D } from "../src/milestones/milestone-card-draw.js";
import {
  SHOP_ITEMS_PER_PAGE,
  buildShopCardData,
  clampShopPage,
  shopPageCount,
  shopPageItems,
  type ShopCardInput,
  type ShopCardItem,
} from "../src/shop/shop-card-data.js";
import { drawShopCard, readableOn } from "../src/shop/shop-card-draw.js";

function item(name: string, price: number, state: ShopCardItem["state"] = "for_sale", color = 0xd4af37): ShopCardItem {
  return { name, description: null, price, color, state };
}

const base: ShopCardInput = {
  serverName: "2bacsm",
  currencySymbol: "DH",
  page: 0,
  totalItems: 3,
  items: [item("Royal Gold", 250_000), item("Sky", 100_000, "owned", 0x3498db), item("Ruby", 500_000, "worn", 0xe74c3c)],
  balance: 120_000,
  viewerName: "lvxd",
};

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

test("paging: six colors per page, at least one page, bad pages are clamped", () => {
  assert.equal(SHOP_ITEMS_PER_PAGE, 6);
  assert.equal(shopPageCount(0), 1);
  assert.equal(shopPageCount(6), 1);
  assert.equal(shopPageCount(7), 2);
  assert.equal(shopPageCount(50), 9);
  assert.equal(clampShopPage(-1, 20), 0);
  assert.equal(clampShopPage(99, 20), 3);
  assert.equal(clampShopPage(Number.NaN, 20), 0);
  const all = Array.from({ length: 13 }, (_, index) => index);
  assert.deepEqual(shopPageItems(all, 0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(shopPageItems(all, 2), [12]);
  assert.deepEqual(shopPageItems(all, 99), [12]);
});

test("the card text: title line, page label, prices, badges and balance", () => {
  const data = buildShopCardData(base);
  assert.equal(data.subtitle, "2BACSM • NAME COLORS");
  assert.equal(data.pageLabel, "PAGE 1 / 1");
  assert.equal(data.tiles.length, SHOP_ITEMS_PER_PAGE);
  assert.equal(data.tiles[0]?.priceText, "250,000 DH");
  assert.equal(data.tiles[0]?.number, 1);
  assert.equal(data.tiles[1]?.badge, "OWNED");
  assert.equal(data.tiles[2]?.badge, "WEARING");
  assert.equal(data.tiles[0]?.badge, null);
  assert.equal(data.balanceText, "120,000 DH");
  assert.equal(data.viewerName, "lvxd");
  assert.equal(data.empty, false);
  assert.equal(data.hint, "Pick a color in the menu below");
});

test("unused slots stay empty and the page label follows the total", () => {
  const data = buildShopCardData({ ...base, page: 1, totalItems: 8, items: [item("Seven", 1000), item("Eight", 2000)] });
  assert.equal(data.pageLabel, "PAGE 2 / 2");
  assert.equal(data.tiles[0]?.name, "Seven");
  assert.equal(data.tiles[2], null);
  assert.equal(data.tiles[5], null);
});

test("a color is only 'affordable' when owned or when the balance covers it", () => {
  const data = buildShopCardData(base);
  assert.equal(data.tiles[0]?.affordable, false); // 250,000 > 120,000
  assert.equal(data.tiles[1]?.affordable, true); // owned
  assert.equal(data.tiles[2]?.affordable, true); // worn
  const exact = buildShopCardData({ ...base, balance: 250_000 });
  assert.equal(exact.tiles[0]?.affordable, true);
});

test("a role without a color is shown as 'no color' and a missing name gets a fallback", () => {
  const data = buildShopCardData({ ...base, items: [item("  ", 5, "for_sale", 0)], totalItems: 1 });
  assert.equal(data.tiles[0]?.color, null);
  assert.equal(data.tiles[0]?.name, "Color");
  assert.equal(data.tiles[0]?.colorHex, "#000000");
});

test("an empty shop says so", () => {
  const data = buildShopCardData({ ...base, totalItems: 0, items: [] });
  assert.equal(data.empty, true);
  assert.equal(data.pageLabel, "PAGE 1 / 1");
  assert.equal(data.hint, "Nothing for sale yet");
  assert.ok(data.tiles.every((tile) => tile === null));
});

test("name text picks black or white for readability", () => {
  assert.equal(readableOn(0xffffff), "#111111");
  assert.equal(readableOn(0xf1c40f), "#111111");
  assert.equal(readableOn(0x000000), "#ffffff");
  assert.equal(readableOn(0x1f2a55), "#ffffff");
});

test("drawing a full page writes every name, price, badge and the balance", () => {
  const { ctx, texts } = fakeContext();
  drawShopCard(ctx, buildShopCardData(base));
  for (const expected of ["COLOR SHOP", "2BACSM • NAME COLORS", "PAGE 1 / 1", "Royal Gold", "250,000 DH", "OWNED", "WEARING", "120,000 DH", "BALANCE", "lvxd"]) {
    assert.ok(texts.includes(expected), `missing "${expected}"`);
  }
});

test("drawing an empty shop and a page with no viewer name never throws", () => {
  const empty = fakeContext();
  drawShopCard(empty.ctx, buildShopCardData({ ...base, totalItems: 0, items: [] }));
  assert.ok(empty.texts.includes("The shop is empty"));
  const longNames = fakeContext();
  drawShopCard(
    longNames.ctx,
    buildShopCardData({
      ...base,
      items: [{ ...item("A very very long color name that needs shrinking", 1_000_000_000), description: "x".repeat(80) }],
      totalItems: 1,
      viewerName: "",
    }),
  );
  assert.ok(longNames.texts.includes("Member"));
});

test("the wardrobe card has its own wording, shows no prices and lists owned colors", () => {
  const data = buildShopCardData({
    ...base,
    mode: "wardrobe",
    balance: 0,
    items: [item("Sky", 100_000, "owned", 0x3498db), item("Ruby", 500_000, "worn", 0xe74c3c)],
    totalItems: 2,
  });
  assert.equal(data.title, "WARDROBE");
  assert.equal(data.subtitle, "2BACSM • YOUR COLORS");
  assert.equal(data.hint, "Pick a color to put it on");
  assert.equal(data.tiles[0]?.priceText, "Free to wear");
  assert.equal(data.tiles[0]?.affordable, true);
  assert.equal(data.tiles[0]?.badge, "OWNED");
  assert.equal(data.tiles[1]?.badge, "WEARING");
});

test("an empty wardrobe points to the shop, and the shop keeps its own wording", () => {
  const wardrobe = buildShopCardData({ ...base, mode: "wardrobe", totalItems: 0, items: [] });
  assert.equal(wardrobe.empty, true);
  assert.equal(wardrobe.emptyTitle, "Your wardrobe is empty");
  assert.equal(wardrobe.emptyText, "Buy a color with /shop and it shows up here");
  assert.equal(wardrobe.hint, "Nothing owned yet");
  const shop = buildShopCardData({ ...base, totalItems: 0, items: [] });
  assert.equal(shop.title, "COLOR SHOP");
  assert.equal(shop.emptyTitle, "The shop is empty");

  const { ctx, texts } = fakeContext();
  drawShopCard(ctx, wardrobe);
  for (const expected of ["WARDROBE", "Your wardrobe is empty", "Buy a color with /shop and it shows up here"]) {
    assert.ok(texts.includes(expected), `missing "${expected}"`);
  }
});
