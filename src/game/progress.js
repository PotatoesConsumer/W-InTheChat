/**
 * progress.js
 *
 * What carries over between games and runs, kept in this browser: materials, and what
 * they're spent on in the Just Chatting base. No DOM (tested in Node with its own
 * storage). An extra outside the study: study and bot runs never load or save it.
 *
 *   Wave Survival   drops wood and rock          -> spent in the base
 *   The Dark House  escaping pays dark matter    -> ghost levels, Haunted House levels,
 *                                                   horror items, shooter boosts
 *   Donations ($)   buy any material, at a higher price than coins (they stay with you)
 *
 * In the base:
 *   - outside, the Haunted House and the Training Board start broken: fix them first
 *   - inside your house, furniture on a grid: the workbench crafts into the bag, and
 *     what's in the bag can be placed, moved or put back; looks only, except the
 *     workbench and the wardrobe (clothes: looks only, worn in Wave Survival)
 *   - the ghost (needs the Ghost Friend badge) lives in the house: damage, flying speed,
 *     hit speed; dark matter only
 *   - the Haunted House: its level makes The Dark House bigger and harder and pays more,
 *     and it sells the horror items: bought once, kept, one carried into a run
 *   - the Training Board: boosts multiply what one shop upgrade gives (+1 -> +2 -> +3)
 */

export const MATERIALS = Object.freeze({
  wood: Object.freeze({ name: "Wood", icon: "🪵" }),
  rock: Object.freeze({ name: "Rock", icon: "🪨" }),
  darkMatter: Object.freeze({ name: "Dark matter", icon: "🌑" }),
});

/** Bought with donation dollars (the `material_purchase` event spends them). */
export const MATERIAL_PACKS = Object.freeze([
  Object.freeze({ id: "wood", material: "wood", amount: 10, dollars: 15 }),
  Object.freeze({ id: "rock", material: "rock", amount: 10, dollars: 20 }),
  Object.freeze({ id: "darkMatter", material: "darkMatter", amount: 1, dollars: 40 }),
]);

/** The house's floor: a grid of tiles. The two tiles in front of the door stay clear. */
export const ROOM_GRID = Object.freeze({ cols: 16, rows: 8 });
export const DOOR_TILES = Object.freeze([
  Object.freeze({ gx: 7, gy: 7 }),
  Object.freeze({ gx: 8, gy: 7 }),
]);

/**
 * Furniture: its size in tiles, and its price at the workbench (null: not craftable; the
 * house starts with a workbench). `use` is what E does next to it.
 */
export const FURNITURE = Object.freeze({
  workbench: Object.freeze({ name: "Workbench", w: 2, h: 1, cost: null, use: "workbench" }),
  chair: Object.freeze({ name: "Chair", w: 1, h: 1, cost: { wood: 5 } }),
  table: Object.freeze({ name: "Table", w: 2, h: 1, cost: { wood: 8, rock: 2 } }),
  wardrobe: Object.freeze({
    name: "Wardrobe",
    w: 1,
    h: 2,
    cost: { wood: 12, rock: 4 },
    use: "wardrobe",
  }),
});
export const MAX_BAG = 20;

export const CLOTHES = Object.freeze({
  cap: Object.freeze({ name: "Red cap", slot: "hat", cost: { wood: 6 } }),
  crown: Object.freeze({ name: "Stone crown", slot: "hat", cost: { rock: 10, darkMatter: 1 } }),
  hoodie: Object.freeze({ name: "Purple hoodie", slot: "shirt", cost: { wood: 8, rock: 4 } }),
});

/** Ghost levels 0-5 per stat; the next level costs (level + 1) dark matter. */
export const GHOST_STATS = Object.freeze({
  damage: Object.freeze({ name: "Ghost damage" }),
  speed: Object.freeze({ name: "Ghost flying speed" }),
  rate: Object.freeze({ name: "Ghost hit speed" }),
});
export const GHOST_MAX_LEVEL = 5;

/** Outside: what fixing each broken place costs. */
export const FIXES = Object.freeze({
  haunted: Object.freeze({ name: "Haunted House", cost: { darkMatter: 1 } }),
  training: Object.freeze({ name: "Training Board", cost: { wood: 5, rock: 5 } }),
});

