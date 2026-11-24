/**
 * menus.js
 *
 * What each menu in the base offers, as rows: {label, detail, ok, action?}. `ok` says
 * whether it can be done now (`detail` says the price, or why not); `action` is what
 * index.js does on Space or a click. Pure, tested.
 */

import {
  BOOSTABLE,
  BOOST_COSTS,
  CLOTHES,
  FIXES,
  FURNITURE,
  GHOST_STATS,
  HORROR_ITEMS,
  HOUSE_LEVELS,
  canAfford,
  formatCost,
  priceFor,
} from "../progress.js";
import { shopItem } from "../shooter/shop.js";

/** Menu titles and icons, by target. */
export const MENUS = Object.freeze({
  workbench: Object.freeze({ title: "Workbench", icon: "🔨" }),
  wardrobe: Object.freeze({ title: "Wardrobe", icon: "👕" }),
  ghost: Object.freeze({ title: "Your ghost", icon: "👻" }),
  haunted: Object.freeze({ title: "Haunted House", icon: "🏚️" }),
  training: Object.freeze({ title: "Training Board", icon: "🎯" }),
});

/** A row that buys something from progress.js (`buy`). */
function buyRow(progress, action, label) {
  const price = priceFor(progress, action);
  if (!price.ok) return { label, detail: price.reason, ok: false, action };
  const ok = canAfford(progress.materials, price.cost);
  return { label, detail: formatCost(price.cost), ok, action };
}

/** The fix row for a broken place, or null once it's fixed. */
function fixRow(progress, id) {
  if (progress.fixed[id]) return null;
  return buyRow(progress, { kind: "fix", id }, `It's broken. Fix the ${FIXES[id].name}`);
}

/**
 * @param {string} target - A MENUS key.
 * @param {{progress: object}} ctx
 */
export function baseRows(target, { progress }) {
  if (target === "workbench") {
    return Object.entries(FURNITURE)
      .filter(([, f]) => f.cost)
      .map(([id, f]) => buyRow(progress, { kind: "craft", id }, `Craft a ${f.name.toLowerCase()}`));
  }
  if (target === "wardrobe") {
    return Object.entries(CLOTHES).map(([id, c]) => {
      if (!progress.clothes.owned.includes(id)) {
        return buyRow(progress, { kind: "clothes", id }, `Make: ${c.name}`);
      }
      const on = progress.clothes.worn[c.slot] === id;
      return {
        label: `${on ? "Take off" : "Wear"}: ${c.name}`,
        detail: on ? "wearing it in Wave Survival" : `your ${c.slot}`,
        ok: true,
        action: { kind: "wear", id },
      };
    });
  }
  if (target === "ghost") {
    const pet = {
      label: "Pet the ghost",
      detail: "it likes that",
      ok: true,
      action: { kind: "pet" },
    };
    const levels = Object.entries(GHOST_STATS).map(([id, g]) =>
      buyRow(progress, { kind: "ghost", id }, `${g.name}: level ${progress.ghost[id]}`),
    );
    return [pet, ...levels];
  }
  if (target === "haunted") {
    const fix = fixRow(progress, "haunted");
    if (fix) return [fix];
    const next = HOUSE_LEVELS[progress.house];
    const house = buyRow(
      progress,
      { kind: "house" },
      next
        ? `Haunted House level ${progress.house} → ${next.level} (pays ${next.reward} 🌑)`
        : `Haunted House level ${progress.house}`,
    );
    const items = Object.entries(HORROR_ITEMS).map(([id, item]) => {
      if (!progress.items[id]) return buyRow(progress, { kind: "item", id }, `Buy: ${item.name}`);
      const carried = progress.carry === id;
      return {
        label: `${carried ? "Taking" : "Take"}: ${item.name}`,
        detail: carried ? `${item.text} (the one you bring)` : item.text,
        ok: true,
        action: { kind: "carry", id },
      };
    });
    const reward = HOUSE_LEVELS[progress.play - 1].reward;
    const play = {
      label: `Play level ${progress.play} of ${progress.house} (pays ${reward} 🌑)`,
      detail: progress.house > 1 ? "choose to switch level" : "unlock more levels above",
      ok: progress.house > 1,
      action: { kind: "play" },
    };
    return [house, play, ...items];
  }
  if (target === "training") {
    const fix = fixRow(progress, "training");
    if (fix) return [fix];
    return BOOSTABLE.map((id) => {
      const boost = progress.boosts[id] ?? 0;
      const name = `${shopItem(id).name} boost ×${boost + 1}`;
      const label = boost < BOOST_COSTS.length ? `${name} → ×${boost + 2}` : name;
      return buyRow(progress, { kind: "boost", id }, label);
    });
  }
  return [];
}
