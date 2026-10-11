import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig } from "../src/economy/economy-config.js";
import { EconomyService } from "../src/economy/economy-service.js";
import { appleTowerPayout } from "../src/economy/games/apple-tower.js";
import {
  blackjackPayout,
  handValue,
  hit,
  isNatural,
  stand,
  startBlackjack,
  type BlackjackState,
} from "../src/economy/games/blackjack.js";
import { minesMultiplier, minesPayout, type MinesState } from "../src/economy/games/mines.js";
import type { AppleTowerState } from "../src/economy/games/apple-tower.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

function setup(env: Record<string, string> = {}, rand: (n: number) => number = () => 0) {
  const store = new MemoryEconomyStore(0);
  const clock = { now: new Date("2026-01-01T00:00:00Z") };
  let counter = 0;
  const service = new EconomyService({
    store,
    config: loadEconomyConfig(env),
    clock: () => clock.now,
    rand,
    newId: () => `game-${(counter += 1)}`,
  });
  return { store, clock, service };
}

// Card helpers: rank 0 = Ace, 1-8 = 2..9, 9-12 = ten-value cards.
const A = 0, TWO = 1, FIVE = 4, SIX = 5, SEVEN = 6, EIGHT = 7, NINE = 8, TEN = 9, K = 12;

// ------------------------------------------------------------- wager limits

test("wagers must be whole numbers between 10 and 10,000 DH", async () => {
  const { service, store } = setup();
  store.seed("u1", 50_000);
  for (const bad of [0, 9, 10_001, -5, 1.5, Number.NaN]) {
    const result = await service.coinflip({ userId: "u1", wager: bad, choice: "heads", interactionId: `i${bad}` });
    assert.equal(result.ok, false, `wager ${bad} should be rejected`);
  }
  assert.equal((await service.startMines({ userId: "u1", wager: 5, channelId: null })).ok, false);
  assert.equal((await service.startBlackjack({ userId: "u1", wager: 20_000, channelId: null })).ok, false);
  assert.equal((await service.startAppleTower({ userId: "u1", wager: 0, channelId: null })).ok, false);
  assert.equal(await service.getBalance("u1"), 50_000);
  assert.equal((await service.coinflip({ userId: "u1", wager: 10, choice: "heads", interactionId: "min" })).ok, true);
  assert.equal((await service.coinflip({ userId: "u1", wager: 10_000, choice: "heads", interactionId: "max" })).ok, true);
});

// ---------------------------------------------------------------- coinflip

test("coinflip win returns the stake plus winnings (1.95x total by default)", async () => {
  const { service, store } = setup({}, () => 0); // 0 = heads
  store.seed("u1", 1000);
  const result = await service.coinflip({ userId: "u1", wager: 100, choice: "heads", interactionId: "a" });
  assert.equal(result.ok && result.won, true);
  assert.equal(result.ok && result.payout, 195);
  assert.equal(result.ok && result.net, 95);
  assert.equal(await service.getBalance("u1"), 1095);
});

test("coinflip loss costs the stake", async () => {
  const { service, store } = setup({}, () => 0);
  store.seed("u1", 1000);
  const result = await service.coinflip({ userId: "u1", wager: 100, choice: "tails", interactionId: "a" });
  assert.equal(result.ok && result.won, false);
  assert.equal(result.ok && result.net, -100);
  assert.equal(await service.getBalance("u1"), 900);
});

test("coinflip payout rule is configurable", async () => {
  const { service, store } = setup({ COINFLIP_PAYOUT_PERCENT: "200" }, () => 0);
  store.seed("u1", 1000);
  await service.coinflip({ userId: "u1", wager: 100, choice: "heads", interactionId: "a" });
  assert.equal(await service.getBalance("u1"), 1100);
});