/** The Haunted House's levels; level 1 is the start. How each plays: horror/game.js. */
export const HOUSE_LEVELS = Object.freeze([
  Object.freeze({ level: 1, reward: 1, cost: null }),
  Object.freeze({ level: 2, reward: 3, cost: { darkMatter: 3, wood: 20, rock: 10 } }),
  Object.freeze({ level: 3, reward: 5, cost: { darkMatter: 6, wood: 40, rock: 25 } }),
]);

/** Bought once and kept; one is carried into a run (horror/game.js ITEM_EFFECTS). */
export const HORROR_ITEMS = Object.freeze({
  sonar: Object.freeze({
    name: "Sonar",
    text: "Always on: points to the nearest key",
    cost: { darkMatter: 1, rock: 5 },
  }),
  energy: Object.freeze({
    name: "Energy boost",
    text: "Run free for 5 s, then 20 s cooldown",
    cost: { darkMatter: 1, wood: 5 },
  }),
  gun: Object.freeze({
    name: "Freeze gun",
    text: "Stops the monster 10 s, then 40 s cooldown",
    cost: { darkMatter: 2, rock: 8 },
  }),
});

/** Shop upgrades a boost can multiply, and what a boost level costs (level 1, level 2). */
export const BOOSTABLE = Object.freeze(["heart", "rapid", "power", "boots", "medkit"]);
export const BOOST_COSTS = Object.freeze([
  Object.freeze({ darkMatter: 2, wood: 15, rock: 15 }),
  Object.freeze({ darkMatter: 4, wood: 30, rock: 30 }),
]);

export function emptyProgress() {
  return {
    materials: { wood: 0, rock: 0, darkMatter: 0 },
    ghost: { damage: 0, speed: 0, rate: 0 },
    house: 1,
    fixed: { haunted: false, training: false },
    items: { sonar: false, energy: false, gun: false },
    /** The one horror item taken into a run, or null. */
    carry: null,
    boosts: {},
    clothes: { owned: [], worn: { hat: null, shirt: null } },
    /** Furniture in the house: {id, gx, gy} by its top-left tile. */
    room: [{ id: "workbench", gx: ROOM_GRID.cols - 2, gy: 0 }],
    /** Furniture not placed: {id: count}. */
    bag: {},
  };
}

/**
 * The ghost's numbers for its levels (shooter/game.js uses them). At level 0 a hit does
 * 0.4 damage, so a slime (2 HP) takes 5 hits; each damage level adds 0.2.
 */
export function ghostStats(levels = {}) {
  return {
    damage: 0.4 + 0.2 * (levels.damage ?? 0),
    flySpeed: 150 * (1 + 0.25 * (levels.speed ?? 0)),
    hitDelayMs: 700 * 0.8 ** (levels.rate ?? 0),
  };
}

const int = (n, max = Infinity) => (Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0);

/** The tiles a piece covers. */
export function tilesOf({ id, gx, gy }) {
  const { w, h } = FURNITURE[id];
  const tiles = [];
  for (let y = gy; y < gy + h; y++) for (let x = gx; x < gx + w; x++) tiles.push({ gx: x, gy: y });
  return tiles;
}

/**
 * Whether a piece fits at (gx, gy): on the grid, off the door's tiles, and not on another
 * piece (`skip` is an index in `room` to ignore, for moving).
 */
export function fits(room, id, gx, gy, skip = -1) {
  if (!Object.hasOwn(FURNITURE, id)) return false;
  const taken = new Set(
    room.flatMap((f, i) => (i === skip ? [] : tilesOf(f).map((t) => `${t.gx},${t.gy}`))),
  );
  for (const d of DOOR_TILES) taken.add(`${d.gx},${d.gy}`);
  return tilesOf({ id, gx, gy }).every(
    (t) =>
      t.gx >= 0 &&
      t.gy >= 0 &&
      t.gx < ROOM_GRID.cols &&
      t.gy < ROOM_GRID.rows &&
      !taken.has(`${t.gx},${t.gy}`),
  );
}

