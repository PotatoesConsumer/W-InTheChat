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
 *   - furniture (chair, table): placed in the room, looks only
 *   - clothing: looks only, worn in Wave Survival (one hat, one shirt)
 *   - the ghost (needs the Ghost Friend badge): damage, flying speed, hit speed; dark
 *     matter only
 *   - the Haunted House: its level makes The Dark House bigger and harder and pays more
 *   - horror items to take into The Dark House: sonar, energy boost, freeze gun
 *   - shooter boosts: each level multiplies what one shop upgrade gives (+1 -> +2 -> +3)
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

export const FURNITURE = Object.freeze({
  chair: Object.freeze({ name: "Chair", cost: { wood: 5 } }),
  table: Object.freeze({ name: "Table", cost: { wood: 8, rock: 2 } }),
});
export const MAX_FURNITURE = 12;

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

/** The Haunted House's levels; level 1 is the start. How each plays: horror/game.js. */
export const HOUSE_LEVELS = Object.freeze([
  Object.freeze({ level: 1, reward: 1, cost: null }),
  Object.freeze({ level: 2, reward: 3, cost: { darkMatter: 3, wood: 20, rock: 10 } }),
  Object.freeze({ level: 3, reward: 5, cost: { darkMatter: 6, wood: 40, rock: 25 } }),
]);

export const HORROR_ITEMS = Object.freeze({
  sonar: Object.freeze({
    name: "Sonar",
    text: "Bottom left: points to the nearest key, for a whole run",
    key: "1",
    cost: { darkMatter: 1, rock: 5 },
  }),
  energy: Object.freeze({
    name: "Energy boost",
    text: "Run without using stamina for 5 s",
    key: "2",
    cost: { darkMatter: 1, wood: 5 },
  }),
  gun: Object.freeze({
    name: "Freeze gun",
    text: "Stops the monster for 10 s",
    key: "3",
    cost: { darkMatter: 2, rock: 8 },
  }),
});
export const MAX_ITEMS = 9;

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
    items: { sonar: 0, energy: 0, gun: 0 },
    boosts: {},
    clothes: { owned: [], worn: { hat: null, shirt: null } },
    furniture: [],
  };
}

/** The ghost's numbers for its levels (shooter/game.js uses them). */
export function ghostStats(levels = {}) {
  return {
    damage: 1 + (levels.damage ?? 0),
    flySpeed: 150 * (1 + 0.25 * (levels.speed ?? 0)),
    hitDelayMs: 700 * 0.8 ** (levels.rate ?? 0),
  };
}

const int = (n, max = Infinity) => (Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0);

/** Repairs anything read back from storage, so a bad save can't break a game. */
export function checkProgress(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== "object") return p;
  for (const m of Object.keys(p.materials)) p.materials[m] = int(raw.materials?.[m]);
  for (const g of Object.keys(p.ghost)) p.ghost[g] = int(raw.ghost?.[g], GHOST_MAX_LEVEL);
  p.house = Math.max(1, int(raw.house, HOUSE_LEVELS.length));
  for (const i of Object.keys(p.items)) p.items[i] = int(raw.items?.[i], MAX_ITEMS);
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
  const furniture = Array.isArray(raw.furniture) ? raw.furniture : [];
  p.furniture = furniture
    .filter((f) => Object.hasOwn(FURNITURE, f?.id) && Number.isFinite(f.x) && Number.isFinite(f.y))
    .slice(0, MAX_FURNITURE)
    .map(({ id, x, y }) => ({ id, x, y }));
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

/**
 * The price of the next step of something in the base, or why it can't be bought.
 * @returns {{ok: true, cost: object} | {ok: false, reason: string}}
 */
export function priceFor(p, action) {
  const { kind, id } = action;
  if (kind === "furniture") {
    if (!Object.hasOwn(FURNITURE, id)) return { ok: false, reason: "unknown furniture" };
    if (p.furniture.length >= MAX_FURNITURE) return { ok: false, reason: "the room is full" };
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
  if (kind === "house") {
    const next = HOUSE_LEVELS[p.house];
    return next ? { ok: true, cost: next.cost } : { ok: false, reason: "max level" };
  }
  if (kind === "item") {
    if (!Object.hasOwn(HORROR_ITEMS, id)) return { ok: false, reason: "unknown item" };
    if (p.items[id] >= MAX_ITEMS) return { ok: false, reason: "you can't carry more" };
    return { ok: true, cost: HORROR_ITEMS[id].cost };
  }
  if (kind === "boost") {
    if (!BOOSTABLE.includes(id)) return { ok: false, reason: "can't be boosted" };
    const level = p.boosts[id] ?? 0;
    if (level >= BOOST_COSTS.length) return { ok: false, reason: "max level" };
    return { ok: true, cost: BOOST_COSTS[level] };
  }
  return { ok: false, reason: "unknown" };
}

/**
 * Buys one thing in the base: pays its price and applies it. Pure: returns a new state.
 * `at` is where a new piece of furniture goes.
 * @returns {{ok: true, progress: object} | {ok: false, reason: string}}
 */
export function buy(p, action, at = { x: 0, y: 0 }) {
  const price = priceFor(p, action);
  if (!price.ok) return price;
  if (!canAfford(p.materials, price.cost)) return { ok: false, reason: "not enough materials" };
  const next = structuredClone(p);
  for (const [m, n] of Object.entries(price.cost)) next.materials[m] -= n;
  const { kind, id } = action;
  if (kind === "furniture") next.furniture.push({ id, x: at.x, y: at.y });
  else if (kind === "clothes") {
    next.clothes.owned.push(id);
    next.clothes.worn[CLOTHES[id].slot] = id;
  } else if (kind === "ghost") next.ghost[id]++;
  else if (kind === "house") next.house++;
  else if (kind === "item") next.items[id]++;
  else if (kind === "boost") next.boosts[id] = (next.boosts[id] ?? 0) + 1;
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
    buy(action, at) {
      const result = buy(p, action, at);
      if (result.ok) save(result.progress);
      return result;
    },
    toggleWear: (id) => save(toggleWear(p, id)),
    /** Uses up one horror item; false if there's none. */
    useItem(id) {
      if (!(p.items[id] > 0)) return false;
      const next = structuredClone(p);
      next.items[id]--;
      save(next);
      return true;
    },
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