test("coinflip cannot be settled twice for the same interaction", async () => {
  const { service, store } = setup({}, () => 0);
  store.seed("u1", 1000);
  const first = await service.coinflip({ userId: "u1", wager: 100, choice: "heads", interactionId: "same" });
  const replay = await service.coinflip({ userId: "u1", wager: 100, choice: "heads", interactionId: "same" });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, false);
  assert.equal(await service.getBalance("u1"), 1095);
});

test("simultaneous coinflips cannot spend the same Dirhams twice", async () => {
  const { service, store } = setup({}, () => 1); // always tails, so heads loses
  store.seed("u1", 100);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      service.coinflip({ userId: "u1", wager: 100, choice: "heads", interactionId: `race${index}` }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await service.getBalance("u1"), 0);
});

test("coinflip with too little balance is refused and nothing changes", async () => {
  const { service, store } = setup();
  store.seed("u1", 50);
  const result = await service.coinflip({ userId: "u1", wager: 100, choice: "heads", interactionId: "a" });
  assert.equal(result.ok, false);
  assert.equal(await service.getBalance("u1"), 50);
});

// ------------------------------------------------------------------- mines

test("mines multiplier formula and exact payouts", () => {
  // 3 mines, 1 safe tile, 3% edge: 100 * 0.97 * 20/17 = 114.1 -> 114
  assert.equal(minesPayout(100, 3, 1, 3, 1_000_000), 114);
  // 3 mines, 2 safe tiles: 100 * 0.97 * (20/17) * (19/16) = 135.5 -> 135
  assert.equal(minesPayout(100, 3, 2, 3, 1_000_000), 135);
  assert.ok(Math.abs(minesMultiplier(3, 1, 3) - 1.1412) < 0.001);
  // never above the cap
  assert.equal(minesPayout(10_000, 10, 10, 3, 5_000), 5_000);
  // payout always grows with every safe tile
  let previous = 0;
  for (let k = 1; k <= 17; k += 1) {
    const value = minesPayout(10_000, 3, k, 3, 1_000_000_000);
    assert.ok(value > previous);
    previous = value;
  }
});

async function startMinesGame(service: EconomyService, store: MemoryEconomyStore, userId = "u1") {
  store.seed(userId, 1000);
  const started = await service.startMines({ userId, wager: 100, channelId: "c1" });
  assert.equal(started.ok, true);
  assert.ok(started.ok && started.view.type === "mines");
  const gameId = started.ok ? started.view.gameId : "";
  const state = store.games.get(gameId)?.state as MinesState;
  const safeTiles = Array.from({ length: 20 }, (_, i) => i).filter((i) => !state.mines.includes(i));
  return { gameId, state, safeTiles };
}

test("mines: starting takes the wager, uses 3 mines by default, and hides the mines", async () => {
  const { service, store } = setup();
  const { state } = await startMinesGame(service, store);
  assert.equal(state.mineCount, 3);
  assert.equal(state.mines.length, 3);
  assert.equal(await service.getBalance("u1"), 900);
});

test("mines: safe tile, then cashout pays the documented amount once", async () => {
  const { service, store } = setup();
  const { gameId, safeTiles } = await startMinesGame(service, store);
  const reveal = await service.minesReveal(gameId, "u1", safeTiles[0] as number);
  assert.ok(reveal.ok && reveal.view.type === "mines" && !reveal.view.ended && reveal.view.mines === null);
  const cash = await service.minesCashout(gameId, "u1");
  assert.ok(cash.ok && cash.view.type === "mines" && cash.view.ended && cash.view.payout === 114);
  assert.equal(await service.getBalance("u1"), 900 + 114);
  assert.equal((await service.minesCashout(gameId, "u1")).ok, false);
  assert.equal(await service.getBalance("u1"), 1014);
});

