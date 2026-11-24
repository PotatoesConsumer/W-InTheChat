import { test } from "node:test";
import assert from "node:assert/strict";
import { createHorror, HORROR, HOUSE, CELL } from "../../src/game/horror/game.js";
import { seededRandom } from "../../src/game/random.js";
import { GAME_EVENTS, createGameEvent } from "../../src/events/schema.js";
import { EVENT_LINES } from "../../src/service/templates.js";

const STEP = 1000 / 60;
const names = (game) => game.takeEvents().map((e) => e.name);

function started(seed = 1) {
  const game = createHorror({ random: seededRandom(seed) });
  game.start();
  return game;
}

/** Keeps the monster out of the way (it waits out graceMs, then stays parked far off). */
function parkMonster(game) {
  Object.assign(game.state.monster, { x: 1e6, y: 1e6 });
}

test("the house is a closed rectangle with one door, a start, a monster and enough key spots", () => {
  const width = HOUSE[0].length;
  assert.ok(HOUSE.every((row) => row.length === width));
  const all = HOUSE.join("");
  assert.equal(all.split("D").length - 1, 1);
  assert.equal(all.split("P").length - 1, 1);
  assert.equal(all.split("M").length - 1, 1);
  assert.ok(all.split("K").length - 1 >= HORROR.keys);
});

test("start places the keys and announces the run; same seed, same keys", () => {
  const a = started(7);
  const b = started(7);
  assert.deepEqual(a.takeEvents(), [{ name: "horror_start", data: { keys: HORROR.keys } }]);
  assert.equal(a.state.keys.length, HORROR.keys);
  assert.deepEqual(a.state.keys, b.state.keys);
});

test("walls stop the player", () => {
  const game = started();
  parkMonster(game);
  game.state.player.angle = Math.PI; // facing the west wall
  for (let i = 0; i < 120; i++) game.update(STEP, { forward: 1 });
  assert.ok(game.state.player.x >= CELL + HORROR.playerRadius - 1e-9);
});

test("the door stays shut until every key is found, then walking out wins", () => {
  const game = started();
  game.takeEvents();
  const s = game.state;
  parkMonster(game);

  // At the door with no keys: still locked, still playing.
  Object.assign(s.player, { x: s.door.x - CELL, y: s.door.y, angle: 0 });
  for (let i = 0; i < 60; i++) game.update(STEP, { forward: 1 });
  assert.equal(s.phase, "playing");
  assert.equal(s.door.open, false);

  for (const k of s.keys) {
    Object.assign(s.player, { x: k.x, y: k.y });
    game.update(STEP);
    parkMonster(game);
  }
  assert.deepEqual(names(game), Array(HORROR.keys).fill("key_found"));
  assert.equal(s.door.open, true);

  Object.assign(s.player, { x: s.door.x - CELL, y: s.door.y, angle: 0 });
  for (let i = 0; i < 60 && s.phase === "playing"; i++) game.update(STEP, { forward: 1 });
  assert.equal(s.phase, "escaped");
  assert.deepEqual(names(game), ["escaped"]);
});

test("the monster hunts down a player who stands still, warning first", () => {
  const game = started(3);
  game.takeEvents();
  for (let i = 0; i < 60 * 60 && game.state.phase === "playing"; i++) game.update(STEP);
  assert.equal(game.state.phase, "caught");
  const seen = names(game);
  assert.equal(seen.at(-1), "caught");
  assert.ok(seen.includes("monster_near"));
});

test("a player running away is faster than the monster", () => {
  assert.ok(HORROR.playerSpeed > HORROR.chaseSpeed);
});

test("every event it sends is valid, minor, optional and has chat lines", () => {
  const game = started();
  const s = game.state;
  for (const k of s.keys) Object.assign(s.player, { x: k.x, y: k.y }) && game.update(STEP);
  const sent = game.takeEvents();
  for (const name of ["horror_start", "key_found", "monster_near", "escaped", "caught"]) {
    assert.equal(GAME_EVENTS[name]?.importance, "minor", name);
    assert.equal(GAME_EVENTS[name].optional, true, name);
    assert.ok(EVENT_LINES[name]?.length > 0, name);
  }
  for (const { name, data } of sent) createGameEvent(name, data);
});

test("abandon resets without an event", () => {
  const game = started();
  game.takeEvents();
  game.abandon();
  assert.equal(game.state.phase, "ready");
  assert.deepEqual(game.takeEvents(), []);
});
