import { test } from "node:test";
import assert from "node:assert/strict";
import { createBase, STATIONS, BASE } from "../../src/game/base/game.js";
import { baseRows } from "../../src/game/base/menus.js";
import { emptyProgress } from "../../src/game/progress.js";
import { GAME_EVENTS, createGameEvent } from "../../src/events/schema.js";
import { EVENT_LINES } from "../../src/service/templates.js";
import { STAT_RULES } from "../../src/game/stats.js";

const ROOM = { x: 0, y: BASE.top, width: 960, height: 500 };
const STEP = 1000 / 60;

test("walking stays in the room; E opens the station in reach, and only then", () => {
  const base = createBase(ROOM);
  const s = base.state;
  for (let i = 0; i < 600; i++) base.update(STEP, { moveX: -1, moveY: -1 });
  assert.equal(s.player.x, ROOM.x + BASE.radius);
  assert.equal(s.player.y, ROOM.y + BASE.radius);

  Object.assign(s.player, { x: 480, y: 300 });
  assert.equal(base.open(), false);
  const shrine = STATIONS.find((st) => st.id === "shrine");
  Object.assign(s.player, { x: shrine.x, y: shrine.y + 40 });
  assert.equal(base.open(), true);
  assert.equal(s.menu.station.id, "shrine");

  // No walking while a menu is open; the selection wraps.
  base.update(STEP, { moveX: 1 });
  assert.equal(s.player.x, shrine.x);
  base.move(-1, 3);
  assert.equal(s.menu.index, 2);
  base.point(1, 3);
  assert.equal(s.menu.index, 1);
  assert.equal(base.close(), true);
  assert.equal(s.menu, null);
});

test("every station has menu rows; a row you can't afford says why", () => {
  const ctx = { progress: emptyProgress(), ghost: false, donations: 0 };
  for (const station of STATIONS) {
    const rows = baseRows(station.id, ctx);
    assert.ok(rows.length > 0, station.id);
    for (const row of rows) assert.ok(row.label && typeof row.detail === "string", station.id);
  }
  const chair = baseRows("workbench", ctx)[0];
  assert.equal(chair.ok, false);
  // Without the badge, the shrine only says how to meet the ghost.
  assert.ok(baseRows("shrine", ctx).every((row) => !row.action));
});

test("the base's events are valid, minor, optional, have chat lines; buying materials spends donations", () => {
  for (const name of ["crafted", "material_purchase"]) {
    assert.equal(GAME_EVENTS[name].importance, "minor");
    assert.equal(GAME_EVENTS[name].optional, true);
    assert.ok(EVENT_LINES[name].length > 0);
  }
  assert.equal(STAT_RULES.material_purchase.spends, true);
  createGameEvent("crafted", { item: "Chair" });
  createGameEvent("material_purchase", { material: "wood", amount: 10, dollars: 15 });
});
