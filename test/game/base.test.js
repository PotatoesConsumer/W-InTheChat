import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBase,
  camera,
  tileAt,
  BASE,
  OUTSIDE,
  ROOM,
  TILE,
  VIEW,
} from "../../src/game/base/game.js";
import { baseRows, MENUS } from "../../src/game/base/menus.js";
import { emptyProgress, ROOM_GRID } from "../../src/game/progress.js";
import { seededRandom } from "../../src/game/random.js";
import { GAME_EVENTS, createGameEvent } from "../../src/events/schema.js";
import { EVENT_LINES } from "../../src/service/templates.js";
import { STAT_RULES } from "../../src/game/stats.js";
import { DONATION_EVENTS, FLAT_CHANCES } from "../../src/game/donations.js";

const STEP = 1000 / 60;
const { room } = emptyProgress(); // the starting workbench, top right

function walk(base, controls, steps, r = room) {
  for (let i = 0; i < steps; i++) base.update(STEP, controls, r);
}

test("you start outside; the camera follows and stops at the yard's edges", () => {
  const base = createBase();
  assert.equal(base.state.scene, "outside");
  assert.deepEqual(camera({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(camera({ x: 1e5, y: 1e5 }), {
    x: OUTSIDE.width - VIEW.width,
    y: OUTSIDE.height - VIEW.height,
  });
});

test("buildings are solid; E at the door goes in and back out", () => {
  const base = createBase();
  const p = base.state.player;
  walk(base, { moveY: -1 }, 120); // straight up into the house
  const home = OUTSIDE.solids.find((r) => r.id === "home");
  assert.ok(p.y >= home.y + home.height + BASE.radius - 0.01, `stopped at ${p.y}`);

  assert.equal(base.use(room, false), "enter");
  assert.equal(base.state.scene, "inside");
  assert.equal(base.use(room, false), "exit");
  assert.equal(base.state.scene, "outside");
});

test("outside: the Haunted House and Training Board open their menus", () => {
  for (const id of ["haunted", "training"]) {
    const base = createBase();
    const spot = OUTSIDE.spots.find((sp) => sp.id === id);
    Object.assign(base.state.player, { x: spot.x, y: spot.y });
    assert.equal(base.use(room, false), "menu");
    assert.equal(base.state.menu.target, id);
  }
});

test("inside: furniture blocks walking; E by the workbench or the ghost opens their menus", () => {
  const base = createBase({ random: seededRandom(1) });
  Object.assign(base.state.player, OUTSIDE.spots[0]); // the front door
  assert.equal(base.use(room, false), "enter");
  const p = base.state.player;

  // Walk up the right side into the workbench (the top-right two tiles).
  Object.assign(p, { x: ROOM.x + ROOM.width - TILE / 2, y: ROOM.y + 3 * TILE });
  walk(base, { moveY: -1 }, 120);
  assert.ok(p.y >= ROOM.y + TILE + BASE.radius - 0.01, `stopped at ${p.y}`);
  assert.equal(base.use(room, false), "menu");
  assert.equal(base.state.menu.target, "workbench");
  base.close();

  // The ghost: only when it's out (the badge).
  Object.assign(p, { x: base.state.ghost.x, y: base.state.ghost.y + 20 });
  base.update(STEP, {}, room);
  assert.notEqual(base.near(room, false)?.kind, "ghost");
  assert.equal(base.use(room, true), "menu");
  assert.equal(base.state.menu.target, "ghost");
});

test("the ghost wanders inside the house", () => {
  const base = createBase({ random: seededRandom(2) });
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    base.update(STEP, {}, room);
    const g = base.state.ghost;
    assert.ok(
      g.x >= ROOM.x && g.x <= ROOM.x + ROOM.width && g.y >= ROOM.y && g.y <= ROOM.y + ROOM.height,
    );
    seen.add(`${Math.round(g.x / 50)},${Math.round(g.y / 50)}`);
  }
  assert.ok(seen.size > 3, "it moves about");
});

test("tiles: screen points map to grid tiles, off the floor to null", () => {
  assert.deepEqual(tileAt(ROOM.x + 1, ROOM.y + 1), { gx: 0, gy: 0 });
  assert.deepEqual(tileAt(ROOM.x + ROOM.width - 1, ROOM.y + ROOM.height - 1), {
    gx: ROOM_GRID.cols - 1,
    gy: ROOM_GRID.rows - 1,
  });
  assert.equal(tileAt(ROOM.x - 1, ROOM.y), null);
});

test("every menu has rows; broken places only offer the fix; the ghost can be petted", () => {
  const ctx = { progress: emptyProgress() };
  for (const target of Object.keys(MENUS)) {
    const rows = baseRows(target, ctx);
    assert.ok(rows.length > 0, target);
    for (const row of rows) assert.ok(row.label && typeof row.detail === "string", target);
  }
  assert.deepEqual(
    baseRows("haunted", ctx).map((r) => r.action.kind),
    ["fix"],
  );
  assert.deepEqual(
    baseRows("training", ctx).map((r) => r.action.kind),
    ["fix"],
  );
  assert.equal(baseRows("ghost", ctx)[0].action.kind, "pet");
  assert.equal(baseRows("workbench", ctx).length, 3); // chair, table, wardrobe
});

test("the base's events are valid, minor, optional, have chat lines; petting rarely brings a donation", () => {
  for (const name of ["crafted", "material_purchase", "ghost_pet"]) {
    assert.equal(GAME_EVENTS[name].importance, "minor");
    assert.equal(GAME_EVENTS[name].optional, true);
    assert.ok(EVENT_LINES[name].length > 0);
  }
  assert.equal(STAT_RULES.material_purchase.spends, true);
  for (const name of ["key_found", "escaped", "ghost_pet"])
    assert.ok(DONATION_EVENTS.includes(name));
  assert.ok(FLAT_CHANCES.ghost_pet < 0.1);
  createGameEvent("crafted", { item: "Chair" });
  createGameEvent("material_purchase", { material: "wood", amount: 10, dollars: 15 });
  createGameEvent("ghost_pet");
});
