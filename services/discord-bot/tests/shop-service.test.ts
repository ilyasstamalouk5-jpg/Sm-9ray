import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import {
  SHOP_MAX_ITEMS,
  SHOP_MAX_PRICE,
  colorToHex,
  outrankingColoredRoles,
  priceProblem,
  roleSaleProblem,
  type RoleInfo,
} from "../src/shop/shop-rules.js";
import { ShopService } from "../src/shop/shop-service.js";
import { FakeShopRoles, MemoryShopStore } from "./helpers/memory-shop-store.js";

const config = loadEconomyConfig({});

function role(overrides: Partial<RoleInfo> = {}): RoleInfo {
  return {
    id: "role-gold",
    name: "Gold Name",
    color: 0xf1c40f,
    managed: false,
    isEveryone: false,
    permissionNames: [],
    editable: true,
    ...overrides,
  };
}

function setup(reserved: string[] = ["milestone-role"]) {
  const store = new MemoryShopStore(0);
  const roles = new FakeShopRoles();
  let counter = 0;
  const service = new ShopService({
    store,
    roles,
    money: config,
    reservedRoleIds: () => reserved,
    newId: () => `item-${++counter}`,
    clock: () => new Date("2026-01-01T00:00:00Z"),
  });
  return { store, roles, service };
}

async function addGold(service: ShopService, roles: FakeShopRoles, price = 100_000, id = "role-gold") {
  roles.assignable.add(id);
  const result = await service.addItem({ adminId: "admin", role: role({ id, name: id }), price });
  assert.equal(result.ok, true);
  return result.ok ? result.item : (null as never);
}

// ------------------------------------------------------------ rules

test("price must be a whole number inside the allowed range", () => {
  assert.equal(priceProblem(100_000), null);
  assert.ok(priceProblem(0));
  assert.ok(priceProblem(-5));
  assert.ok(priceProblem(1.5));
  assert.ok(priceProblem(SHOP_MAX_PRICE + 1));
});

test("roles that are unsafe or unusable cannot be sold", () => {
  assert.equal(roleSaleProblem(role(), []), null);
  assert.ok(roleSaleProblem(role({ isEveryone: true }), []));
  assert.ok(roleSaleProblem(role({ managed: true }), []));
  assert.ok(roleSaleProblem(role({ editable: false }), []));
  assert.ok(roleSaleProblem(role({ id: "milestone-role" }), ["milestone-role"]));
  assert.match(roleSaleProblem(role({ permissionNames: ["ManageRoles"] }), []) ?? "", /powerful permissions/);
  assert.match(roleSaleProblem(role({ permissionNames: ["Administrator"] }), []) ?? "", /Administrator/);
  // Harmless permissions are fine.
  assert.equal(roleSaleProblem(role({ permissionNames: ["ViewChannel", "SendMessages"] }), []), null);
});

test("color is shown as a hex code", () => {
  assert.equal(colorToHex(0xf1c40f), "#F1C40F");
  assert.equal(colorToHex(0), "#000000");
});

// ------------------------------------------------------------ admin

test("an admin can add a color role and the name defaults to the role name", async () => {
  const { service, roles } = setup();
  const item = await addGold(service, roles);
  assert.equal(item.name, "role-gold");
  assert.equal(item.price, 100_000);
  assert.equal(item.color, 0xf1c40f);
});

test("adding the same role twice, an unsafe role, or a bad price is refused", async () => {
  const { service, roles } = setup();
  await addGold(service, roles);
  const twice = await service.addItem({ adminId: "a", role: role({ id: "role-gold" }), price: 5 });
  assert.equal(twice.ok, false);
  const milestone = await service.addItem({ adminId: "a", role: role({ id: "milestone-role" }), price: 5 });
  assert.equal(milestone.ok, false);
  const free = await service.addItem({ adminId: "a", role: role({ id: "other" }), price: 0 });
  assert.equal(free.ok, false);
  const longName = await service.addItem({ adminId: "a", role: role({ id: "x" }), price: 5, name: "n".repeat(40) });
  assert.equal(longName.ok, false);
});

