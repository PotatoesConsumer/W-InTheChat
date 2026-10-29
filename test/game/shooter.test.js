import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent, createGameEvent } from "../../src/events/schema.js";
import {
  createShooter,
  seededRandom,
  playerStats,
  PLAYER,
  STREAK_KILLS,
} from "../../src/game/shooter/game.js";
import { waveConfig, pickEnemyType, FIRST_WAVE } from "../../src/game/shooter/waves.js";
import {
  SHOP_ITEMS,
  checkPurchase,
  cashOutValue,
  priceOf,
  shopItem,
  DOLLARS_PER_COIN,
} from "../../src/game/shooter/shop.js";
import { shopHit, shopLayout } from "../../src/game/shooter/view.js";

const ARENA = { x: 0, y: 40, width: 960, height: 500 };
const STEP = 1000 / 60;

const newGame = (seed = 1) => createShooter({ arena: ARENA, random: seededRandom(seed) });
const names = (events) => events.map((e) => e.name);

/** Runs the game until `until()` or the time runs out; returns every event on the way. */
function play(game, { ms, controls = () => ({}), until = () => false }) {
  const events = [];
  for (let t = 0; t < ms && !until(); t += STEP) {
    game.update(STEP, controls(game.state));
    events.push(...game.takeEvents());
  }
  return events;
}

/** A bot that stands still and shoots the nearest enemy. */
const aimbot = ({ player, enemies }) => {
  const target = enemies.reduce(
    (best, e) =>
      !best ||
      Math.hypot(e.x - player.x, e.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y)
        ? e
        : best,
    null,
  );
  return target ? { aimX: target.x - player.x, aimY: target.y - player.y, fire: true } : {};
};

/** Clears the current wave: the enemies still to come are spawned dead. */
function clearWave(game) {
  const s = game.state;
  s.spawn.spawned = s.spawn.config.count;
  for (const e of s.enemies) e.hp = 0;
  game.update(STEP, {});
  return game.takeEvents();
}

test("every wave is harder than the one before", () => {
  for (let wave = 1; wave < 15; wave++) {
    const a = waveConfig(wave);
    const b = waveConfig(wave + 1);
    assert.ok(b.count > a.count, `count ${wave}`);
    assert.ok(b.spawnEveryMs <= a.spawnEveryMs, `spawn rate ${wave}`);
    assert.ok(b.hpMultiplier > a.hpMultiplier, `hp ${wave}`);
    assert.ok(b.speedMultiplier >= a.speedMultiplier, `speed ${wave}`);
  }
  assert.throws(() => waveConfig(0), RangeError);
});

test("new enemy types join in later waves", () => {
  for (const [type, first] of Object.entries(FIRST_WAVE)) {
    if (first > 1) assert.equal(waveConfig(first - 1).weights[type], undefined, type);
    assert.ok(waveConfig(first).weights[type] > 0, type);
  }
  assert.equal(pickEnemyType({ slime: 1 }, 0.99), "slime");
  assert.equal(pickEnemyType({ slime: 1, bat: 1 }, 0.75), "bat");
});

test("shop: prices go up per level, sold out at the max, refusals say why", () => {
  const run = { coins: 100, hp: 3, maxHp: 5, levels: {} };
  assert.deepEqual(checkPurchase(run, "rapid"), { ok: true, price: shopItem("rapid").cost });
  assert.equal(
    priceOf(shopItem("rapid"), 2),
    shopItem("rapid").cost + 2 * shopItem("rapid").costStep,
  );
  assert.deepEqual(checkPurchase({ ...run, levels: { spread: 1 } }, "spread"), {
    ok: false,
    reason: "sold out",
  });
  assert.equal(checkPurchase({ ...run, hp: 5 }, "medkit").reason, "already at full HP");
  assert.match(checkPurchase({ ...run, coins: 1 }, "heart").reason, /needs \d+ coins/);
  assert.equal(checkPurchase(run, "laser").ok, false);
  assert.equal(new Set(SHOP_ITEMS.map((i) => i.id)).size, SHOP_ITEMS.length);
});

