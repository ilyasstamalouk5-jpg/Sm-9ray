import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import { EconomyService } from "../src/economy/economy-service.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

function setup(env: Record<string, string> = {}) {
  const store = new MemoryEconomyStore(0);
  const service = new EconomyService({ store, config: loadEconomyConfig(env) });
  return { store, service };
}

test("the receiver gets the amount minus a 5% tax by default", async () => {
  const { store, service } = setup();
  store.seed("a", 1_000);
  const r = await service.pay({ fromUserId: "a", toUserId: "b", amount: 500, interactionId: "i1" });
  assert.deepEqual(r, { ok: true, amount: 500, tax: 25, received: 475, fromBalance: 500, toBalance: 475 });
  assert.equal(await store.getBalance("a"), 500);
  assert.equal(await store.getBalance("b"), 475);
});

test("tax rounds down, so small payments are tax-free", async () => {
  const { service } = setup();
  assert.equal(service.payTax(19), 0);
  assert.equal(service.payTax(20), 1);
  assert.equal(service.payTax(999), 49);
});

test("PAY_TAX_PERCENT=0 means no tax", async () => {
  const { store, service } = setup({ PAY_TAX_PERCENT: "0" });
  store.seed("a", 100);
  const r = await service.pay({ fromUserId: "a", toUserId: "b", amount: 100, interactionId: "i1" });
  assert.equal(r.ok && r.received, 100);
});

test("not enough money: refused and nothing changes", async () => {
  const { store, service } = setup();
  store.seed("a", 100);
  const r = await service.pay({ fromUserId: "a", toUserId: "b", amount: 101, interactionId: "i1" });
  assert.equal(r.ok, false);
  assert.equal(await store.getBalance("a"), 100);
  assert.equal(await store.getBalance("b"), 0);
});

test("cannot pay yourself, and amount limits are enforced", async () => {
  const { store, service } = setup();
  store.seed("a", 1_000_000);
  for (const [to, amount] of [["a", 100], ["b", 9], ["b", 100_001], ["b", 1.5], ["b", Number.NaN]] as const) {
    const r = await service.pay({ fromUserId: "a", toUserId: to, amount, interactionId: `x${amount}` });
    assert.equal(r.ok, false, `${to} ${amount}`);
  }
  assert.equal(await store.getBalance("a"), 1_000_000);
  assert.equal(store.ledger.filter((row) => row.kind.startsWith("transfer")).length, 0);
});

test("the same interaction cannot pay twice", async () => {
  const { store, service } = setup();
  store.seed("a", 1_000);
  await service.pay({ fromUserId: "a", toUserId: "b", amount: 100, interactionId: "same" });
  const again = await service.pay({ fromUserId: "a", toUserId: "b", amount: 100, interactionId: "same" });
  assert.equal(again.ok, false);
  assert.equal(await store.getBalance("a"), 900);
  assert.equal(await store.getBalance("b"), 95);
});

test("each payment writes a transfer_out and a transfer_in ledger row", async () => {
  const { store, service } = setup();
  store.seed("a", 1_000);
  await service.pay({ fromUserId: "a", toUserId: "b", amount: 100, interactionId: "i1" });
  const rows = store.ledger.filter((row) => row.kind.startsWith("transfer"));
  assert.deepEqual(rows.map((r) => [r.userId, r.kind, r.amount]), [["a", "transfer_out", -100], ["b", "transfer_in", 95]]);
});

test("config rejects a min above the max", async () => {
  assert.throws(() => loadEconomyConfig({ PAY_TAX_PERCENT: "60" }));
});