test("the shop holds at most 50 colors", async () => {
  const { service } = setup();
  for (let i = 0; i < SHOP_MAX_ITEMS; i += 1) {
    const result = await service.addItem({ adminId: "a", role: role({ id: `r${i}`, name: `R${i}` }), price: 10 });
    assert.equal(result.ok, true);
  }
  const extra = await service.addItem({ adminId: "a", role: role({ id: "extra" }), price: 10 });
  assert.equal(extra.ok, false);
});

test("edit changes price, name and order; remove hides it but owners keep it", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 100_000);
  const edited = await service.editItem({ role: role({ id: "role-gold" }), price: 250_000, name: "Royal Gold" });
  assert.equal(edited.ok && edited.item.price, 250_000);
  assert.equal(edited.ok && edited.item.name, "Royal Gold");

  store.seed("u1", 300_000);
  const bought = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 250_000 });
  assert.equal(bought.ok, true);

  const removed = await service.removeItem("role-gold");
  assert.equal(removed.ok && removed.owners, 1);
  assert.equal((await service.listItems()).length, 0);
  assert.equal((await service.listOwned("u1")).length, 1, "the owner keeps the color");
  // The same role can be put on sale again afterwards.
  const again = await service.addItem({ adminId: "a", role: role({ id: "role-gold" }), price: 9 });
  assert.equal(again.ok, true);
  assert.equal((await service.removeItem("nope")).ok, false);
});

// ------------------------------------------------------------ buying

test("buying charges the exact price once, records it in the ledger and puts the color on", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 100_000);
  store.seed("u1", 150_000);
  const result = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 100_000 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.balance, 50_000);
  assert.equal(result.ok && result.equipped, true);
  assert.equal(await store.getBalance("u1"), 50_000);
  assert.ok(roles.worn_.get("u1")?.has("role-gold"));
  const entry = store.ledger.find((row) => row.kind === "shop_purchase");
  assert.equal(entry?.amount, -100_000);
});

test("not enough Dirhams: nothing is charged and nothing is owned", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 100_000);
  store.seed("u1", 99_999);
  const result = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 100_000 });
  assert.equal(result.ok, false);
  assert.equal(await store.getBalance("u1"), 99_999);
  assert.equal((await service.listOwned("u1")).length, 0);
  assert.equal(roles.worn_.get("u1")?.size ?? 0, 0);
});

test("buying twice never charges twice", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 1_000);
  store.seed("u1", 10_000);
  const first = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 });
  const second = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.reason, "already_owned");
  assert.equal(await store.getBalance("u1"), 9_000);
});

test("two clicks at the same moment charge only once", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 1_000);
  store.seed("u1", 1_500);
  const results = await Promise.all([
    service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 }),
    service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await store.getBalance("u1"), 500);
});

test("if the price changed after the member saw it, they are not charged", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 100_000);
  store.seed("u1", 500_000);
  await service.editItem({ role: role({ id: "role-gold" }), price: 400_000 });
  const result = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 100_000 });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "price_changed");
  assert.equal(await store.getBalance("u1"), 500_000);
});

test("a role the bot cannot assign is never charged for", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 1_000);
  roles.assignable.delete("role-gold");
  store.seed("u1", 5_000);
  const result = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 });
  assert.equal(result.ok, false);
  assert.equal(await store.getBalance("u1"), 5_000);
});

test("a removed item cannot be bought", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 1_000);
  await service.removeItem("role-gold");
  store.seed("u1", 5_000);
  const result = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 });
  assert.equal(result.ok, false);
  assert.equal(await store.getBalance("u1"), 5_000);
});

