/**
 * game.js
 *
 * Just Chatting, the base: a room where the streamer walks between stations and spends
 * what the other games drop (progress.js). Movement, which station is in reach and the
 * open menu's selection only, no DOM (tested in Node); index.js fills the menus and
 * draws it.
 */

/** Where each station stands in the room (below the HUD strip), and what it's for. */
export const STATIONS = Object.freeze([
  Object.freeze({ id: "workbench", name: "Workbench", what: "furniture", x: 150, y: 150 }),
  Object.freeze({ id: "wardrobe", name: "Wardrobe", what: "clothes", x: 150, y: 400 }),
  Object.freeze({ id: "shrine", name: "Ghost Shrine", what: "ghost", x: 480, y: 120 }),
  Object.freeze({ id: "haunted", name: "Haunted House", what: "horror", x: 810, y: 150 }),
  Object.freeze({ id: "training", name: "Training Board", what: "shooter", x: 420, y: 450 }),
  Object.freeze({ id: "trader", name: "Trader", what: "materials", x: 620, y: 450 }),
]);

export const BASE = Object.freeze({ speed: 220, radius: 16, reach: 75, top: 40 });

/**
 * @param {{x: number, y: number, width: number, height: number}} room - Walkable area.
 */
export function createBase(room) {
  const start = { x: room.x + room.width / 2, y: room.y + room.height / 2 };
  const s = {
    player: { ...start, prevX: start.x, prevY: start.y, r: BASE.radius, aimX: 0, aimY: 1 },
    /** The open station menu: {station, index}, or null while walking. */
    menu: null,
  };

  /** The station in reach (the nearest one), or null. */
  function near() {
    let best = null;
    let bestDist = BASE.reach;
    for (const st of STATIONS) {
      const d = Math.hypot(st.x - s.player.x, st.y - s.player.y);
      if (d < bestDist) [best, bestDist] = [st, d];
    }
    return best;
  }

  return {
    get state() {
      return s;
    },
    near,

    /**
     * One fixed step of walking (not while a menu is open).
     * @param {number} dt - ms
     * @param {{moveX?: number, moveY?: number}} [controls]
     */
    update(dt, { moveX = 0, moveY = 0 } = {}) {
      const p = s.player;
      p.prevX = p.x;
      p.prevY = p.y;
      if (s.menu) return;
      const len = Math.hypot(moveX, moveY);
      if (len === 0) return;
      const step = (BASE.speed * dt) / 1000 / len;
      p.aimX = moveX / len;
      p.aimY = moveY / len;
      p.x = Math.min(room.x + room.width - p.r, Math.max(room.x + p.r, p.x + moveX * step));
      p.y = Math.min(room.y + room.height - p.r, Math.max(room.y + p.r, p.y + moveY * step));
    },

    /** E: opens the station in reach; false if none is. */
    open() {
      const station = near();
      if (!station) return false;
      s.menu = { station, index: 0 };
      return true;
    },

    close() {
      if (!s.menu) return false;
      s.menu = null;
      return true;
    },

    /** Moves the menu selection over `count` rows, wrapping. */
    move(delta, count) {
      if (!s.menu || count === 0) return;
      s.menu.index = (((s.menu.index + delta) % count) + count) % count;
    },

    /** Points the selection at a row (number keys, mouse). */
    point(index, count) {
      if (s.menu && index >= 0 && index < count) s.menu.index = index;
    },
  };
}
