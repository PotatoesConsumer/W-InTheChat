/**
 * game.js
 *
 * The Dark House, a first-person horror game: find the keys in a dark house, then get
 * out through the door before the monster catches you. State and rules only, no DOM or
 * 3D (tested in Node; seeded random). view3d.js draws it with Three.js.
 *
 * The house is a grid of CELL-metre squares, seen from above: x across, y down (y is
 * the 3D scene's z). The player's `angle` is the facing direction in that plane.
 *
 * Catalog events (src/events/schema.js), all minor and optional (an extra, not in the
 * study):
 *   horror_start  a run starts                    {keys}
 *   key_found     picked up a key                 {keys, total}
 *   monster_near  the monster came close           {}
 *   escaped       out through the door: a win     {keys, seconds}
 *   caught        the monster got the player       {keys, total}
 */

/** `#` wall, `.` floor, `K` a place a key may be, `D` the door, `P` start, `M` monster. */
export const HOUSE = Object.freeze([
  "###############",
  "#K....#...#..K#",
  "#.....#...#...#",
  "#.........#...#",
  "###.####..###.#",
  "#......#......#",
  "#.P....#..M...D",
  "#......####.###",
  "##.###.......K#",
  "#K..#...#.....#",
  "###############",
]);

export const CELL = 2;

export const HORROR = Object.freeze({
  keys: 3,
  playerSpeed: 3.2, // m/s; faster than the monster's chase, so it can be outrun
  /** Running (Shift): faster, while stamina lasts. Empty, it must refill to `rerun`. */
  runSpeed: 5,
  stamina: 100,
  staminaDrain: 30, // per second of running
  staminaRegen: 18, // per second of not running
  rerun: 30,
  turnSpeed: 2.4, // rad/s, arrow keys
  playerRadius: 0.3,
  wanderSpeed: 1.4,
  chaseSpeed: 2.6,
  monsterRadius: 0.35,
  /** Sees the player this far with a clear line, and hears them this close through walls. */
  sightRange: 9,
  hearRange: 3,
  /** Keeps chasing this long after losing the player. */
  forgetMs: 3000,
  catchRange: 0.7,
  nearRange: 4,
  nearCooldownMs: 8000,
  /** The monster waits this long after the start. */
  graceMs: 2500,
  pickupRange: 0.9,
  doorRange: 1.3,
  repathMs: 300,
});

function cellsOf(char) {
  const found = [];
  HOUSE.forEach((row, r) => [...row].forEach((ch, c) => ch === char && found.push({ c, r })));
  return found;
}

const centre = ({ c, r }) => ({ x: (c + 0.5) * CELL, y: (r + 0.5) * CELL });
const cellAt = (x, y) => ({ c: Math.floor(x / CELL), r: Math.floor(y / CELL) });
const charAt = (c, r) => HOUSE[r]?.[c] ?? "#";

/**
 * @param {object} [opts]
 * @param {() => number} [opts.random] - Seeded in tests; picks the key spots and the
 *   monster's wandering.
 */
