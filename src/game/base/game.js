/**
 * game.js
 *
 * Just Chatting, the base. Two scenes:
 *   - outside: a yard bigger than the screen (the camera follows you) with your house,
 *     the Haunted House and the Training Board
 *   - inside your house: furniture on a grid (progress.js ROOM_GRID), and the ghost
 *     flying about once it's unlocked
 * Walking, collisions, what's in reach and the open menu only, no DOM (tested in Node);
 * index.js fills the menus, handles the bag and placing, and draws it.
 */

import { ROOM_GRID, FURNITURE, tilesOf } from "../progress.js";

/** The playfield below the HUD strip, in scene coordinates. */
export const VIEW = Object.freeze({ top: 40, width: 960, height: 500 });

export const OUTSIDE = Object.freeze({
  width: 1920,
  height: 1080,
  start: Object.freeze({ x: 960, y: 640 }),
  /** Buildings you can't walk through. */
  solids: Object.freeze([
    Object.freeze({ id: "home", x: 760, y: 220, width: 400, height: 260 }),
    Object.freeze({ id: "haunted", x: 1420, y: 170, width: 220, height: 170 }),
    Object.freeze({ id: "training", x: 380, y: 680, width: 90, height: 30 }),
  ]),
  /** Where you stand to use each place (E). */
  spots: Object.freeze([
    Object.freeze({ id: "door", x: 960, y: 500 }),
    Object.freeze({ id: "haunted", x: 1530, y: 365 }),
    Object.freeze({ id: "training", x: 425, y: 735 }),
  ]),
});

/** The house's floor on screen: ROOM_GRID tiles of TILE px, centred in the view. */
export const TILE = 48;
export const ROOM = Object.freeze({
  x: (VIEW.width - ROOM_GRID.cols * TILE) / 2,
  y: VIEW.top + (VIEW.height - ROOM_GRID.rows * TILE) / 2,
  width: ROOM_GRID.cols * TILE,
  height: ROOM_GRID.rows * TILE,
});
/** The door, in the middle of the bottom wall. */
export const ROOM_DOOR = Object.freeze({ x: ROOM.x + ROOM.width / 2, y: ROOM.y + ROOM.height });

export const BASE = Object.freeze({ speed: 220, radius: 14, reach: 60, ghostSpeed: 45 });

/** A placed piece's rectangle on screen. */
export function pieceRect(f) {
  const { w, h } = FURNITURE[f.id];
  return { x: ROOM.x + f.gx * TILE, y: ROOM.y + f.gy * TILE, width: w * TILE, height: h * TILE };
}

/** The tile under a screen point inside the house, or null off the floor. */
export function tileAt(x, y) {
  const gx = Math.floor((x - ROOM.x) / TILE);
  const gy = Math.floor((y - ROOM.y) / TILE);
  if (gx < 0 || gy < 0 || gx >= ROOM_GRID.cols || gy >= ROOM_GRID.rows) return null;
  return { gx, gy };
}

/** Outside: the top-left of what's on screen, following the player. */
export function camera(p) {
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  return {
    x: clamp(p.x - VIEW.width / 2, OUTSIDE.width - VIEW.width),
    y: clamp(p.y - VIEW.height / 2, OUTSIDE.height - VIEW.height),
  };
}

const distToRect = (p, r) =>
  Math.hypot(
    p.x - Math.max(r.x, Math.min(p.x, r.x + r.width)),
    p.y - Math.max(r.y, Math.min(p.y, r.y + r.height)),
  );

/**
 * @param {object} [opts]
 * @param {() => number} [opts.random] - Where the ghost wanders next.
 */
