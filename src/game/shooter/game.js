/**
 * game.js
 *
 * The mini-game (W08): a top-down wave shooter. Enemies come in waves, each harder than
 * the last (waves.js); between waves the shop sells upgrades for coins, and donations
 * buy coin packs in the coin store (shop.js). Plain state and logic with no DOM, so it runs
 * and is tested in Node; view.js draws it and main.js feeds it input.
 *
 * Phases: ready -> wave -> shop -> wave -> ... -> over -> (start) wave.
 *
 * What happens in the game becomes catalog events (src/events/schema.js), collected
 * as {name, data} and taken with takeEvents(); main.js puts them on the bus:
 *   round_start   a wave starts                  {wave}
 *   kill          an enemy dies                  {enemy, wave}
 *   damage_taken  the player is hit              {hp, maxHp}
 *   item_pickup   something bought in the shop   {item, wave}
 *   coin_purchase a coin pack bought with donations {pack, dollars, coins}; the stats
 *                 take the dollars off the donation balance
 *   streak        every STREAK_KILLS kills in a row without being hit  {kills}
 *   loss          the player dies                {wave, kills}
 * and exactly one major event when a wave is cleared:
 *   close_call    cleared on low HP (at most LOW_HP_FRACTION of max)  {wave, hp, maxHp}
 *   new_best      first wave this run past the best of earlier runs   {wave, previousBest}
 *   win           any other cleared wave         {wave, hp, maxHp}
 *
 * All randomness comes from `random`, so a seed and the same inputs give the same game.
 */

import { ENEMY_TYPES, waveConfig, pickEnemyType } from "./waves.js";
export { seededRandom } from "../random.js";
import { MEDKIT_HEAL, checkPurchase, checkCoinPack, shopItem } from "./shop.js";

export const PLAYER = Object.freeze({
  radius: 14,
  hp: 5,
  speed: 230, // px per second
  fireDelayMs: 320,
  invulnerableMs: 1000,
  bulletSpeed: 560,
  bulletRadius: 4,
  bulletLifeMs: 900,
});

/** A wave cleared with hp at or below this fraction of max HP is a close call. */
export const LOW_HP_FRACTION = 0.4;
/** A streak event every this many kills in a row without being hit. */
export const STREAK_KILLS = 10;
export const COIN = Object.freeze({ radius: 7, lifeMs: 10_000, magnet: 80, magnetSpeed: 320 });

const FIRST_SPAWN_MS = 800;
const SAFE_SPAWN_DISTANCE = 160;
const SPREAD_ANGLE = 0.22; // radians between spread shot bullets
const BURST_MS = 400;
const NOTICE_MS = 2500;

/** The player's numbers after shop upgrades. */
export function playerStats(levels) {
  const level = (id) => levels[id] ?? 0;
  return {
    maxHp: PLAYER.hp + level("heart"),
    speed: PLAYER.speed * (1 + 0.12 * level("boots")),
    fireDelayMs: PLAYER.fireDelayMs * 0.8 ** level("rapid"),
    damage: 1 + level("power"),
    bullets: level("spread") > 0 ? 3 : 1,
  };
}

/**
 * @param {object} opts
 * @param {{x: number, y: number, width: number, height: number}} opts.arena - Play area.
 * @param {{x: number, y: number, width: number, height: number}[]} [opts.obstacles] -
 *   Solid rectangles (none in the game since W10; tests use them).
 * @param {() => number} [opts.random] - In [0, 1); seed it for reproducible games.
 */
