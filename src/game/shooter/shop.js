/**
 * shop.js
 *
 * The shop between waves: items bought with coins, and cashing out the stream's
 * donations into coins. Pure functions over the run's upgrade levels, tested in Node.
 *
 * Coins come from enemies and from donations. Donations are the stream stat
 * (src/game/stats.js), which only grows; the game remembers how much it already cashed
 * out, so the same dollars can't be turned into coins twice.
 */

/**
 * `cost` is the first price; each level bought adds `costStep`. `maxLevel` caps upgrades
 * (the medkit has none).
 */
export const SHOP_ITEMS = Object.freeze([
  { id: "medkit", name: "Medkit", text: "Heal 2 HP", cost: 6, costStep: 2, maxLevel: Infinity },
  { id: "heart", name: "Extra heart", text: "+1 max HP", cost: 15, costStep: 10, maxLevel: 5 },
  { id: "rapid", name: "Rapid fire", text: "Shoot 20% faster", cost: 12, costStep: 8, maxLevel: 5 },
  { id: "power", name: "Power shot", text: "+1 damage", cost: 18, costStep: 12, maxLevel: 4 },
  { id: "boots", name: "Swift boots", text: "Move 12% faster", cost: 10, costStep: 6, maxLevel: 4 },
  { id: "spread", name: "Spread shot", text: "Fire 3 bullets", cost: 35, costStep: 0, maxLevel: 1 },
]);

/** Dollars of donations per coin when cashing out. */
export const DOLLARS_PER_COIN = 5;

export const MEDKIT_HEAL = 2;

const byId = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

/** @param {string} id */
export function shopItem(id) {
  return Object.hasOwn(byId, id) ? byId[id] : null;
}

/**
 * The price of the next level of an item.
 * @param {{cost: number, costStep: number}} item
 * @param {number} level - Levels already bought.
 */
export function priceOf(item, level) {
  return item.cost + item.costStep * level;
}

/**
 * Whether the player can buy an item now, and why not.
 * @param {{coins: number, hp: number, maxHp: number, levels: Record<string, number>}} run
 * @param {string} id
 * @returns {{ok: true, price: number} | {ok: false, reason: string}}
 */
export function checkPurchase(run, id) {
  const item = shopItem(id);
  if (!item) return { ok: false, reason: "no such item" };
  const level = run.levels[id] ?? 0;
  if (level >= item.maxLevel) return { ok: false, reason: "sold out" };
  if (id === "medkit" && run.hp >= run.maxHp) return { ok: false, reason: "already at full HP" };
  const price = priceOf(item, level);
  if (run.coins < price) return { ok: false, reason: `needs ${price} coins` };
  return { ok: true, price };
}

/**
 * How many coins cashing out would give, and the dollars it uses up. Leftover dollars
 * that don't make a whole coin stay for next time.
 * @param {number} donations - The stream's donation total ($).
 * @param {number} cashed - Dollars already turned into coins.
 */
export function cashOutValue(donations, cashed) {
  const coins = Math.max(0, Math.floor((donations - cashed) / DOLLARS_PER_COIN));
  return { coins, dollars: coins * DOLLARS_PER_COIN };
}