/** Repairs anything read back from storage, so a bad save can't break a game. */
export function checkProgress(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== "object") return p;
  for (const m of Object.keys(p.materials)) p.materials[m] = int(raw.materials?.[m]);
  for (const g of Object.keys(p.ghost)) p.ghost[g] = int(raw.ghost?.[g], GHOST_MAX_LEVEL);
  p.house = Math.max(1, int(raw.house, HOUSE_LEVELS.length));
  for (const f of Object.keys(p.fixed)) p.fixed[f] = raw.fixed?.[f] === true;
  for (const i of Object.keys(p.items)) p.items[i] = raw.items?.[i] === true;
  p.carry = p.items[raw.carry] ? raw.carry : null;
  for (const b of BOOSTABLE) {
    const level = int(raw.boosts?.[b], BOOST_COSTS.length);
    if (level) p.boosts[b] = level;
  }
  const owned = Array.isArray(raw.clothes?.owned) ? raw.clothes.owned : [];
  p.clothes.owned = [...new Set(owned.filter((id) => Object.hasOwn(CLOTHES, id)))];
  for (const slot of ["hat", "shirt"]) {
    const id = raw.clothes?.worn?.[slot];
    if (p.clothes.owned.includes(id) && CLOTHES[id].slot === slot) p.clothes.worn[slot] = id;
  }
  if (Array.isArray(raw.room)) {
    p.room = [];
    for (const f of raw.room) {
      if (Number.isInteger(f?.gx) && Number.isInteger(f?.gy) && fits(p.room, f.id, f.gx, f.gy)) {
        p.room.push({ id: f.id, gx: f.gx, gy: f.gy });
      }
    }
  }
  for (const id of Object.keys(FURNITURE)) {
    const n = int(raw.bag?.[id], MAX_BAG);
    if (n) p.bag[id] = n;
  }
  return p;
}

/** Whether `materials` covers `cost`. */
export function canAfford(materials, cost) {
  return Object.entries(cost).every(([m, n]) => (materials[m] ?? 0) >= n);
}

/** "5 🪵 + 2 🪨" */
export function formatCost(cost) {
  return Object.entries(cost)
    .map(([m, n]) => `${n} ${MATERIALS[m].icon}`)
    .join(" + ");
}

const bagCount = (p) => Object.values(p.bag).reduce((a, b) => a + b, 0);

/**
 * The price of the next step of something in the base, or why it can't be bought.
 * @returns {{ok: true, cost: object} | {ok: false, reason: string}}
 */
export function priceFor(p, action) {
  const { kind, id } = action;
  if (kind === "craft") {
    if (!FURNITURE[id]?.cost) return { ok: false, reason: "can't be crafted" };
    if (bagCount(p) >= MAX_BAG) return { ok: false, reason: "your bag is full" };
    return { ok: true, cost: FURNITURE[id].cost };
  }
  if (kind === "clothes") {
    if (!Object.hasOwn(CLOTHES, id)) return { ok: false, reason: "unknown clothing" };
    if (p.clothes.owned.includes(id)) return { ok: false, reason: "already made" };
    return { ok: true, cost: CLOTHES[id].cost };
  }
  if (kind === "ghost") {
    if (!Object.hasOwn(GHOST_STATS, id)) return { ok: false, reason: "unknown ghost stat" };
    const level = p.ghost[id];
    if (level >= GHOST_MAX_LEVEL) return { ok: false, reason: "max level" };
    return { ok: true, cost: { darkMatter: level + 1 } };
  }
  if (kind === "fix") {
    if (!Object.hasOwn(FIXES, id)) return { ok: false, reason: "nothing to fix" };
    if (p.fixed[id]) return { ok: false, reason: "already fixed" };
    return { ok: true, cost: FIXES[id].cost };
  }
  if (kind === "house") {
    if (!p.fixed.haunted) return { ok: false, reason: "fix it first" };
    const next = HOUSE_LEVELS[p.house];
    return next ? { ok: true, cost: next.cost } : { ok: false, reason: "max level" };
  }
  if (kind === "item") {
    if (!Object.hasOwn(HORROR_ITEMS, id)) return { ok: false, reason: "unknown item" };
    if (!p.fixed.haunted) return { ok: false, reason: "fix it first" };
    if (p.items[id]) return { ok: false, reason: "already yours" };
    return { ok: true, cost: HORROR_ITEMS[id].cost };
  }
  if (kind === "boost") {
    if (!BOOSTABLE.includes(id)) return { ok: false, reason: "can't be boosted" };
    if (!p.fixed.training) return { ok: false, reason: "fix it first" };
    const level = p.boosts[id] ?? 0;
    if (level >= BOOST_COSTS.length) return { ok: false, reason: "max level" };
    return { ok: true, cost: BOOST_COSTS[level] };
  }
  return { ok: false, reason: "unknown" };
}

/**
 * Buys one thing in the base: pays its price and applies it. Pure: returns a new state.
 * @returns {{ok: true, progress: object} | {ok: false, reason: string}}
 */
