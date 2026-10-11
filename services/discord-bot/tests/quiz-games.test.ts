import assert from "node:assert/strict";
import test from "node:test";
import { loadEconomyConfig, validateEconomyConfig } from "../src/economy/economy-config.js";
import { BRANDS, COUNTRIES } from "../src/economy/quiz/quiz-data.js";
import { QuizService, quizReward } from "../src/economy/quiz/quiz-service.js";
import {
  fitProjection,
  readCountryShapes,
  viewForCountry,
  type Topology,
} from "../src/economy/quiz/world-map.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

const config = loadEconomyConfig({});

function setup(env: Record<string, string> = {}) {
  const store = new MemoryEconomyStore(0);
  const clock = { now: 1_000_000 };
  let counter = 0;
  const service = new QuizService({
    store,
    config: loadEconomyConfig(env),
    clock: () => clock.now,
    newId: () => `r${(counter += 1)}`,
  });
  return { store, clock, service };
}

test("quiz defaults: 40-70 DH, 15 seconds, 30 second cooldown", () => {
  assert.equal(config.quizMinReward, 40);
  assert.equal(config.quizMaxReward, 70);
  assert.equal(config.quizTimeLimitSeconds, 15);
  assert.equal(config.quizCooldownSeconds, 30);
  assert.deepEqual(validateEconomyConfig({ ...config, guildId: "123456789012345678" }), []);
  assert.equal(
    validateEconomyConfig({ ...config, guildId: "123456789012345678", quizMinReward: 80 }).length,
    1,
  );
});

test("reward is 70 for an instant answer, 40 at the last second, and falls in between", () => {
  assert.equal(quizReward(0, config), 70);
  assert.equal(quizReward(7_500, config), 55);
  assert.equal(quizReward(15_000, config), 40);
  const samples = [0, 1_000, 3_000, 6_000, 10_000, 14_000, 15_000].map((ms) => quizReward(ms, config));
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok((samples[index] as number) <= (samples[index - 1] as number), "never rises");
  }
  assert.ok(samples.every((value) => value >= 40 && value <= 70));
});

test("an answer after the time limit pays nothing", () => {
  assert.equal(quizReward(16_001, config), 0);
  assert.equal(quizReward(60_000, config), 0);
  assert.equal(quizReward(Number.NaN, config), 0);
});

test("a round has 4 distinct options and exactly one correct one", () => {
  const { service } = setup();
  for (const kind of ["flag", "map", "logo"] as const) {
    for (let round = 0; round < 25; round += 1) {
      const started = service.start(`u${kind}${round}`, kind);
      assert.ok(started.ok);
      if (!started.ok) continue;
      assert.equal(started.round.options.length, 4);
      assert.equal(new Set(started.round.options).size, 4);
      const subject = started.round.subject;
      const name = subject.kind === "logo" ? subject.brand.name : subject.country.name;
      assert.equal(started.round.options[started.round.correctIndex], name);
    }
  }
});

test("a fast correct answer pays DH once, and a second click does nothing", async () => {
  const { service, clock, store } = setup();
  const started = service.start("u1", "flag");
  assert.ok(started.ok);
  if (!started.ok) return;
  clock.now += 3_000;
  const first = await service.answer(started.round.id, "u1", started.round.correctIndex);
  assert.ok(first.ok && first.outcome === "correct");
  assert.equal(first.ok && first.reward, 64);
  assert.equal(await store.getBalance("u1"), 64);
  const again = await service.answer(started.round.id, "u1", started.round.correctIndex);
  assert.deepEqual(again, { ok: false, reason: "not_found" });
  assert.equal(await store.getBalance("u1"), 64);
});

test("wrong answers and late answers pay nothing", async () => {
  const { service, clock, store } = setup();
  const wrong = service.start("u1", "map");
  assert.ok(wrong.ok);
  if (!wrong.ok) return;
  const wrongIndex = (wrong.round.correctIndex + 1) % 4;
  const wrongResult = await service.answer(wrong.round.id, "u1", wrongIndex);
  assert.ok(wrongResult.ok && wrongResult.outcome === "wrong" && wrongResult.reward === 0);

  clock.now += 60_000;
  const late = service.start("u1", "map");
  assert.ok(late.ok);
  if (!late.ok) return;
  clock.now += 20_000;
  const lateResult = await service.answer(late.round.id, "u1", late.round.correctIndex);
  assert.ok(lateResult.ok && lateResult.outcome === "late" && lateResult.reward === 0);
  assert.equal(await store.getBalance("u1"), 0);
});

test("only the player who started the round can answer it", async () => {
  const { service } = setup();
  const started = service.start("u1", "logo");
  assert.ok(started.ok);
  if (!started.ok) return;
  assert.deepEqual(await service.answer(started.round.id, "u2", 0), { ok: false, reason: "not_owner" });
  // The owner can still answer afterwards.
  const result = await service.answer(started.round.id, "u1", started.round.correctIndex);
  assert.ok(result.ok && result.outcome === "correct");
});

