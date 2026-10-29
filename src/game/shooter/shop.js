/**
 * shop.js
 *
 * The shop between waves: upgrades bought with coins, and the coin store, where the
 * stream's donations buy coin packs like a mobile game's currency store. Pure functions,
 * tested in Node.
 *
 * Buying a pack spends the donations: the game sends a `coin_purchase` event and the
 * stats (src/game/stats.js) take the dollars off the donation balance. The game never
 * changes the stats itself.
 */

/**
 * `cost` is the first price in coins; each level bought adds `costStep`. `maxLevel` caps
 * upgrades (the medkit has none).
 */
export const SHOP_ITEMS = Object.freeze([
  { id: "medkit", name: "Medkit", text: "Heal 2 HP", cost: 60, costStep: 20, maxLevel: Infinity },
  { id: "heart", name: "Extra heart", text: "+1 max HP", cost: 150, costStep: 100, maxLevel: 5 },
  {
    id: "rapid",
    name: "Rapid fire",
    text: "Shoot 20% faster",
    cost: 120,
    costStep: 80,
    maxLevel: 5,
  },
  { id: "power", name: "Power shot", text: "+1 damage", cost: 180, costStep: 120, maxLevel: 4 },
  {
    id: "boots",
    name: "Swift boots",
    text: "Move 12% faster",
    cost: 100,
    costStep: 60,
    maxLevel: 4,
  },
  {
    id: "spread",
    name: "Spread shot",
    text: "Fire 3 bullets",
    cost: 350,
    costStep: 0,
    maxLevel: 1,
  },
]);

/**
 * Coin packs for donation dollars. Bigger packs give more coins per dollar, like a
 * mobile store; `tag` is the ribbon on the card.
 */
export const COIN_PACKS = Object.freeze([
  { id: "pile", name: "Pile of Coins", dollars: 10, coins: 25, tag: null },
  { id: "bag", name: "Bag of Coins", dollars: 25, coins: 70, tag: null },
  { id: "chest", name: "Chest of Coins", dollars: 50, coins: 150, tag: "Most popular" },
  { id: "vault", name: "Vault of Coins", dollars: 100, coins: 330, tag: "Best value" },
]);

export const MEDKIT_HEAL = 2;

const itemsById = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));
const packsById = Object.fromEntries(COIN_PACKS.map((pack) => [pack.id, pack]));

/** @param {string} id */
export function shopItem(id) {
  return Object.hasOwn(itemsById, id) ? itemsById[id] : null;
}

/** @param {string} id */
export function coinPack(id) {
  return Object.hasOwn(packsById, id) ? packsById[id] : null;
}

/**
 * Extra coins over the smallest pack's rate, in percent (the "+20%" badge).
 * @param {{dollars: number, coins: number}} pack
 */
export function packBonus(pack) {
  const base = COIN_PACKS[0].coins / COIN_PACKS[0].dollars;
  return Math.round((pack.coins / pack.dollars / base - 1) * 100);
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
 * Whether the donations can pay for a coin pack.
 * @param {number} donations - The stream's donation balance ($), from the stats.
 * @param {string} id
 * @returns {{ok: true, pack: object} | {ok: false, reason: string}}
 */
export function checkCoinPack(donations, id) {
  const pack = coinPack(id);
  if (!pack) return { ok: false, reason: "no such pack" };
  if (donations < pack.dollars) {
    return { ok: false, reason: `needs $${pack.dollars} in donations (you have $${donations})` };
  }
  return { ok: true, pack };
}