test("mines: hitting a mine loses the stake and reveals the board", async () => {
  const { service, store } = setup();
  const { gameId, state } = await startMinesGame(service, store);
  const result = await service.minesReveal(gameId, "u1", state.mines[0] as number);
  assert.ok(result.ok && result.view.type === "mines" && result.view.ended && result.view.payout === 0);
  assert.ok(result.ok && result.view.type === "mines" && result.view.mines?.length === 3);
  assert.equal(await service.getBalance("u1"), 900);
  assert.equal((await service.minesReveal(gameId, "u1", 0)).ok, false);
});

test("mines: cashout is not allowed before the first safe tile", async () => {
  const { service, store } = setup();
  const { gameId } = await startMinesGame(service, store);
  const result = await service.minesCashout(gameId, "u1");
  assert.equal(!result.ok && result.reason, "invalid_move");
  assert.equal(await service.getBalance("u1"), 900);
});

test("mines: only the player who started the game can use it", async () => {
  const { service, store } = setup();
  const { gameId, safeTiles } = await startMinesGame(service, store);
  const reveal = await service.minesReveal(gameId, "intruder", safeTiles[0] as number);
  const cash = await service.minesCashout(gameId, "intruder");
  assert.equal(!reveal.ok && reveal.reason, "not_owner");
  assert.equal(!cash.ok && cash.reason, "not_owner");
});

