import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOP_BUTTON_PREFIX,
  WARDROBE_BUTTON_PREFIX,
  parseShopId,
  parseWardrobeId,
  shopIds,
  wardrobeIds,
} from "../src/shop/shop-ids.js";

const owner = "123456789012345678";
const itemId = "7b0f6f1e-3b3c-4c53-9a53-0f4f0ec3a1de";

test("every shop id starts with the shop prefix and fits Discord's 100 character limit", () => {
  const ids = [
    shopIds.page(owner, 3),
    shopIds.pick(owner, 3),
    shopIds.buy(owner, 8, itemId, 1_000_000_000),
    shopIds.wear(owner, 8, itemId),
    shopIds.off(owner, 8),
    shopIds.back(owner, 8),
  ];
  for (const id of ids) {
    assert.ok(id.startsWith(SHOP_BUTTON_PREFIX));
    assert.ok(id.length <= 100, `${id} is ${id.length} characters`);
  }
});

test("ids round-trip through the parser", () => {
  assert.deepEqual(parseShopId(shopIds.page(owner, 2)), { kind: "page", ownerId: owner, page: 2 });
  assert.deepEqual(parseShopId(shopIds.pick(owner, 0)), { kind: "pick", ownerId: owner, page: 0 });
  assert.deepEqual(parseShopId(shopIds.buy(owner, 1, itemId, 250_000)), {
    kind: "buy",
    ownerId: owner,
    page: 1,
    itemId,
    price: 250_000,
  });
  assert.deepEqual(parseShopId(shopIds.wear(owner, 4, itemId)), { kind: "wear", ownerId: owner, page: 4, itemId });
  assert.deepEqual(parseShopId(shopIds.off(owner, 4)), { kind: "off", ownerId: owner, page: 4 });
  assert.deepEqual(parseShopId(shopIds.back(owner, 4)), { kind: "back", ownerId: owner, page: 4 });
});

test("a previous-page button on page 0 is rejected instead of becoming a bad page", () => {
  assert.equal(parseShopId(shopIds.page(owner, -1)), null);
});

test("malformed or foreign ids are rejected", () => {
  for (const id of [
    "lb|1|voice|0",
    "sh|",
    "sh|1",
    "sh|1|nope|0",
    `sh|${owner}|buy|${itemId}|abc|0`,
    `sh|${owner}|buy|${itemId}|100`,
    `sh|${owner}|buy||100|0`,
    `sh|${owner}|wear|${itemId}`,
    `sh|${owner}|pg|1|extra`,
    `sh|${owner}|pg|1.5`,
    `sh|${owner}|pg|99999999999999999999`,
  ]) {
    assert.equal(parseShopId(id), null, id);
  }
});

test("wardrobe ids use their own prefix, round-trip, and never mix with the shop", () => {
  const ids = [wardrobeIds.page(owner, 2), wardrobeIds.pick(owner, 2), wardrobeIds.off(owner, 2)];
  for (const id of ids) {
    assert.ok(id.startsWith(WARDROBE_BUTTON_PREFIX));
    assert.ok(id.length <= 100);
    assert.equal(parseShopId(id), null);
  }
  assert.deepEqual(parseWardrobeId(wardrobeIds.page(owner, 2)), { kind: "page", ownerId: owner, page: 2 });
  assert.deepEqual(parseWardrobeId(wardrobeIds.pick(owner, 0)), { kind: "pick", ownerId: owner, page: 0 });
  assert.deepEqual(parseWardrobeId(wardrobeIds.off(owner, 5)), { kind: "off", ownerId: owner, page: 5 });
  // A shop id is not a wardrobe id, and the wardrobe cannot buy.
  assert.equal(parseWardrobeId(shopIds.page(owner, 1)), null);
  assert.equal(parseWardrobeId(`wd|${owner}|buy|${itemId}|100|0`), null);
  assert.equal(parseWardrobeId(`wd|${owner}|wear|${itemId}|0`), null);
  assert.equal(parseWardrobeId(`wd|${owner}|pg|-1`), null);
});
