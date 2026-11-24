import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buy,
  canAfford,
  checkProgress,
  createProgressStore,
  emptyProgress,
  ghostStats,
  priceFor,
  toggleWear,
  BOOST_COSTS,
  GHOST_MAX_LEVEL,
  HOUSE_LEVELS,
} from "../../src/game/progress.js";

function memoryStorage() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
  };
}

const rich = () => ({
  ...emptyProgress(),
  materials: { wood: 500, rock: 500, darkMatter: 100 },
});

test("buying pays the price and applies it; short of materials, nothing changes", () => {
  const poor = emptyProgress();
  assert.deepEqual(buy(poor, { kind: "furniture", id: "chair" }), {
    ok: false,
    reason: "not enough materials",
  });

  const p = rich();
  const chair = buy(p, { kind: "furniture", id: "chair" }, { x: 10, y: 20 });
  assert.equal(chair.ok, true);
  assert.equal(chair.progress.materials.wood, 495);
  assert.deepEqual(chair.progress.furniture, [{ id: "chair", x: 10, y: 20 }]);
  assert.equal(p.materials.wood, 500, "the old state is untouched");
});

test("the ghost costs only dark matter, one more per level, up to the max", () => {
  let p = rich();
  for (let level = 0; level < GHOST_MAX_LEVEL; level++) {
    assert.deepEqual(priceFor(p, { kind: "ghost", id: "damage" }).cost, { darkMatter: level + 1 });
    p = buy(p, { kind: "ghost", id: "damage" }).progress;
  }
  assert.equal(p.ghost.damage, GHOST_MAX_LEVEL);
  assert.equal(buy(p, { kind: "ghost", id: "damage" }).ok, false);
  assert.ok(ghostStats(p.ghost).damage > ghostStats({}).damage);
  assert.ok(ghostStats({ rate: 2 }).hitDelayMs < ghostStats({}).hitDelayMs);
  assert.ok(ghostStats({ speed: 2 }).flySpeed > ghostStats({}).flySpeed);
});

test("the Haunted House goes up to its last level; boosts to theirs", () => {
  let p = rich();
  while (priceFor(p, { kind: "house" }).ok) p = buy(p, { kind: "house" }).progress;
  assert.equal(p.house, HOUSE_LEVELS.length);
  for (let i = 0; i < BOOST_COSTS.length; i++) p = buy(p, { kind: "boost", id: "power" }).progress;
  assert.equal(p.boosts.power, BOOST_COSTS.length);
  assert.equal(buy(p, { kind: "boost", id: "power" }).ok, false);
  assert.equal(buy(p, { kind: "boost", id: "spread" }).ok, false);
});

test("clothes are made once and worn one per slot; taking one off frees the slot", () => {
  let p = buy(rich(), { kind: "clothes", id: "cap" }).progress;
  assert.equal(p.clothes.worn.hat, "cap");
  assert.equal(buy(p, { kind: "clothes", id: "cap" }).ok, false);
  p = buy(p, { kind: "clothes", id: "crown" }).progress;
  assert.equal(p.clothes.worn.hat, "crown");
  p = toggleWear(p, "cap");
  assert.equal(p.clothes.worn.hat, "cap");
  p = toggleWear(p, "cap");
  assert.equal(p.clothes.worn.hat, null);
});

test("the store saves, reloads, adds drops and uses items; junk saves are repaired", () => {
  const storage = memoryStorage();
  const store = createProgressStore(storage);
  store.add({ wood: 3, rock: -5, gold: 9, darkMatter: 2 });
  assert.deepEqual(store.get().materials, { wood: 3, rock: 0, darkMatter: 2 });
  assert.equal(store.buy({ kind: "item", id: "sonar" }).ok, false); // needs rock
  store.add({ rock: 5 });
  assert.equal(store.buy({ kind: "item", id: "sonar" }).ok, true);
  assert.equal(createProgressStore(storage).get().items.sonar, 1);
  assert.equal(store.useItem("sonar"), true);
  assert.equal(store.useItem("sonar"), false);

  storage.setItem("witc.progress", "{not json");
  assert.deepEqual(createProgressStore(storage).get(), emptyProgress());
  const fixed = checkProgress({
    materials: { wood: -3, rock: 1.5 },
    house: 99,
    clothes: { owned: ["cap", "nope"], worn: { hat: "cap", shirt: "cap" } },
    furniture: [{ id: "chair", x: 1, y: 2 }, { id: "sofa", x: 1, y: 2 }, null],
  });
  assert.deepEqual(fixed.materials, { wood: 0, rock: 0, darkMatter: 0 });
  assert.equal(fixed.house, HOUSE_LEVELS.length);
  assert.deepEqual(fixed.clothes, { owned: ["cap"], worn: { hat: "cap", shirt: null } });
  assert.deepEqual(fixed.furniture, [{ id: "chair", x: 1, y: 2 }]);
  assert.equal(canAfford({ wood: 1 }, { wood: 2 }), false);
});
