import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buy,
  canAfford,
  checkProgress,
  createProgressStore,
  emptyProgress,
  fits,
  ghostStats,
  priceFor,
  toggleCarry,
  toggleWear,
  BOOST_COSTS,
  DOOR_TILES,
  GHOST_MAX_LEVEL,
  HOUSE_LEVELS,
  ROOM_GRID,
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

test("a new house has a workbench in the top-right corner and an empty bag", () => {
  const p = emptyProgress();
  assert.deepEqual(p.room, [{ id: "workbench", gx: ROOM_GRID.cols - 2, gy: 0 }]);
  assert.deepEqual(p.bag, {});
});

test("crafting pays and puts the piece in the bag; short of materials, nothing changes", () => {
  assert.deepEqual(buy(emptyProgress(), { kind: "craft", id: "chair" }), {
    ok: false,
    reason: "not enough materials",
  });
  const p = rich();
  const chair = buy(p, { kind: "craft", id: "chair" });
  assert.equal(chair.progress.materials.wood, 495);
  assert.deepEqual(chair.progress.bag, { chair: 1 });
  assert.equal(p.materials.wood, 500, "the old state is untouched");
  assert.equal(buy(p, { kind: "craft", id: "workbench" }).ok, false);
});

test("the grid: pieces stay on it, off each other and off the door's tiles", () => {
  const { room } = emptyProgress();
  assert.equal(fits(room, "chair", 0, 0), true);
  assert.equal(fits(room, "chair", ROOM_GRID.cols - 1, 0), false); // the workbench
  assert.equal(fits(room, "table", ROOM_GRID.cols - 1, 3), false); // off the edge
  assert.equal(fits(room, "wardrobe", 0, ROOM_GRID.rows - 1), false); // 2 tall
  assert.equal(fits(room, "chair", DOOR_TILES[0].gx, DOOR_TILES[0].gy), false);
  assert.equal(fits(room, "chair", ROOM_GRID.cols - 1, 0, 0), true); // moving the workbench
});

test("the store places from the bag, moves, and puts back", () => {
  const store = createProgressStore(memoryStorage());
  store.add({ wood: 20 });
  store.buy({ kind: "craft", id: "chair" });
  assert.equal(store.place("chair", ROOM_GRID.cols - 1, 0), null, "taken");
  assert.ok(store.place("chair", 2, 2));
  assert.deepEqual(store.get().bag, {});
  assert.equal(store.get().room.length, 2);
  assert.ok(store.move(1, 3, 3));
  assert.deepEqual(store.get().room[1], { id: "chair", gx: 3, gy: 3 });
  store.pickUp(0);
  assert.deepEqual(store.get().bag, { workbench: 1 });
  assert.equal(store.get().room.length, 1);
});

test("fix first: the Haunted House and Training Board sell nothing until fixed", () => {
  let p = rich();
  assert.equal(priceFor(p, { kind: "house" }).reason, "fix it first");
  assert.equal(priceFor(p, { kind: "boost", id: "power" }).reason, "fix it first");
  assert.deepEqual(priceFor(p, { kind: "fix", id: "haunted" }).cost, { darkMatter: 1 });
  assert.deepEqual(priceFor(p, { kind: "fix", id: "training" }).cost, { wood: 5, rock: 5 });
  p = buy(p, { kind: "fix", id: "haunted" }).progress;
  p = buy(p, { kind: "fix", id: "training" }).progress;
  while (priceFor(p, { kind: "house" }).ok) p = buy(p, { kind: "house" }).progress;
  assert.equal(p.house, HOUSE_LEVELS.length);
  for (let i = 0; i < BOOST_COSTS.length; i++) p = buy(p, { kind: "boost", id: "power" }).progress;
  assert.equal(p.boosts.power, BOOST_COSTS.length);
  assert.equal(buy(p, { kind: "boost", id: "power" }).ok, false);
});