test("cashing out turns whole coins' worth of donations into coins, once", () => {
  assert.deepEqual(cashOutValue(0, 0), { coins: 0, dollars: 0 });
  assert.deepEqual(cashOutValue(60, 0), { coins: 60 / DOLLARS_PER_COIN, dollars: 60 });
  assert.deepEqual(cashOutValue(63, 0), { coins: 12, dollars: 60 }, "leftover dollars stay");
  assert.deepEqual(cashOutValue(60, 60), { coins: 0, dollars: 0 });
});

test("upgrades change the player's numbers", () => {
  const base = playerStats({});
  const up = playerStats({ heart: 2, boots: 1, rapid: 1, power: 1, spread: 1 });
  assert.equal(base.maxHp, PLAYER.hp);
  assert.equal(up.maxHp, PLAYER.hp + 2);
  assert.ok(up.speed > base.speed);
  assert.ok(up.fireDelayMs < base.fireDelayMs);
  assert.equal(up.damage, 2);
  assert.equal(up.bullets, 3);
});

test("a run starts with round_start, and the bot clears wave 1 with a win", () => {
  const game = newGame();
  assert.equal(game.state.phase, "ready");
  assert.equal(game.start(), true);
  assert.deepEqual(game.takeEvents(), [{ name: "round_start", data: { wave: 1 } }]);
  assert.equal(game.start(), false, "already running");

  const events = play(game, {
    ms: 60_000,
    controls: aimbot,
    until: () => game.state.phase !== "wave",
  });
  assert.equal(game.state.phase, "shop");
  assert.equal(names(events).filter((n) => n === "kill").length, waveConfig(1).count);
  assert.equal(events.at(-1).name, game.state.player.hp <= 2 ? "close_call" : "win");
  assert.ok(game.state.run.coins >= waveConfig(1).count, "every kill drops coins");
  for (const { name, data } of events) {
    assert.deepEqual(validateEvent(createGameEvent(name, data)), { ok: true }, name);
  }
});

test("clearing a wave on low HP is a close call, not a win", () => {
  const game = newGame();
  game.start();
  game.takeEvents();
  game.state.player.hp = 2; // 2 of 5 is low
  const events = clearWave(game);
  assert.equal(events.at(-1).name, "close_call");
  assert.deepEqual(events.at(-1).data, { wave: 1, hp: 2, maxHp: 5 });
  assert.equal(names(events).filter((n) => ["win", "new_best"].includes(n)).length, 0);

  game.nextWave();
  game.takeEvents();
  game.state.player.hp = 3;
  assert.equal(clearWave(game).at(-1).name, "win");
});

test("the shop: buy with coins, cash out donations, then the next wave is harder", () => {
  const game = newGame();
  game.start();
  clearWave(game);
  game.state.run.coins = 0;

  assert.equal(game.buy("rapid").ok, false);
  assert.deepEqual(game.cashOut(60), { coins: 12 });
  assert.deepEqual(game.cashOut(60), { coins: 0 }, "the same dollars only once");
  assert.equal(game.buy("rapid").ok, true);
  assert.deepEqual(game.takeEvents(), [
    { name: "item_pickup", data: { item: "Rapid fire", wave: 1 } },
  ]);
  assert.equal(game.state.run.levels.rapid, 1);

  game.state.player.hp = 3;
  game.state.run.coins = 100;
  game.buy("medkit");
  assert.equal(game.state.player.hp, 5);
  game.buy("heart");
  assert.deepEqual([game.state.player.hp, game.state.player.maxHp], [6, 6]);

  assert.equal(game.nextWave(), true);
  assert.deepEqual(game.takeEvents().at(-1), { name: "round_start", data: { wave: 2 } });
  assert.equal(game.state.spawn.config.count, waveConfig(2).count);
  assert.equal(game.buy("medkit").ok, false, "the shop is closed during a wave");
});

