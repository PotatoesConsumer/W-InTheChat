import { test } from "node:test";
import assert from "node:assert/strict";
import { createHorror, HORROR, HOUSES, CELL, ITEM_EFFECTS } from "../../src/game/horror/game.js";
import { seededRandom } from "../../src/game/random.js";
import { GAME_EVENTS, createGameEvent } from "../../src/events/schema.js";
import { EVENT_LINES } from "../../src/service/templates.js";

const STEP = 1000 / 60;
const names = (game) => game.takeEvents().map((e) => e.name);

const KEYS = HOUSES[0].keys;

function started(seed = 1, level = 1) {
  const game = createHorror({ random: seededRandom(seed), level: () => level });
  game.start();
  return game;
}

/** Keeps the monster out of the way (it waits out graceMs, then stays parked far off). */
function parkMonster(game) {
  Object.assign(game.state.monster, { x: 1e6, y: 1e6 });
}

test("every house is a closed rectangle with one door, a start, a monster and enough key spots", () => {
  for (const { rows, keys } of HOUSES) {
    const width = rows[0].length;
    assert.ok(rows.every((row) => row.length === width));
    rows.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        const edge = r === 0 || r === rows.length - 1 || c === 0 || c === width - 1;
        if (edge) assert.ok("#D".includes(ch), `edge at ${c},${r}`);
      }),
    );
    const all = rows.join("");
    assert.equal(all.split("D").length - 1, 1);
    assert.equal(all.split("P").length - 1, 1);
    assert.equal(all.split("M").length - 1, 1);
    assert.ok(all.split("K").length - 1 >= keys);
  }
});

test("higher levels: more keys, a bigger house, a faster monster, less stamina", () => {
  const [one, two, three] = HOUSES;
  assert.ok(one.chaseSpeed < HORROR.playerSpeed);
  assert.equal(two.chaseSpeed, HORROR.playerSpeed);
  assert.ok(three.chaseSpeed > HORROR.playerSpeed);
  assert.ok(three.stamina < one.stamina);
  assert.ok(two.rows.length > one.rows.length && three.rows.length > two.rows.length);
  for (const level of [1, 2, 3]) {
    const game = started(4, level);
    assert.deepEqual(game.takeEvents()[0].data, { keys: HOUSES[level - 1].keys, level });
    assert.equal(game.state.keys.length, HOUSES[level - 1].keys);
    assert.equal(game.state.player.stamina, HOUSES[level - 1].stamina);
  }
});

test("items: sonar once a run, energy runs without stamina, the gun freezes the monster", () => {
  const game = started();
  const s = game.state;
  parkMonster(game);
  assert.equal(game.sonar(), true);
  assert.equal(game.sonar(), false);

  assert.equal(game.energy(), true);
  s.player.angle = 0;
  for (let i = 0; i < 60; i++) game.update(STEP, { forward: 1, run: true });
  assert.equal(s.player.stamina, HOUSES[0].stamina);
  assert.equal(s.player.running, true);

  Object.assign(s.monster, { x: s.player.x + 2, y: s.player.y, mode: "chase" });
  s.elapsedMs = HORROR.graceMs;
  game.freeze();
  const at = { x: s.monster.x, y: s.monster.y };
  for (let i = 0; i < 60; i++) game.update(STEP);
  assert.deepEqual({ x: s.monster.x, y: s.monster.y }, at);
  assert.equal(s.phase, "playing");
  assert.ok(s.monster.frozenMs > 0 && s.monster.frozenMs < ITEM_EFFECTS.freezeMs);
});

test("start places the keys and announces the run; same seed, same keys", () => {
  const a = started(7);
  const b = started(7);
  assert.deepEqual(a.takeEvents(), [{ name: "horror_start", data: { keys: KEYS, level: 1 } }]);
  assert.equal(a.state.keys.length, KEYS);
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
  assert.deepEqual(names(game), Array(KEYS).fill("key_found"));
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

test("running: faster while stamina lasts, then walking until it refills", () => {
  const walk = started();
  const run = started();
  for (const g of [walk, run]) {
    parkMonster(g);
    g.state.player.angle = 0; // east, along the start room
  }
  for (let i = 0; i < 30; i++) {
    walk.update(STEP, { forward: 1 });
    run.update(STEP, { forward: 1, run: true });
  }
  assert.ok(run.state.player.x > walk.state.player.x);
  assert.ok(run.state.player.stamina < HOUSES[0].stamina);
  assert.equal(walk.state.player.stamina, HOUSES[0].stamina);

  const p = run.state.player;
  p.stamina = 1;
  run.update(100, { forward: 1, run: true });
  assert.equal(p.stamina, 0);
  assert.equal(p.tired, true);
  run.update(STEP, { forward: 1, run: true });
  assert.equal(p.running, false); // too tired: walking
  const seconds = HORROR.rerun / HORROR.staminaRegen;
  run.update(seconds * 1000 + 10, {});
  assert.equal(p.tired, false);
});