export function buy(p, action) {
  const price = priceFor(p, action);
  if (!price.ok) return price;
  if (!canAfford(p.materials, price.cost)) return { ok: false, reason: "not enough materials" };
  const next = structuredClone(p);
  for (const [m, n] of Object.entries(price.cost)) next.materials[m] -= n;
  const { kind, id } = action;
  if (kind === "craft") next.bag[id] = (next.bag[id] ?? 0) + 1;
  else if (kind === "clothes") {
    next.clothes.owned.push(id);
    next.clothes.worn[CLOTHES[id].slot] = id;
  } else if (kind === "ghost") next.ghost[id]++;
  else if (kind === "fix") next.fixed[id] = true;
  else if (kind === "house") next.house++;
  else if (kind === "item") {
    next.items[id] = true;
    next.carry = id;
  } else if (kind === "boost") next.boosts[id] = (next.boosts[id] ?? 0) + 1;
  return { ok: true, progress: next };
}

/** Puts on a piece of clothing you own, or takes it off if it's on. */
export function toggleWear(p, id) {
  if (!p.clothes.owned.includes(id)) return p;
  const next = structuredClone(p);
  const slot = CLOTHES[id].slot;
  next.clothes.worn[slot] = next.clothes.worn[slot] === id ? null : id;
  return next;
}

/** Takes an owned horror item into runs (only one), or leaves it if it's the one carried. */
export function toggleCarry(p, id) {
  if (!p.items[id]) return p;
  return { ...p, carry: p.carry === id ? null : id };
}

/** Places a piece from the bag. @returns the new state, or null if it can't go there. */
export function place(p, id, gx, gy) {
  if (!(p.bag[id] > 0) || !fits(p.room, id, gx, gy)) return null;
  const next = structuredClone(p);
  if (--next.bag[id] === 0) delete next.bag[id];
  next.room.push({ id, gx, gy });
  return next;
}

/** Moves a placed piece. @returns the new state, or null if it can't go there. */
export function move(p, index, gx, gy) {
  const f = p.room[index];
  if (!f || !fits(p.room, f.id, gx, gy, index)) return null;
  const next = structuredClone(p);
  next.room[index] = { id: f.id, gx, gy };
  return next;
}

/** Puts a placed piece back in the bag. */
export function pickUp(p, index) {
  const f = p.room[index];
  if (!f) return p;
  const next = structuredClone(p);
  next.room.splice(index, 1);
  next.bag[f.id] = (next.bag[f.id] ?? 0) + 1;
  return next;
}

/**
 * Loads and saves progress.
 * @param {Pick<Storage, "getItem" | "setItem">} [storage] - localStorage by default; with
 *   none (private window, blocked) it keeps progress for this page only.
 */
export function createProgressStore(storage = browserStorage()) {
  const KEY = "witc.progress";
  let p;
  try {
    p = checkProgress(JSON.parse(storage.getItem(KEY) ?? "null"));
  } catch {
    p = emptyProgress();
  }
  function save(next) {
    if (!next) return null;
    p = next;
    try {
      storage.setItem(KEY, JSON.stringify(p));
    } catch {
      // Storage full or blocked: kept for this page only.
    }
    return p;
  }
  return {
    /** The current progress. Treat it as read-only. */
    get: () => p,
    /** Adds materials ({wood: 1}); negative or junk amounts are ignored. */
    add(materials) {
      const next = structuredClone(p);
      for (const [m, n] of Object.entries(materials)) {
        if (Object.hasOwn(next.materials, m) && Number.isInteger(n) && n > 0)
          next.materials[m] += n;
      }
      return save(next);
    },
    buy(action) {
      const result = buy(p, action);
      if (result.ok) save(result.progress);
      return result;
    },
    toggleWear: (id) => save(toggleWear(p, id)),
    toggleCarry: (id) => save(toggleCarry(p, id)),
    /** Each returns the new progress, or null if the piece can't go there. */
    place: (id, gx, gy) => save(place(p, id, gx, gy)),
    move: (index, gx, gy) => save(move(p, index, gx, gy)),
    pickUp: (index) => save(pickUp(p, index)),
  };
}

function browserStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Blocked (sandboxed frame, privacy settings).
  }
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
}

/** A store that remembers nothing, for study and bot runs. */
export function memoryProgressStore() {
  const memory = new Map();
  return createProgressStore({
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, value),
  });
}