test("horror items: bought once and kept; one carried at a time", () => {
  let p = buy(rich(), { kind: "fix", id: "haunted" }).progress;
  p = buy(p, { kind: "item", id: "sonar" }).progress;
  assert.equal(p.carry, "sonar");
  assert.equal(buy(p, { kind: "item", id: "sonar" }).ok, false);
  p = buy(p, { kind: "item", id: "gun" }).progress;
  assert.equal(p.carry, "gun");
  assert.deepEqual(p.items, { sonar: true, energy: false, gun: true });
  p = toggleCarry(p, "sonar");
  assert.equal(p.carry, "sonar");
  p = toggleCarry(p, "sonar");
  assert.equal(p.carry, null);
  assert.equal(toggleCarry(p, "energy").carry, null, "not owned");
});

test("the ghost costs only dark matter; a slime takes 5 hits at level 0", () => {
  let p = rich();
  for (let level = 0; level < GHOST_MAX_LEVEL; level++) {
    assert.deepEqual(priceFor(p, { kind: "ghost", id: "damage" }).cost, { darkMatter: level + 1 });
    p = buy(p, { kind: "ghost", id: "damage" }).progress;
  }
  assert.equal(buy(p, { kind: "ghost", id: "damage" }).ok, false);
  assert.equal(2 / ghostStats({}).damage, 5);
  assert.ok(ghostStats(p.ghost).damage > ghostStats({}).damage);
  assert.ok(ghostStats({ rate: 2 }).hitDelayMs < ghostStats({}).hitDelayMs);
  assert.ok(ghostStats({ speed: 2 }).flySpeed > ghostStats({}).flySpeed);
});

test("clothes are made once and worn one per slot", () => {
  let p = buy(rich(), { kind: "clothes", id: "cap" }).progress;
  assert.equal(p.clothes.worn.hat, "cap");
  p = buy(p, { kind: "clothes", id: "crown" }).progress;
  assert.equal(p.clothes.worn.hat, "crown");
  p = toggleWear(p, "cap");
  assert.equal(p.clothes.worn.hat, "cap");
  p = toggleWear(p, "cap");
  assert.equal(p.clothes.worn.hat, null);
});

test("saves reload; junk saves are repaired", () => {
  const storage = memoryStorage();
  const store = createProgressStore(storage);
  store.add({ wood: 3, rock: -5, gold: 9, darkMatter: 2 });
  assert.deepEqual(createProgressStore(storage).get().materials, {
    wood: 3,
    rock: 0,
    darkMatter: 2,
  });

  storage.setItem("witc.progress", "{not json");
  assert.deepEqual(createProgressStore(storage).get(), emptyProgress());
  const fixed = checkProgress({
    materials: { wood: -3, rock: 1.5 },
    house: 99,
    items: { sonar: true, gun: "yes" },
    carry: "gun",
    clothes: { owned: ["cap", "nope"], worn: { hat: "cap", shirt: "cap" } },
    room: [
      { id: "chair", gx: 1, gy: 2 },
      { id: "chair", gx: 1, gy: 2 },
      { id: "sofa", gx: 0, gy: 0 },
      { id: "table", gx: 99, gy: 0 },
    ],
    bag: { chair: 2, sofa: 3, table: -1 },
  });
  assert.deepEqual(fixed.materials, { wood: 0, rock: 0, darkMatter: 0 });
  assert.equal(fixed.house, HOUSE_LEVELS.length);
  assert.deepEqual(fixed.items, { sonar: true, energy: false, gun: false });
  assert.equal(fixed.carry, null);
  assert.deepEqual(fixed.clothes, { owned: ["cap"], worn: { hat: "cap", shirt: null } });
  assert.deepEqual(fixed.room, [{ id: "chair", gx: 1, gy: 2 }]);
  assert.deepEqual(fixed.bag, { chair: 2 });
  assert.equal(canAfford({ wood: 1 }, { wood: 2 }), false);
});