test("getting hit costs HP, gives a moment of safety and ends the streak; 0 HP is a loss", () => {
  const game = newGame();
  game.start();
  game.takeEvents();
  const s = game.state;
  s.spawn.timerMs = Infinity; // no spawns: place the enemy by hand
  s.run.streakKills = 7;
  const enemy = { ...s.player, id: 99, type: "slime", r: 14, hp: 2, maxHp: 2, speed: 0, damage: 1 };
  s.enemies.push({ ...enemy, coins: 1, hitMs: 0, ageMs: 0, wobble: 0 });

  game.update(STEP, {});
  assert.deepEqual(game.takeEvents(), [{ name: "damage_taken", data: { hp: 4, maxHp: 5 } }]);
  assert.equal(s.run.streakKills, 0);
  s.enemies[0].x = s.player.x; // back on top of the player, still invulnerable
  game.update(STEP, {});
  assert.deepEqual(game.takeEvents(), []);

  s.player.hp = 1;
  s.player.invulnerableMs = 0;
  s.enemies[0].x = s.player.x;
  s.enemies[0].y = s.player.y;
  game.update(STEP, {});
  assert.deepEqual(names(game.takeEvents()), ["damage_taken", "loss"]);
  assert.equal(s.phase, "over");
});

test(`${STREAK_KILLS} kills in a row without a hit is a streak`, () => {
  const game = newGame();
  game.start();
  game.takeEvents();
  const s = game.state;
  s.run.streakKills = STREAK_KILLS - 1;
  s.enemies.push({
    id: 1,
    type: "bat",
    x: 100,
    y: 100,
    prevX: 100,
    prevY: 100,
    r: 10,
    hp: 0,
    maxHp: 1,
    speed: 0,
    damage: 1,
    coins: 1,
    hitMs: 0,
    ageMs: 0,
    wobble: 0,
  });
  s.spawn.timerMs = Infinity;
  game.update(STEP, {});
  assert.deepEqual(game.takeEvents().slice(0, 2), [
    { name: "kill", data: { enemy: "bat", wave: 1 } },
    { name: "streak", data: { kills: STREAK_KILLS } },
  ]);
});

test("passing the best wave of an earlier run is a new best, once per run", () => {
  const game = newGame();
  game.start();
  clearWave(game); // cleared 1
  game.nextWave();
  game.state.player.invulnerableMs = 0;
  game.state.enemies.push({
    ...game.state.player,
    id: 5,
    type: "slime",
    hp: 9,
    maxHp: 9,
    speed: 0,
    damage: 1,
    coins: 1,
    hitMs: 0,
    ageMs: 0,
    wobble: 0,
  });
  game.state.player.hp = 1;
  game.update(STEP, {});
  assert.equal(game.state.phase, "over");
  assert.equal(game.state.bestWave, 1);

  game.start();
  assert.equal(clearWave(game).at(-1).name, "win", "wave 1 only ties the best");
  game.nextWave();
  const passed = clearWave(game).at(-1);
  assert.deepEqual(passed, { name: "new_best", data: { wave: 2, previousBest: 1 } });
  game.nextWave();
  assert.equal(clearWave(game).at(-1).name, "win", "only once per run");
});

test("the same seed and inputs give the same game", () => {
  const run = () => {
    const game = newGame(42);
    game.start();
    return play(game, { ms: 20_000, controls: aimbot }).map((e) => JSON.stringify(e));
  };
  assert.deepEqual(run(), run());
});

test("the player and enemies stay out of the facecam", () => {
  const facecam = { x: 744, y: 374, width: 216, height: 166 };
  const game = createShooter({ arena: ARENA, obstacles: [facecam], random: seededRandom(3) });
  game.start();
  play(game, { ms: 3_000, controls: () => ({ moveX: 1, moveY: 1 }) });
  const p = game.state.player;
  const inside = (e) =>
    e.x > facecam.x &&
    e.x < facecam.x + facecam.width &&
    e.y > facecam.y &&
    e.y < facecam.y + facecam.height;
  assert.ok(!inside(p), `player at ${p.x}, ${p.y}`);
  play(game, { ms: 10_000, controls: () => ({ moveX: 1, moveY: 1 }) });
  for (const e of game.state.enemies) assert.ok(!inside(e), `${e.type} at ${e.x}, ${e.y}`);
});

test("shop clicks hit the item cards and buttons", () => {
  const layout = shopLayout();
  const centre = (r) => [r.x + r.width / 2, r.y + r.height / 2];
  assert.deepEqual(shopHit(...centre(layout.cards[0])), { kind: "item", id: SHOP_ITEMS[0].id });
  assert.deepEqual(shopHit(...centre(layout.cashOut)), { kind: "cashOut" });
  assert.deepEqual(shopHit(...centre(layout.next)), { kind: "next" });
  assert.equal(shopHit(0, 0), null);
});