test("each game has its own cooldown per player", () => {
  const { service, clock } = setup();
  assert.ok(service.start("u1", "flag").ok);
  const blocked = service.start("u1", "flag");
  assert.ok(!blocked.ok && blocked.reason === "cooldown");
  assert.ok(service.start("u1", "map").ok, "another game is independent");
  assert.ok(service.start("u2", "flag").ok, "another player is independent");
  clock.now += 30_000;
  assert.ok(service.start("u1", "flag").ok, "allowed again after 30 seconds");
});

test("expire closes an unanswered round once; cancel gives the cooldown back", async () => {
  const { service } = setup();
  const started = service.start("u1", "flag");
  assert.ok(started.ok);
  if (!started.ok) return;
  assert.equal(service.expire(started.round.id)?.id, started.round.id);
  assert.equal(service.expire(started.round.id), null);
  assert.deepEqual(await service.answer(started.round.id, "u1", 0), { ok: false, reason: "not_found" });

  const second = service.start("u2", "logo");
  assert.ok(second.ok);
  if (!second.ok) return;
  service.cancel(second.round.id);
  assert.ok(service.start("u2", "logo").ok);
});

test("restartClock starts the timer when the question is shown", async () => {
  const { service, clock } = setup();
  const started = service.start("u1", "map");
  assert.ok(started.ok);
  if (!started.ok) return;
  clock.now += 900; // time spent drawing the picture
  service.restartClock(started.round.id);
  clock.now += 1_000;
  const result = await service.answer(started.round.id, "u1", started.round.correctIndex);
  assert.ok(result.ok && result.elapsedMs === 1_000);
});

test("a game with too few questions reports itself unavailable", () => {
  const { service } = setup();
  service.setPool("logo", BRANDS.slice(0, 2));
  const started = service.start("u1", "logo");
  assert.ok(!started.ok && started.reason === "unavailable");
});

test("question data is consistent: unique codes, names and icons", () => {
  assert.equal(new Set(COUNTRIES.map((country) => country.code)).size, COUNTRIES.length);
  assert.equal(new Set(COUNTRIES.map((country) => country.name)).size, COUNTRIES.length);
  const numerics = COUNTRIES.flatMap((country) => (country.numeric ? [country.numeric] : []));
  assert.equal(new Set(numerics).size, numerics.length);
  assert.ok(COUNTRIES.every((country) => /^[A-Z]{2}$/.test(country.code)));
  assert.equal(new Set(BRANDS.map((brand) => brand.icon)).size, BRANDS.length);
  assert.equal(new Set(BRANDS.map((brand) => brand.name)).size, BRANDS.length);
});

// A tiny hand-made TopoJSON: country 4 is a square, country 8 a square with a
// hole, country 12 a main square plus a far-away speck.
const topology: Topology = {
  transform: { scale: [1, 1], translate: [10, 20] },
  arcs: [
    // arc 0: square (0,0)-(4,0)-(4,4)-(0,4)-(0,0)  stored as steps
    [[0, 0], [4, 0], [0, 4], [-4, 0], [0, -4]],
    // arc 1: outer square for country 8
    [[10, 0], [10, 0], [0, 10], [-10, 0], [0, -10]],
    // arc 2: its hole
    [[13, 3], [2, 0], [0, 2], [-2, 0], [0, -2]],
    // arc 3: speck far away
    [[100, 50], [1, 0], [0, 1], [-1, 0], [0, -1]],
  ],
  objects: {
    countries: {
      geometries: [
        { id: "004", type: "Polygon", arcs: [[0]] },
        { id: "008", type: "Polygon", arcs: [[1], [2]] },
        { id: "012", type: "MultiPolygon", arcs: [[[0]], [[3]]] },
      ],
    },
  },
};

test("world map: arcs decode with leading zeros in ids, holes and multipolygons", () => {
  const shapes = readCountryShapes(topology);
  assert.deepEqual([...shapes.keys()].sort((a, b) => a - b), [4, 8, 12]);
  const square = shapes.get(4);
  assert.deepEqual(square?.polygons[0]?.[0]?.[0], [10, 20]);
  assert.deepEqual(square?.polygons[0]?.[0]?.[2], [14, 24]);
  assert.equal(shapes.get(8)?.polygons[0]?.length, 2, "outer ring plus hole");
  assert.equal(shapes.get(12)?.polygons.length, 2);
});

test("world map: tiny far-away pieces do not stretch the view", () => {
  const shapes = readCountryShapes(topology);
  const view = viewForCountry(shapes.get(12)!);
  assert.deepEqual(view, { minLon: 10, maxLon: 14, minLat: 20, maxLat: 24 });
});

test("world map: the projection keeps the country inside the picture", () => {
  const shapes = readCountryShapes(topology);
  const target = shapes.get(4)!;
  const project = fitProjection(viewForCountry(target), 800, 500);
  for (const [lon, lat] of target.polygons[0]![0]!) {
    const [x, y] = project(lon, lat);
    assert.ok(x >= 0 && x <= 800 && y >= 0 && y <= 500, `(${x}, ${y}) is inside`);
  }
  const [northX, northY] = project(12, 24);
  const [southX, southY] = project(12, 20);
  assert.equal(northX, southX);
  assert.ok(northY < southY, "north is up");
});
