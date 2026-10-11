import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import { EconomyService } from "../src/economy/economy-service.js";
import { WalletCurrencyRewardProvider } from "../src/economy/currency-provider.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

function setup(startTime = new Date("2026-01-01T00:00:00Z")) {
  const store = new MemoryEconomyStore(0);
  const clock = { now: startTime };
  const service = new EconomyService({
    store,
    config: loadEconomyConfig({}),
    clock: () => clock.now,
  });
  return { store, clock, service };
}
const hours = (n: number) => n * 3_600_000;

test("new wallets start at 0 DH", async () => {
  const { service } = setup();
  assert.equal(await service.getBalance("u1"), 0);
});

test("credit adds Dirhams and the same idempotency key applies only once", async () => {
  const { store } = setup();
  const first = await store.credit({ userId: "u1", amount: 100, kind: "t", idempotencyKey: "k1" });
  const second = await store.credit({ userId: "u1", amount: 100, kind: "t", idempotencyKey: "k1" });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(await store.getBalance("u1"), 100);
});

test("debits never take a wallet below zero", async () => {
  const { store } = setup();
  store.seed("u1", 50);
  const result = await store.settleInstantGame({
    userId: "u1", kind: "coinflip", wager: 100, payout: 0, idempotencyKey: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(await store.getBalance("u1"), 50);
});

test("/work pays exactly 400 DH and is locked for exactly 4 hours", async () => {
  const { service, clock } = setup();
  const first = await service.work("u1");
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.amount, 400);
  assert.equal(await service.getBalance("u1"), 400);

  clock.now = new Date(clock.now.getTime() + hours(4) - 1);
  const early = await service.work("u1");
  assert.equal(early.ok, false);
  assert.equal(await service.getBalance("u1"), 400);

  clock.now = new Date(clock.now.getTime() + 1); // exactly 4h after the claim
  const again = await service.work("u1");
  assert.equal(again.ok, true);
  assert.equal(await service.getBalance("u1"), 800);
});

test("/daily pays exactly 1,000 DH and is locked for exactly 24 hours", async () => {
  const { service, clock } = setup();
  const first = await service.daily("u1");
  assert.equal(first.ok && first.amount, 1000);
  assert.equal(first.ok && first.nextClaimAt.getTime(), clock.now.getTime() + hours(24));

  clock.now = new Date(clock.now.getTime() + hours(24) - 1);
  assert.equal((await service.daily("u1")).ok, false);
  clock.now = new Date(clock.now.getTime() + 1);
  assert.equal((await service.daily("u1")).ok, true);
  assert.equal(await service.getBalance("u1"), 2000);
});

test("work and daily cooldowns are independent", async () => {
  const { service } = setup();
  assert.equal((await service.work("u1")).ok, true);
  assert.equal((await service.daily("u1")).ok, true);
  assert.equal(await service.getBalance("u1"), 1400);
});

test("simultaneous /work claims pay only once", async () => {
  const { service } = setup();
  const results = await Promise.all(Array.from({ length: 10 }, () => service.work("u1")));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await service.getBalance("u1"), 400);
});

test("cooldowns survive a restart (a new service on the same storage)", async () => {
  const { store, clock, service } = setup();
  await service.work("u1");
  const restarted = new EconomyService({ store, config: loadEconomyConfig({}), clock: () => clock.now });
  assert.equal((await restarted.work("u1")).ok, false);
});

test("a milestone reward is paid only once per member and milestone", async () => {
  const { store } = setup();
  const provider = new WalletCurrencyRewardProvider(store);
  const event = { discordUserId: "u1", milestoneId: "3", amount: 250, idempotencyKey: "u1:3" };
  assert.deepEqual(await provider.awardCurrency(event), { status: "issued" });
  assert.deepEqual(await provider.awardCurrency(event), { status: "issued" });
  await Promise.all([provider.awardCurrency(event), provider.awardCurrency(event)]);
  assert.equal(await store.getBalance("u1"), 250);
  await provider.awardCurrency({ ...event, milestoneId: "4", idempotencyKey: "u1:4" });
  assert.equal(await store.getBalance("u1"), 500);
});