export function createBase({ random = Math.random } = {}) {
  const s = {
    scene: "outside",
    player: {
      ...OUTSIDE.start,
      prevX: OUTSIDE.start.x,
      prevY: OUTSIDE.start.y,
      r: BASE.radius,
      aimX: 0,
      aimY: 1,
    },
    /** The open menu: {target, index}, or null while walking. */
    menu: null,
    ghost: { x: ROOM.x + 100, y: ROOM.y + 100, tx: ROOM.x + 100, ty: ROOM.y + 100 },
  };

  /** What blocks walking in this scene. */
  function solids(room) {
    return s.scene === "outside" ? OUTSIDE.solids : room.map(pieceRect);
  }

  function blocked(x, y, room) {
    const r = BASE.radius;
    const area =
      s.scene === "outside" ? { x: 0, y: 0, width: OUTSIDE.width, height: OUTSIDE.height } : ROOM;
    if (x - r < area.x || y - r < area.y || x + r > area.x + area.width) return true;
    if (y + r > area.y + area.height) return true;
    return solids(room).some((rect) => distToRect({ x, y }, rect) < r);
  }

  /**
   * The thing in reach: {kind: "spot", id} outside; inside the door, the ghost (if it's
   * out) or a piece of furniture you can use ({kind: "piece", index, use}).
   */
  function near(room, ghostOut) {
    const p = s.player;
    if (s.scene === "outside") {
      const spot = OUTSIDE.spots.find((sp) => Math.hypot(sp.x - p.x, sp.y - p.y) < BASE.reach);
      return spot ? { kind: "spot", id: spot.id } : null;
    }
    if (Math.hypot(ROOM_DOOR.x - p.x, ROOM_DOOR.y - p.y) < BASE.reach)
      return { kind: "spot", id: "door" };
    if (ghostOut && Math.hypot(s.ghost.x - p.x, s.ghost.y - p.y) < BASE.reach)
      return { kind: "ghost" };
    let best = null;
    let bestDist = BASE.reach / 2;
    room.forEach((f, index) => {
      const use = FURNITURE[f.id].use;
      const d = distToRect(p, pieceRect(f));
      if (use && d < bestDist) [best, bestDist] = [{ kind: "piece", index, use }, d];
    });
    return best;
  }

  function moveGhost(dt) {
    const g = s.ghost;
    const d = Math.hypot(g.tx - g.x, g.ty - g.y);
    if (d < 4) {
      g.tx = ROOM.x + 30 + random() * (ROOM.width - 60);
      g.ty = ROOM.y + 30 + random() * (ROOM.height - 60);
      return;
    }
    const step = Math.min(d, (BASE.ghostSpeed * dt) / 1000);
    g.x += ((g.tx - g.x) / d) * step;
    g.y += ((g.ty - g.y) / d) * step;
  }

  return {
    get state() {
      return s;
    },
    near,

    /**
     * One fixed step. Walking stops while a menu is open; the ghost keeps flying.
     * @param {number} dt - ms
     * @param {{moveX?: number, moveY?: number}} controls
     * @param {object[]} room - The placed furniture (progress.room).
     */
    update(dt, { moveX = 0, moveY = 0 } = {}, room = []) {
      const p = s.player;
      p.prevX = p.x;
      p.prevY = p.y;
      moveGhost(dt);
      if (s.menu) return;
      const len = Math.hypot(moveX, moveY);
      if (len === 0) return;
      const step = (BASE.speed * dt) / 1000 / len;
      p.aimX = moveX / len;
      p.aimY = moveY / len;
      if (!blocked(p.x + moveX * step, p.y, room)) p.x += moveX * step;
      if (!blocked(p.x, p.y + moveY * step, room)) p.y += moveY * step;
    },

    /**
     * E: goes through the door, or opens the menu of what's in reach.
     * @returns {"enter" | "exit" | "menu" | null}
     */
    use(room, ghostOut) {
      const target = near(room, ghostOut);
      if (!target) return null;
      const p = s.player;
      if (target.kind === "spot" && target.id === "door") {
        const goingIn = s.scene === "outside";
        s.scene = goingIn ? "inside" : "outside";
        const at = goingIn
          ? { x: ROOM_DOOR.x, y: ROOM_DOOR.y - TILE / 2 }
          : { x: OUTSIDE.spots[0].x, y: OUTSIDE.spots[0].y + 30 };
        Object.assign(p, at, { prevX: at.x, prevY: at.y });
        return goingIn ? "enter" : "exit";
      }
      const id =
        target.kind === "spot" ? target.id : target.kind === "ghost" ? "ghost" : target.use;
      s.menu = { target: id, index: 0 };
      return "menu";
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

    /** Whether the player stands on any of a piece's tiles (it can't be placed there). */
    standsOn(id, gx, gy) {
      return tilesOf({ id, gx, gy }).some(
        (t) => distToRect(s.player, pieceRect({ id: "chair", gx: t.gx, gy: t.gy })) < BASE.radius,
      );
    },
  };
}