export function createShooter({ arena, obstacles = [], random = Math.random }) {
  const s = {
    phase: "ready",
    wave: 0,
    /** Highest wave cleared in an earlier run. */
    bestWave: 0,
    newBestThisRun: false,
    /** The coin store is open (in the shop). */
    storeOpen: false,
    run: newRun(),
    player: newPlayer(),
    enemies: [],
    bullets: [],
    coins: [],
    bursts: [],
    spawn: { config: null, spawned: 0, timerMs: 0 },
    notice: null,
  };
  let events = [];
  let nextId = 1;

  const emit = (name, data) => events.push({ name, data });

  function newRun() {
    return { coins: 0, levels: {}, kills: 0, streakKills: 0, cleared: 0 };
  }

  function newPlayer() {
    const x = arena.x + arena.width / 2;
    const y = arena.y + arena.height / 2;
    return {
      x,
      y,
      prevX: x,
      prevY: y,
      r: PLAYER.radius,
      hp: PLAYER.hp,
      maxHp: PLAYER.hp,
      invulnerableMs: 0,
      fireCooldownMs: 0,
      shots: 0, // read by main.js for the shot sound
      aimX: 1,
      aimY: 0,
    };
  }

  function startWave(wave) {
    s.wave = wave;
    s.phase = "wave";
    s.storeOpen = false;
    s.spawn = { config: waveConfig(wave), spawned: 0, timerMs: FIRST_SPAWN_MS };
    s.bullets = [];
    emit("round_start", { wave });
  }

  function notice(text) {
    s.notice = { text, ms: NOTICE_MS };
  }

  // --- update steps ----------------------------------------------------------------

  function movePlayer(dt, { moveX = 0, moveY = 0 }) {
    const p = s.player;
    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
      const dist = (playerStats(s.run.levels).speed * dt) / 1000;
      p.x += (moveX / len) * dist;
      p.y += (moveY / len) * dist;
    }
    keepInside(p);
  }

  function shoot(dt, { aimX = 0, aimY = 0, fire = false }) {
    const p = s.player;
    p.fireCooldownMs = Math.max(0, p.fireCooldownMs - dt);
    const len = Math.hypot(aimX, aimY);
    if (len > 0) {
      p.aimX = aimX / len;
      p.aimY = aimY / len;
    }
    if (!fire || len === 0 || p.fireCooldownMs > 0) return;

    const { bullets, damage, fireDelayMs } = playerStats(s.run.levels);
    const angle = Math.atan2(p.aimY, p.aimX);
    for (let i = 0; i < bullets; i++) {
      const a = angle + (i - (bullets - 1) / 2) * SPREAD_ANGLE;
      const vx = Math.cos(a) * PLAYER.bulletSpeed;
      const vy = Math.sin(a) * PLAYER.bulletSpeed;
      const x = p.x + Math.cos(a) * p.r;
      const y = p.y + Math.sin(a) * p.r;
      s.bullets.push({
        x,
        y,
        prevX: x,
        prevY: y,
        vx,
        vy,
        r: PLAYER.bulletRadius,
        damage,
        lifeMs: PLAYER.bulletLifeMs,
      });
    }
    p.fireCooldownMs = fireDelayMs;
    p.shots++;
  }

  function spawnEnemies(dt) {
    const { config } = s.spawn;
    if (s.spawn.spawned >= config.count) return;
    s.spawn.timerMs -= dt;
    while (s.spawn.timerMs <= 0 && s.spawn.spawned < config.count) {
      spawnEnemy(config);
      s.spawn.spawned++;
      s.spawn.timerMs += config.spawnEveryMs;
    }
  }

  function spawnEnemy(config) {
    const type = pickEnemyType(config.weights, random());
    const base = ENEMY_TYPES[type];
    const r = base.radius;
    let x = 0;
    let y = 0;
    // An edge point away from the player and outside obstacles; give up after a few tries.
    for (let tries = 0; tries < 8; tries++) {
      const edge = Math.floor(random() * 4);
      const along = random();
      const left = arena.x + r;
      const top = arena.y + r;
      const w = arena.width - 2 * r;
      const h = arena.height - 2 * r;
      [x, y] = [
        [left + along * w, top],
        [left + w, top + along * h],
        [left + along * w, top + h],
        [left, top + along * h],
      ][edge];
      const far = Math.hypot(x - s.player.x, y - s.player.y) >= SAFE_SPAWN_DISTANCE;
      if (far && !obstacles.some((o) => circleHitsRect({ x, y, r }, o))) break;
    }
    const hp = Math.ceil(base.hp * config.hpMultiplier);
    s.enemies.push({
      id: nextId++,
      type,
      x,
      y,
      prevX: x,
      prevY: y,
      r,
      hp,
      maxHp: hp,
      speed: base.speed * config.speedMultiplier,
      damage: base.damage,
      coins: base.coins,
      hitMs: 0,
      ageMs: 0,
      wobble: random() * Math.PI * 2,
    });
  }

  function moveEnemies(dt) {
    const p = s.player;
    for (const e of s.enemies) {
      e.ageMs += dt;
      e.hitMs = Math.max(0, e.hitMs - dt);
      let dx = p.x - e.x;
      let dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      if (e.type === "bat") {
        // Bats flutter side to side on their way in.
        const side = Math.sin(e.ageMs / 180 + e.wobble) * 0.8;
        [dx, dy] = [dx - dy * side, dy + dx * side];
      }
      const len = Math.hypot(dx, dy) || 1;
      const dist = (e.speed * dt) / 1000;
      e.x += (dx / len) * dist;
      e.y += (dy / len) * dist;
    }
    // Keep enemies from stacking into one blob.
    for (let i = 0; i < s.enemies.length; i++) {
      for (let j = i + 1; j < s.enemies.length; j++) {
        const a = s.enemies[i];
        const b = s.enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const overlap = a.r + b.r - d;
        if (overlap > 0 && d > 0) {
          const push = overlap / 2 / d;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }
    for (const e of s.enemies) keepInside(e);
  }

  function moveBullets(dt) {
    const alive = [];
    for (const b of s.bullets) {
      b.x += (b.vx * dt) / 1000;
      b.y += (b.vy * dt) / 1000;
      b.lifeMs -= dt;
      const out =
        b.lifeMs <= 0 ||
        b.x < arena.x ||
        b.y < arena.y ||
        b.x > arena.x + arena.width ||
        b.y > arena.y + arena.height ||
        obstacles.some((o) => circleHitsRect(b, o));
      if (out) continue;
      const target = s.enemies.find(
        (e) => e.hp > 0 && Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r,
      );
      if (target) {
        target.hp -= b.damage;
        target.hitMs = 100;
        continue;
      }
      alive.push(b);
    }
    s.bullets = alive;
  }

  function removeDead() {
    const alive = [];
    for (const e of s.enemies) {
      if (e.hp > 0) {
        alive.push(e);
        continue;
      }
      s.run.kills++;
      s.run.streakKills++;
      s.coins.push({ x: e.x, y: e.y, prevX: e.x, prevY: e.y, value: e.coins, lifeMs: COIN.lifeMs });
      s.bursts.push({ x: e.x, y: e.y, type: e.type, ageMs: 0 });
      emit("kill", { enemy: e.type, wave: s.wave });
      if (s.run.streakKills % STREAK_KILLS === 0) emit("streak", { kills: s.run.streakKills });
    }
    s.enemies = alive;
  }

  function touchEnemies(dt) {
    const p = s.player;
    p.invulnerableMs = Math.max(0, p.invulnerableMs - dt);
    if (p.invulnerableMs > 0) return;
    const hit = s.enemies.find((e) => Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r);
    if (!hit) return;

    p.hp = Math.max(0, p.hp - hit.damage);
    p.invulnerableMs = PLAYER.invulnerableMs;
    s.run.streakKills = 0;
    // Knock the enemy back so it doesn't sit on the player.
    const d = Math.hypot(hit.x - p.x, hit.y - p.y) || 1;
    hit.x += ((hit.x - p.x) / d) * 40;
    hit.y += ((hit.y - p.y) / d) * 40;
    keepInside(hit);
    emit("damage_taken", { hp: p.hp, maxHp: p.maxHp });

    if (p.hp === 0) {
      s.phase = "over";
      s.bestWave = Math.max(s.bestWave, s.run.cleared);
      emit("loss", { wave: s.wave, kills: s.run.kills });
    }
  }

  function collectCoins(dt) {
    const p = s.player;
    const kept = [];
    for (const c of s.coins) {
      c.lifeMs -= dt;
      if (c.lifeMs <= 0) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < p.r + COIN.radius) {
        s.run.coins += c.value;
        continue;
      }
      if (d < COIN.magnet) {
        const step = Math.min(d, (COIN.magnetSpeed * dt) / 1000);
        c.x += (dx / d) * step;
        c.y += (dy / d) * step;
      }
      kept.push(c);
    }
    s.coins = kept;
  }

  function checkWaveCleared() {
    const { config, spawned } = s.spawn;
    if (spawned < config.count || s.enemies.length > 0) return;

    const p = s.player;
    s.run.cleared = s.wave;
    s.phase = "shop";
    s.bullets = [];
    // Coins still on the floor are picked up for the player.
    s.run.coins += s.coins.reduce((sum, c) => sum + c.value, 0);
    s.coins = [];

    if (p.hp <= p.maxHp * LOW_HP_FRACTION) {
      emit("close_call", { wave: s.wave, hp: p.hp, maxHp: p.maxHp });
    } else if (s.bestWave > 0 && s.wave > s.bestWave && !s.newBestThisRun) {
      s.newBestThisRun = true;
      emit("new_best", { wave: s.wave, previousBest: s.bestWave });
    } else {
      emit("win", { wave: s.wave, hp: p.hp, maxHp: p.maxHp });
    }
  }

  function keepInside(e) {
    e.x = clamp(e.x, arena.x + e.r, arena.x + arena.width - e.r);
    e.y = clamp(e.y, arena.y + e.r, arena.y + arena.height - e.r);
    for (const o of obstacles) pushOutOfRect(e, o, arena);
  }

  function snapshotPositions() {
    for (const list of [[s.player], s.enemies, s.bullets, s.coins]) {
      for (const e of list) {
        e.prevX = e.x;
        e.prevY = e.y;
      }
    }
  }

  return {
    /** The whole game state, for drawing and tests. Change it only through the methods. */
    get state() {
      return s;
    },

    /** Starts a new run from the title or game-over screen. */
    start() {
      if (s.phase !== "ready" && s.phase !== "over") return false;
      s.storeOpen = false;
      s.run = newRun();
      s.player = newPlayer();
      s.enemies = [];
      s.coins = [];
      s.bursts = [];
      s.newBestThisRun = false;
      s.notice = null;
      startWave(1);
      return true;
    },

    /** Leaves the shop for the next wave. */
    nextWave() {
      if (s.phase !== "shop") return false;
      s.notice = null;
      startWave(s.wave + 1);
      return true;
    },

    /**
     * Buys one level of a shop item.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    buy(id) {
      if (s.phase !== "shop") return { ok: false, reason: "the shop is closed" };
      const p = s.player;
      const check = checkPurchase({ ...s.run, hp: p.hp, maxHp: p.maxHp }, id);
      if (!check.ok) {
        notice(check.reason);
        return check;
      }
      s.run.coins -= check.price;
      s.run.levels = { ...s.run.levels, [id]: (s.run.levels[id] ?? 0) + 1 };
      if (id === "medkit") p.hp = Math.min(p.maxHp, p.hp + MEDKIT_HEAL);
      if (id === "heart") {
        p.maxHp += 1;
        p.hp += 1;
      }
      const { name } = shopItem(id);
      notice(`Bought ${name}`);
      emit("item_pickup", { item: name, wave: s.wave });
      return { ok: true };
    },

    /** Opens or closes the coin store (only in the shop). */
    toggleStore(open = !s.storeOpen) {
      if (s.phase !== "shop") return false;
      s.storeOpen = open;
      return true;
    },

    /**
     * Buys a coin pack with donations. The donations are spent: the coin_purchase event
     * takes the dollars off the stats' balance.
     * @param {string} id - Key of COIN_PACKS.
     * @param {number} donations - The stream's donation balance ($), from the stats.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    buyCoins(id, donations) {
      if (s.phase !== "shop") return { ok: false, reason: "the shop is closed" };
      const check = checkCoinPack(donations, id);
      if (!check.ok) {
        notice(check.reason);
        return check;
      }
      const { pack } = check;
      s.run.coins += pack.coins;
      notice(`+${pack.coins} coins for $${pack.dollars} of donations`);
      emit("coin_purchase", { pack: pack.name, dollars: pack.dollars, coins: pack.coins });
      return { ok: true };
    },

    /** Ends the run without a loss (quit or restart from the pause menu): back to the title. */
    abandon() {
      if (s.phase === "ready") return;
      s.bestWave = Math.max(s.bestWave, s.run.cleared);
      s.phase = "ready";
      s.storeOpen = false;
      s.enemies = [];
      s.bullets = [];
      s.coins = [];
      s.notice = null;
    },

    /**
     * One fixed step.
     * @param {number} dt - ms
     * @param {{moveX?: number, moveY?: number, aimX?: number, aimY?: number, fire?: boolean}} [controls]
     */
    update(dt, controls = {}) {
      snapshotPositions();
      if (s.notice) {
        s.notice.ms -= dt;
        if (s.notice.ms <= 0) s.notice = null;
      }
      for (const b of s.bursts) b.ageMs += dt;
      s.bursts = s.bursts.filter((b) => b.ageMs < BURST_MS);
      if (s.phase !== "wave") return;

      movePlayer(dt, controls);
      shoot(dt, controls);
      spawnEnemies(dt);
      moveEnemies(dt);
      moveBullets(dt);
      removeDead();
      collectCoins(dt);
      touchEnemies(dt);
      if (s.phase === "wave") checkWaveCleared();
    },

    /** The events since the last call, oldest first: [{name, data}]. */
    takeEvents() {
      const taken = events;
      events = [];
      return taken;
    },
  };
}