test("mines: double-clicking cashout settles exactly once", async () => {
  const { service, store } = setup();
  const { gameId, safeTiles } = await startMinesGame(service, store);
  await service.minesReveal(gameId, "u1", safeTiles[0] as number);
  const results = await Promise.all([
    service.minesCashout(gameId, "u1"),
    service.minesCashout(gameId, "u1"),
    service.minesCashout(gameId, "u1"),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await service.getBalance("u1"), 1014);
});

test("mines: two clicks on the same tile only count once", async () => {
  const { service, store } = setup();
  const { gameId, safeTiles } = await startMinesGame(service, store);
  const results = await Promise.all([
    service.minesReveal(gameId, "u1", safeTiles[0] as number),
    service.minesReveal(gameId, "u1", safeTiles[0] as number),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("mines: only one game at a time, and the second one is not charged", async () => {
  const { service, store } = setup();
  await startMinesGame(service, store);
  const second = await service.startMines({ userId: "u1", wager: 100, channelId: "c1" });
  assert.equal(!second.ok && second.reason, "active_game_exists");
  assert.equal(await service.getBalance("u1"), 900);
});

test("mines: mine count is configurable and validated", async () => {
  const { service, store } = setup({ MINES_MAX_COUNT: "5" });
  store.seed("u1", 1000);
  assert.equal((await service.startMines({ userId: "u1", wager: 100, channelId: null, mineCount: 6 })).ok, false);
  const ok = await service.startMines({ userId: "u1", wager: 100, channelId: null, mineCount: 5 });
  assert.ok(ok.ok && ok.view.type === "mines" && ok.view.mineCount === 5);
});

// ------------------------------------------------------------- apple tower

async function startTowerGame(service: EconomyService, store: MemoryEconomyStore) {
  store.seed("u1", 1000);
  const started = await service.startAppleTower({ userId: "u1", wager: 100, channelId: "c1" });
  assert.ok(started.ok && started.view.type === "appletower");
  const gameId = started.ok ? started.view.gameId : "";
  const state = store.games.get(gameId)?.state as AppleTowerState;
  return { gameId, state };
}

test("apple tower payout: wager * 0.97 * 3^levels, rounded down", () => {
  assert.equal(appleTowerPayout(100, 1, 3, 1_000_000), 291);
  assert.equal(appleTowerPayout(100, 2, 3, 1_000_000), 873);
  assert.equal(appleTowerPayout(10_000, 8, 3, 1_000_000), 1_000_000); // capped
});

test("apple tower: correct pick advances, cashout pays 291 DH once", async () => {
  const { service, store } = setup();
  const { gameId, state } = await startTowerGame(service, store);
  const pick = await service.towerPick(gameId, "u1", state.safe[0] as number);
  assert.ok(pick.ok && pick.view.type === "appletower" && pick.view.levelsCleared === 1 && !pick.view.ended);
  assert.ok(pick.ok && pick.view.type === "appletower" && pick.view.cashoutValue === 291 && pick.view.safeApples === null);
  const cash = await service.towerCashout(gameId, "u1");
  assert.ok(cash.ok && cash.view.payout === 291);
  assert.equal(await service.getBalance("u1"), 900 + 291);
  assert.equal((await service.towerCashout(gameId, "u1")).ok, false);
});

test("apple tower: a wrong apple loses the stake", async () => {
  const { service, store } = setup();
  const { gameId, state } = await startTowerGame(service, store);
  const wrong = ((state.safe[0] as number) + 1) % 3;
  const result = await service.towerPick(gameId, "u1", wrong);
  assert.ok(result.ok && result.view.type === "appletower" && result.view.ended && result.view.payout === 0);
  assert.equal(await service.getBalance("u1"), 900);
});

test("apple tower: cashout needs one cleared level, and only the owner can play", async () => {
  const { service, store } = setup();
  const { gameId, state } = await startTowerGame(service, store);
  assert.equal((await service.towerCashout(gameId, "u1")).ok, false);
  const stranger = await service.towerPick(gameId, "u2", state.safe[0] as number);
  assert.equal(!stranger.ok && stranger.reason, "not_owner");
});

test("apple tower: reaching the top cashes out automatically", async () => {
  const { service, store } = setup({ APPLE_TOWER_LEVELS: "2" });
  const { gameId, state } = await startTowerGame(service, store);
  await service.towerPick(gameId, "u1", state.safe[0] as number);
  const top = await service.towerPick(gameId, "u1", state.safe[1] as number);
  assert.ok(top.ok && top.view.type === "appletower" && top.view.ended && top.view.payout === 873);
  assert.equal(await service.getBalance("u1"), 900 + 873);
});

// ---------------------------------------------------------------- blackjack

const rules = { dealerHitsSoft17: false };
const bj = (over: Partial<BlackjackState>): BlackjackState => ({
  deck: [], player: [], dealer: [], phase: "player", outcome: null, ...over,
});

test("blackjack hand values and ace handling", () => {
  assert.deepEqual(handValue([A, K]), { total: 21, soft: true });
  assert.deepEqual(handValue([A, A]), { total: 12, soft: true });
  assert.deepEqual(handValue([A, K, FIVE]), { total: 16, soft: false });
  assert.deepEqual(handValue([A, SIX]), { total: 17, soft: true });
  assert.deepEqual(handValue([A, A, A, EIGHT]), { total: 21, soft: true });
  assert.equal(handValue([K, K, TWO]).total, 22);
  assert.equal(isNatural([A, K]), true);
  assert.equal(isNatural([SIX, FIVE, TEN]), false);
});

test("blackjack: hit to bust loses, hit to 21 stands automatically", () => {
  const bust = hit(bj({ player: [TEN, SIX], dealer: [NINE, SEVEN], deck: [K] }), rules);
  assert.equal(bust.outcome, "bust");
  const twentyOne = hit(bj({ player: [TEN, SIX], dealer: [NINE, SEVEN], deck: [FIVE, K] }), rules);
  assert.equal(twentyOne.phase, "done"); // dealer drew the K and busted at 26
  assert.equal(twentyOne.outcome, "win");
});

test("blackjack: dealer stands on 17, hits soft 17 only when configured", () => {
  const start = bj({ player: [TEN, NINE], dealer: [A, SIX], deck: [FIVE, K] });
  assert.equal(stand(start, { dealerHitsSoft17: false }).dealer.length, 2);
  assert.equal(stand(start, { dealerHitsSoft17: true }).dealer.length, 4); // A+6+5, then K
});

test("blackjack: win, lose and push", () => {
  assert.equal(stand(bj({ player: [TEN, NINE], dealer: [TEN, SEVEN] }), rules).outcome, "win");
  assert.equal(stand(bj({ player: [TEN, SEVEN], dealer: [TEN, NINE] }), rules).outcome, "lose");
  assert.equal(stand(bj({ player: [TEN, EIGHT], dealer: [TEN, EIGHT] }), rules).outcome, "push");
});

test("blackjack payouts: natural 3:2, win 1:1, push returns the stake, loss pays nothing", () => {
  assert.equal(blackjackPayout(100, "blackjack", 150, 1e6), 250);
  assert.equal(blackjackPayout(101, "blackjack", 150, 1e6), 252); // 101 + floor(151.5)
  assert.equal(blackjackPayout(100, "win", 150, 1e6), 200);
  assert.equal(blackjackPayout(100, "push", 150, 1e6), 100);
  assert.equal(blackjackPayout(100, "lose", 150, 1e6), 0);
  assert.equal(blackjackPayout(100, "bust", 150, 1e6), 0);
  assert.equal(blackjackPayout(100, "dealer_blackjack", 150, 1e6), 0);
});

test("blackjack: opening naturals are resolved correctly across thousands of random deals", () => {
  let naturals = 0;
  for (let index = 0; index < 4000; index += 1) {
    const state = startBlackjack();
    const playerNatural = isNatural(state.player);
    const dealerNatural = isNatural(state.dealer);
    assert.equal(state.player.length, 2);
    assert.equal(new Set([...state.player, ...state.dealer, ...state.deck]).size, 52);
    if (playerNatural || dealerNatural) {
      naturals += 1;
      assert.equal(state.phase, "done");
      assert.equal(
        state.outcome,
        playerNatural && dealerNatural ? "push" : playerNatural ? "blackjack" : "dealer_blackjack",
      );
    } else {
      assert.equal(state.phase, "player");
      assert.equal(state.outcome, null);
    }
  }
  assert.ok(naturals > 0);
});

async function riggedBlackjack(
  service: EconomyService,
  store: MemoryEconomyStore,
  state: BlackjackState,
  wager = 100,
) {
  store.seed("u1", 1000);
  const started = await store.startGame({
    id: "bj-1", userId: "u1", gameType: "blackjack", wager, state, channelId: "c1",
    now: new Date(), expiresAt: new Date("2026-01-01T00:10:00Z"),
  });
  assert.equal(started.ok, true);
  return "bj-1";
}

test("blackjack service: stand and win pays 2x the wager once", async () => {
  const { service, store } = setup();
  const id = await riggedBlackjack(service, store, bj({ player: [TEN, NINE], dealer: [TEN, SEVEN] }));
  const results = await Promise.all([service.blackjackStand(id, "u1"), service.blackjackStand(id, "u1")]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await service.getBalance("u1"), 900 + 200);
});

test("blackjack service: loss, bust and push", async () => {
  for (const [state, expected] of [
    [bj({ player: [TEN, SEVEN], dealer: [TEN, NINE] }), 900],
    [bj({ player: [TEN, EIGHT], dealer: [TEN, EIGHT] }), 1000],
  ] as const) {
    const { service, store } = setup();
    const id = await riggedBlackjack(service, store, state);
    await service.blackjackStand(id, "u1");
    assert.equal(await service.getBalance("u1"), expected);
  }
  const { service, store } = setup();
  const id = await riggedBlackjack(service, store, bj({ player: [TEN, SIX], dealer: [NINE, SEVEN], deck: [K] }));
  const bust = await service.blackjackHit(id, "u1");
  assert.ok(bust.ok && bust.view.type === "blackjack" && bust.view.outcome === "bust");
  assert.equal(await service.getBalance("u1"), 900);
});

test("blackjack service: only the owner can hit or stand", async () => {
  const { service, store } = setup();
  const id = await riggedBlackjack(service, store, bj({ player: [TEN, SIX], dealer: [NINE, SEVEN], deck: [K] }));
  assert.equal((await service.blackjackHit(id, "intruder")).ok, false);
  assert.equal((await service.blackjackStand(id, "intruder")).ok, false);
});

test("blackjack service: a natural at the deal pays 3:2 immediately", async () => {
  // Re-deal until the random start produces a player natural.
  const { service, store } = setup({}, (n) => Math.floor(Math.random() * n));
  store.seed("u1", 100_000);
  let found = false;
  for (let attempt = 0; attempt < 3000 && !found; attempt += 1) {
    const before = await service.getBalance("u1");
    const started = await service.startBlackjack({ userId: "u1", wager: 100, channelId: null });
    assert.ok(started.ok && started.view.type === "blackjack");
    const view = started.ok && started.view.type === "blackjack" ? started.view : null;
    if (view?.ended) {
      const delta = (await service.getBalance("u1")) - before;
      if (view.outcome === "blackjack") {
        assert.equal(delta, 150);
        found = true;
      } else if (view.outcome === "push") {
        assert.equal(delta, 0);
      } else {
        assert.equal(view.outcome, "dealer_blackjack");
        assert.equal(delta, -100);
      }
    } else if (view) {
      await service.blackjackStand(view.gameId, "u1"); // finish so a new hand can start
    }
  }
  assert.ok(found, "expected to see a player natural in 3000 deals");
});

// ------------------------------------------------------------- timeout rules

test("expired games are settled automatically: refund, cashout, auto-stand", async () => {
  const { service, store, clock } = setup();
  // mines with no progress -> refund
  store.seed("a", 1000);
  await service.startMines({ userId: "a", wager: 100, channelId: null });
  // appletower with one cleared level -> cashout
  store.seed("b", 1000);
  const tower = await service.startAppleTower({ userId: "b", wager: 100, channelId: null });
  const towerId = tower.ok ? tower.view.gameId : "";
  await service.towerPick(towerId, "b", (store.games.get(towerId)?.state as AppleTowerState).safe[0] as number);
  // blackjack -> auto-stand, player 20 vs dealer 17 wins
  store.seed("c", 1000);
  await store.startGame({
    id: "bj-exp", userId: "c", gameType: "blackjack", wager: 100,
    state: bj({ player: [TEN, K], dealer: [TEN, SEVEN] }), channelId: null,
    now: clock.now, expiresAt: new Date(clock.now.getTime() + 600_000),
  });

  clock.now = new Date(clock.now.getTime() + 11 * 60_000);
  assert.equal(await service.resolveExpiredGames(), 3);
  assert.equal(await service.getBalance("a"), 1000);
  assert.equal(await service.getBalance("b"), 900 + 291);
  assert.equal(await service.getBalance("c"), 900 + 200);
  assert.equal(await service.resolveExpiredGames(), 0);
});

test("pressing a button on an expired game settles it and says so", async () => {
  const { service, store, clock } = setup();
  const { gameId, safeTiles } = await startMinesGame(service, store);
  clock.now = new Date(clock.now.getTime() + 11 * 60_000);
  const result = await service.minesReveal(gameId, "u1", safeTiles[0] as number);
  assert.equal(!result.ok && result.reason, "expired");
  assert.equal(await service.getBalance("u1"), 1000);
});

test("unfinished games keep their state across a restart (new service, same storage)", async () => {
  const { service, store, clock } = setup();
  const { gameId, safeTiles } = await startMinesGame(service, store);
  await service.minesReveal(gameId, "u1", safeTiles[0] as number);
  const restarted = new EconomyService({ store, config: loadEconomyConfig({}), clock: () => clock.now });
  const next = await restarted.minesReveal(gameId, "u1", safeTiles[1] as number);
  assert.ok(next.ok && next.view.type === "mines" && next.view.revealed.length === 2);
});
