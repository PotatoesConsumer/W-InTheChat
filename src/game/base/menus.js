/**
 * menus.js
 *
 * What each station's menu offers, as rows: {label, detail, ok, action?}. `ok` says
 * whether it can be done now (`detail` says the price, or why not); `action` is what
 * index.js does on Space or a click. Pure, tested.
 */

import {
  BOOSTABLE,
  BOOST_COSTS,
  CLOTHES,
  FURNITURE,
  GHOST_STATS,
  HORROR_ITEMS,
  HOUSE_LEVELS,
  MATERIAL_PACKS,
  MATERIALS,
  canAfford,
  formatCost,
  priceFor,
} from "../progress.js";
import { shopItem } from "../shooter/shop.js";

/** A row that buys something from progress.js (`buy`). */
function buyRow(progress, action, label) {
  const price = priceFor(progress, action);
  if (!price.ok) return { label, detail: price.reason, ok: false, action };
  return {
    label,
    detail: formatCost(price.cost),
    ok: canAfford(progress.materials, price.cost),
    action,
  };
}

/**
 * @param {string} station - A STATIONS id.
 * @param {{progress: object, ghost: boolean, donations: number}} ctx - `ghost`: the
 *   Ghost Friend badge is earned; `donations`: the stream's balance ($) to spend.
 */
export function baseRows(station, { progress, ghost, donations }) {
  if (station === "workbench") {
    return Object.entries(FURNITURE).map(([id, f]) =>
      buyRow(progress, { kind: "furniture", id }, `Build a ${f.name.toLowerCase()}`),
    );
  }
  if (station === "wardrobe") {
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
  if (station === "shrine") {
    if (!ghost) {
      return [
        {
          label: "The shrine is quiet",
          detail: "Escape The Dark House to meet your ghost",
          ok: false,
        },
      ];
    }
    return Object.entries(GHOST_STATS).map(([id, g]) =>
      buyRow(progress, { kind: "ghost", id }, `${g.name}: level ${progress.ghost[id]}`),
    );
  }
  if (station === "haunted") {
    const next = HOUSE_LEVELS[progress.house];
    const house = buyRow(
      progress,
      { kind: "house" },
      next
        ? `Haunted House level ${progress.house} → ${next.level} (pays ${next.reward} 🌑)`
        : `Haunted House level ${progress.house}`,
    );
    const items = Object.entries(HORROR_ITEMS).map(([id, item]) =>
      buyRow(progress, { kind: "item", id }, `${item.name} ×${progress.items[id]}: ${item.text}`),
    );
    return [house, ...items];
  }
  if (station === "training") {
    return BOOSTABLE.map((id) => {
      const boost = progress.boosts[id] ?? 0;
      const name = `${shopItem(id).name} boost ×${boost + 1}`;
      const label = boost < BOOST_COSTS.length ? `${name} → ×${boost + 2}` : name;
      return buyRow(progress, { kind: "boost", id }, label);
    });
  }
  if (station === "trader") {
    return MATERIAL_PACKS.map((pack) => ({
      label: `${pack.amount} ${MATERIALS[pack.material].icon} ${MATERIALS[pack.material].name}`,
      detail:
        donations >= pack.dollars
          ? `$${pack.dollars} of donations`
          : `$${pack.dollars} (not enough donations)`,
      ok: donations >= pack.dollars,
      action: { kind: "materials", pack },
    }));
  }
  return [];
}
