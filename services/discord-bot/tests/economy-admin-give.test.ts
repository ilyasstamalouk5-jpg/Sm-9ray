import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import { ADMIN_GIVE_MAX, EconomyService } from "../src/economy/economy-service.js";
import type { CreditResult } from "../src/economy/store.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

function setup() {
  const store = new MemoryEconomyStore(0);
  let counter = 0;
  const service = new EconomyService({
    store,
    config: loadEconomyConfig({}),
    newId: () => `id-${(counter += 1)}`,
  });
  return { store, service };
}

test("an admin can add Dirhams to a member who has nothing yet", async () => {
  const { store, service } = setup();
  const result = await service.adminGive({ adminId: "admin", userId: "u1", amount: 5_000 });
  assert.deepEqual(result, { ok: true, amount: 5_000, balance: 5_000 });
  assert.equal(await store.getBalance("u1"), 5_000);
});

test("the amount is added on top of the current balance", async () => {
  const { store, service } = setup();
  store.seed("u1", 1_200);
  const result = await service.adminGive({ adminId: "admin", userId: "u1", amount: 300 });
  assert.equal(result.ok && result.balance, 1_500);
});

test("every use writes its own ledger row of kind admin_give", async () => {
  const { store, service } = setup();
  await service.adminGive({ adminId: "admin", userId: "u1", amount: 100 });
  await service.adminGive({ adminId: "admin", userId: "u1", amount: 100 });
  const rows = store.ledger.filter((row) => row.kind === "admin_give");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0]?.key, rows[1]?.key);
  assert.equal(await store.getBalance("u1"), 200);
});

test("zero, negative, fractional, huge and non-numeric amounts are refused and change nothing", async () => {
  const { store, service } = setup();
  for (const amount of [0, -5, 1.5, ADMIN_GIVE_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = await service.adminGive({ adminId: "admin", userId: "u1", amount });
    assert.equal(result.ok, false, `amount ${amount}`);
  }
  assert.equal(await store.getBalance("u1"), 0);
  assert.equal(store.ledger.length, 0);
});

test("the largest allowed amount is accepted", async () => {
  const { service } = setup();
  const result = await service.adminGive({ adminId: "admin", userId: "u1", amount: ADMIN_GIVE_MAX });
  assert.equal(result.ok, true);
});

test("a wallet that would overflow gives a friendly message instead of crashing", async () => {
  const { store, service } = setup();
  store.credit = async (): Promise<CreditResult> => {
    throw new RangeError("Wallet balance is out of range.");
  };
  const result = await service.adminGive({ adminId: "admin", userId: "u1", amount: 10 });
  assert.equal(result.ok, false);
});

// ------------------------------------------------------------------ take

test("an admin can remove Dirhams from a member", async () => {
  const { store, service } = setup();
  store.seed("u1", 1_000);
  const result = await service.adminTake({ adminId: "admin", userId: "u1", amount: 400 });
  assert.deepEqual(result, { ok: true, amount: 400, balance: 600 });
  assert.equal(await store.getBalance("u1"), 600);
});

test("taking exactly the whole balance leaves 0", async () => {
  const { store, service } = setup();
  store.seed("u1", 250);
  const result = await service.adminTake({ adminId: "admin", userId: "u1", amount: 250 });
  assert.equal(result.ok && result.balance, 0);
  assert.equal(await store.getBalance("u1"), 0);
});

test("taking more than the member has is refused and changes nothing", async () => {
  const { store, service } = setup();
  store.seed("u1", 100);
  const before = store.ledger.length;
  const result = await service.adminTake({ adminId: "admin", userId: "u1", amount: 101 });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /only has 100 DH/);
  assert.equal(await store.getBalance("u1"), 100);
  assert.equal(store.ledger.length, before);
});

test("taking from an empty wallet is refused", async () => {
  const { service } = setup();
  const result = await service.adminTake({ adminId: "admin", userId: "nobody", amount: 1 });
  assert.equal(result.ok, false);
});

test("every take writes its own admin_take ledger row with a negative amount", async () => {
  const { store, service } = setup();
  store.seed("u1", 1_000);
  await service.adminTake({ adminId: "admin", userId: "u1", amount: 100 });
  await service.adminTake({ adminId: "admin", userId: "u1", amount: 100 });
  const rows = store.ledger.filter((row) => row.kind === "admin_take");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.amount === -100));
  assert.notEqual(rows[0]?.key, rows[1]?.key);
});

test("take refuses zero, negative, fractional and oversized amounts", async () => {
  const { store, service } = setup();
  store.seed("u1", 1_000);
  for (const amount of [0, -5, 1.5, ADMIN_GIVE_MAX + 1, Number.NaN]) {
    const result = await service.adminTake({ adminId: "admin", userId: "u1", amount });
    assert.equal(result.ok, false, `amount ${amount}`);
  }
  assert.equal(await store.getBalance("u1"), 1_000);
});

test("give then take returns the wallet to where it started", async () => {
  const { store, service } = setup();
  store.seed("u1", 70);
  await service.adminGive({ adminId: "admin", userId: "u1", amount: 500 });
  await service.adminTake({ adminId: "admin", userId: "u1", amount: 500 });
  assert.equal(await store.getBalance("u1"), 70);
});