test("if Discord refuses the role change after payment, the member still owns the color", async () => {
  const { service, roles, store } = setup();
  const item = await addGold(service, roles, 1_000);
  store.seed("u1", 5_000);
  roles.failChanges = "denied";
  const result = await service.buy({ userId: "u1", itemId: item.id, expectedPrice: 1_000 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.equipped, false);
  assert.ok(result.ok && result.equipMessage);
  assert.equal(await store.getBalance("u1"), 4_000);
  // Later, once an admin fixed the roles, equipping is free.
  roles.failChanges = null;
  const equip = await service.equip("u1", item.id);
  assert.equal(equip.ok, true);
  assert.equal(await store.getBalance("u1"), 4_000);
  assert.ok(roles.worn_.get("u1")?.has("role-gold"));
});

// ------------------------------------------------------------ wearing

test("a member wears one shop color at a time and switching is free", async () => {
  const { service, roles, store } = setup();
  const gold = await addGold(service, roles, 1_000, "role-gold");
  const red = await addGold(service, roles, 2_000, "role-red");
  store.seed("u1", 10_000);
  await service.buy({ userId: "u1", itemId: gold.id, expectedPrice: 1_000 });
  await service.buy({ userId: "u1", itemId: red.id, expectedPrice: 2_000 });
  assert.deepEqual([...(roles.worn_.get("u1") ?? [])], ["role-red"]);

  const back = await service.equip("u1", gold.id);
  assert.equal(back.ok, true);
  assert.deepEqual([...(roles.worn_.get("u1") ?? [])], ["role-gold"]);
  assert.equal(await store.getBalance("u1"), 7_000, "switching costs nothing");
  assert.equal((await service.wornItem("u1"))?.id, gold.id);

  const off = await service.unequip("u1");
  assert.equal(off.ok, true);
  assert.equal((await service.wornItem("u1")), null);
  assert.equal((await service.listOwned("u1")).length, 2, "still owned after taking it off");
});

test("you cannot wear a color you do not own", async () => {
  const { service, roles } = setup();
  const item = await addGold(service, roles, 1_000);
  const result = await service.equip("stranger", item.id);
  assert.equal(result.ok, false);
  assert.equal(roles.worn_.get("stranger")?.size ?? 0, 0);
});

// ------------------------------------------------------------ step 2: ordering, counts, color overrides

test("edit can move a color to a new position and the order is renumbered", async () => {
  const { service, roles } = setup();
  await addGold(service, roles, 100, "a");
  await addGold(service, roles, 200, "b");
  await addGold(service, roles, 300, "c");
  assert.deepEqual((await service.listItems()).map((i) => i.roleId), ["a", "b", "c"]);

  const moved = await service.editItem({ role: role({ id: "c", name: "c" }), position: 1 });
  assert.equal(moved.ok, true);
  assert.deepEqual((await service.listItems()).map((i) => i.roleId), ["c", "a", "b"]);

  // A position past the end puts it last.
  await service.editItem({ role: role({ id: "c", name: "c" }), position: 99 });
  assert.deepEqual((await service.listItems()).map((i) => i.roleId), ["a", "b", "c"]);

  const bad = await service.editItem({ role: role({ id: "c", name: "c" }), position: 0 });
  assert.equal(bad.ok, false);
});

test("owner counts are reported per item", async () => {
  const { service, roles, store } = setup();
  const a = await addGold(service, roles, 100, "a");
  await addGold(service, roles, 100, "b");
  store.seed("u1", 1_000);
  store.seed("u2", 1_000);
  await service.buy({ userId: "u1", itemId: a.id, expectedPrice: 100 });
  await service.buy({ userId: "u2", itemId: a.id, expectedPrice: 100 });
  const counts = await service.ownerCounts();
  assert.equal(counts.get(a.id), 2);
  assert.equal(counts.size, 1);
});

test("colored roles above a shop role are reported because they hide its color", () => {
  const names = outrankingColoredRoles(5, [
    { name: "Gold milestone", position: 9, color: 0xffd700 },
    { name: "Plain high role", position: 9, color: 0 },
    { name: "Low colored role", position: 2, color: 0xff0000 },
  ]);
  assert.deepEqual(names, ["Gold milestone"]);
});

test("editing a role that is not in the shop is refused", async () => {
  const { service } = setup();
  const result = await service.editItem({ role: role({ id: "ghost" }), price: 10 });
  assert.equal(result.ok, false);
});