export function createHorror({ random = Math.random } = {}) {
  const door = { ...centre(cellsOf("D")[0]), open: false };
  let events = [];
  const s = { phase: "ready", door };
  reset();

  function reset() {
    const spots = cellsOf("K").map(centre);
    const keys = [];
    while (keys.length < HORROR.keys && spots.length > 0) {
      keys.push({ ...spots.splice(Math.floor(random() * spots.length), 1)[0], taken: false });
    }
    Object.assign(s, {
      player: { ...centre(cellsOf("P")[0]), angle: 0, stamina: HORROR.stamina, tired: false },
      monster: {
        ...centre(cellsOf("M")[0]),
        mode: "wander",
        path: [],
        repathMs: 0,
        lastSeenMs: 0,
      },
      keys,
      keysFound: 0,
      elapsedMs: 0,
      nearCooldownMs: 0,
    });
    door.open = false;
  }

  function emit(name, data = {}) {
    events.push({ name, data });
  }

  // A door that's still locked is a wall.
  function solid(c, r) {
    const ch = charAt(c, r);
    return ch === "#" || (ch === "D" && !door.open);
  }

  function hitsWall(x, y, radius) {
    const c0 = Math.floor((x - radius) / CELL);
    const c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((y - radius) / CELL);
    const r1 = Math.floor((y + radius) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!solid(c, r)) continue;
        const nx = Math.max(c * CELL, Math.min(x, (c + 1) * CELL));
        const ny = Math.max(r * CELL, Math.min(y, (r + 1) * CELL));
        if ((x - nx) ** 2 + (y - ny) ** 2 < radius * radius) return true;
      }
    }
    return false;
  }

  /** Moves by (dx, dy), sliding along walls one axis at a time. */
  function slide(body, dx, dy, radius) {
    if (!hitsWall(body.x + dx, body.y, radius)) body.x += dx;
    if (!hitsWall(body.x, body.y + dy, radius)) body.y += dy;
  }

  function clearLine(a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(dist / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const { c, r } = cellAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (solid(c, r)) return false;
    }
    return true;
  }

  /** Breadth-first path of cell centres from one point to another (target excluded if unreachable). */
  function pathTo(from, to) {
    const start = cellAt(from.x, from.y);
    const goal = cellAt(to.x, to.y);
    const key = (c, r) => r * 100 + c;
    const came = new Map([[key(start.c, start.r), null]]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur.c === goal.c && cur.r === goal.r) break;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = { c: cur.c + dc, r: cur.r + dr };
        const k = key(next.c, next.r);
        if (came.has(k) || solid(next.c, next.r) || charAt(next.c, next.r) === "D") continue;
        came.set(k, cur);
        queue.push(next);
      }
    }
    const path = [];
    for (let cur = goal; cur && came.has(key(cur.c, cur.r)); cur = came.get(key(cur.c, cur.r))) {
      path.unshift(centre(cur));
    }
    return path.slice(1); // drop the cell it's already in
  }

  function randomFloor() {
    const floor = [];
    HOUSE.forEach((row, r) =>
      [...row].forEach((ch, c) => ".KPM".includes(ch) && floor.push({ c, r })),
    );
    return centre(floor[Math.floor(random() * floor.length)]);
  }

  function updateMonster(dt) {
    const m = s.monster;
    const p = s.player;
    if (s.elapsedMs < HORROR.graceMs) return;
    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    const sees = (dist < HORROR.sightRange && clearLine(m, p)) || dist < HORROR.hearRange;
    if (sees) {
      m.mode = "chase";
      m.lastSeenMs = 0;
    } else if (m.mode === "chase" && (m.lastSeenMs += dt) > HORROR.forgetMs) {
      m.mode = "wander";
      m.path = [];
    }

    const speed = m.mode === "chase" ? HORROR.chaseSpeed : HORROR.wanderSpeed;
    let target;
    if (m.mode === "chase" && clearLine(m, p)) {
      target = p;
    } else {
      m.repathMs -= dt;
      if (m.mode === "chase" && m.repathMs <= 0) {
        m.path = pathTo(m, p);
        m.repathMs = HORROR.repathMs;
      } else if (m.path.length === 0) {
        m.path = pathTo(m, randomFloor());
      }
      target = m.path[0];
    }
    if (target) {
      const tx = target.x - m.x;
      const ty = target.y - m.y;
      const len = Math.hypot(tx, ty);
      const step = Math.min(len, (speed * dt) / 1000);
      if (len > 0) slide(m, (tx / len) * step, (ty / len) * step, HORROR.monsterRadius);
      if (target !== p && Math.hypot(target.x - m.x, target.y - m.y) < 0.1) m.path.shift();
    }

    const after = Math.hypot(p.x - m.x, p.y - m.y);
    s.nearCooldownMs = Math.max(0, s.nearCooldownMs - dt);
    if (after < HORROR.catchRange) {
      s.phase = "caught";
      emit("caught", { keys: s.keysFound, total: s.keys.length });
    } else if (after < HORROR.nearRange && s.nearCooldownMs === 0) {
      s.nearCooldownMs = HORROR.nearCooldownMs;
      emit("monster_near");
    }
  }

  return {
    get state() {
      return s;
    },

    start() {
      reset();
      s.phase = "playing";
      emit("horror_start", { keys: s.keys.length });
    },

    /**
     * One fixed step.
     * @param {number} dt - ms
     * @param {{forward?: number, strafe?: number, turn?: number, run?: boolean}} [controls] -
     *   forward and strafe in -1..1; turn in radians (mouse look plus arrow keys); run
     *   while Shift is held.
     */
    update(dt, { forward = 0, strafe = 0, turn = 0, run = false } = {}) {
      if (s.phase !== "playing") return;
      s.elapsedMs += dt;
      const p = s.player;
      p.angle += turn;
      const len = Math.hypot(forward, strafe);
      const running = run && len > 0 && !p.tired;
      p.stamina = running
        ? Math.max(0, p.stamina - (HORROR.staminaDrain * dt) / 1000)
        : Math.min(HORROR.stamina, p.stamina + (HORROR.staminaRegen * dt) / 1000);
      if (p.stamina === 0) p.tired = true;
      else if (p.tired && p.stamina >= HORROR.rerun) p.tired = false;
      p.running = running;
      if (len > 0) {
        const speed = running ? HORROR.runSpeed : HORROR.playerSpeed;
        const dist = (speed * dt) / 1000 / Math.max(1, len);
        const cos = Math.cos(p.angle);
        const sin = Math.sin(p.angle);
        slide(
          p,
          (cos * forward - sin * strafe) * dist,
          (sin * forward + cos * strafe) * dist,
          HORROR.playerRadius,
        );
      }

      for (const k of s.keys) {
        if (k.taken || Math.hypot(k.x - p.x, k.y - p.y) > HORROR.pickupRange) continue;
        k.taken = true;
        s.keysFound++;
        emit("key_found", { keys: s.keysFound, total: s.keys.length });
        if (s.keysFound === s.keys.length) door.open = true;
      }

      if (door.open && Math.hypot(door.x - p.x, door.y - p.y) < HORROR.doorRange) {
        s.phase = "escaped";
        emit("escaped", { keys: s.keysFound, seconds: Math.round(s.elapsedMs / 1000) });
        return;
      }
      updateMonster(dt);
    },

    takeEvents() {
      const out = events;
      events = [];
      return out;
    },

    /** Drops the run (pause menu: restart or quit) without an event. */
    abandon() {
      reset();
      s.phase = "ready";
    },
  };
}