function circleHitsRect(c, r) {
  const cx = clamp(c.x, r.x, r.x + r.width);
  const cy = clamp(c.y, r.y, r.y + r.height);
  return Math.hypot(c.x - cx, c.y - cy) < c.r;
}

function pushOutOfRect(e, r, arena) {
  const cx = clamp(e.x, r.x, r.x + r.width);
  const cy = clamp(e.y, r.y, r.y + r.height);
  const dx = e.x - cx;
  const dy = e.y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= e.r) return;
  if (d > 0) {
    e.x = cx + (dx / d) * e.r;
    e.y = cy + (dy / d) * e.r;
    return;
  }
  // The centre is inside: leave by the nearest side that stays in the arena.
  const exits = [
    [e.x - r.x, r.x - e.r, e.y],
    [r.x + r.width - e.x, r.x + r.width + e.r, e.y],
    [e.y - r.y, e.x, r.y - e.r],
    [r.y + r.height - e.y, e.x, r.y + r.height + e.r],
  ].filter(
    ([, x, y]) =>
      x >= arena.x && x <= arena.x + arena.width && y >= arena.y && y <= arena.y + arena.height,
  );
  if (exits.length === 0) return;
  const [, x, y] = exits.sort((a, b) => a[0] - b[0])[0];
  e.x = x;
  e.y = y;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
