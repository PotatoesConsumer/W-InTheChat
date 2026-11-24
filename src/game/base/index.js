/**
 * index.js
 *
 * Just Chatting as a hub game module (interface in src/game/hub.js). You start outside;
 * E uses what's in reach (a door, a place, a piece of furniture, the ghost). Crafted
 * furniture goes in the bag (the button top right, or B); from the bag you place it on
 * the house's grid. Right-click a piece to move it or put it back in the bag. What's
 * bought is saved in progress (src/game/progress.js). The Store button (top left)
 * sells materials for the stream's donations, like Wave Survival's coin store, through a
 * `material_purchase` event that spends them.
 */

import {
  createBase,
  camera,
  pieceRect,
  tileAt,
  OUTSIDE,
  ROOM,
  ROOM_DOOR,
  TILE,
  VIEW,
} from "./game.js";
import { baseRows, MENUS } from "./menus.js";
import {
  MATERIAL_PACKS,
  CLOTHES,
  FIXES,
  FURNITURE,
  GHOST_STATS,
  HORROR_ITEMS,
  HOUSE_LEVELS,
  MATERIALS,
  ROOM_GRID,
  fits,
  tilesOf,
} from "../progress.js";
import { drawPlayer, drawGhost, drawMaterial } from "../shooter/view.js";

const BINDINGS = Object.freeze({
  KeyW: "up",
  KeyA: "left",
  KeyS: "down",
  KeyD: "right",
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowRight: "right",
  KeyE: "use",
  KeyB: "bag",
  Space: "action",
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Digit${n}`, `row${n}`])),
});

const COLORS = Object.freeze({
  grass: ["#4f8a3c", "#4a8338"],
  path: "#b99a6b",
  floor: ["#6b5240", "#634b3a"],
  wall: "#2c2230",
  wood: "#8b5a33",
  woodLight: "#a8703f",
  text: "#fff8e7",
  muted: "#c9c0a8",
  panel: "rgba(24, 20, 30, 0.96)",
  row: "#2f2838",
  rowActive: "#9147ff",
  ok: "#7ee08a",
  no: "#ff8a8a",
});

// Below the top-centre donation alerts (effects.js), clear of the facecam.
const MENU = { x: 230, y: 130, width: 500, rowHeight: 52 };
const STORE_BUTTON = { x: 8, y: 6, width: 86, height: 28 };
const STORE = {
  x: 150,
  y: 76,
  width: 660,
  height: 330,
  card: { y: 176, width: 190, height: 200, gap: 25 },
};
const BAG_BUTTON = { x: VIEW.width - 116, y: 6, width: 104, height: 28 };
const BAG = { x: VIEW.width - 300, y: 44, width: 288, rowHeight: 40 };
const CONTEXT = { width: 130, rowHeight: 30, rows: ["Move", "Put in bag"] };
const PET_COOLDOWN_MS = 3000;

const inside = (r, x, y) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** Trees around the yard (fixed spots, drawn only). */
const TREES = Object.freeze(
  [
    [120, 120],
    [300, 260],
    [180, 520],
    [620, 140],
    [1240, 120],
    [1780, 140],
    [1820, 520],
    [1700, 900],
    [980, 960],
    [560, 940],
    [140, 960],
    [1100, 620],
    [700, 760],
  ].map(([x, y]) => Object.freeze({ x, y })),
);

export const justChatting = Object.freeze({
  id: "just-chatting",
  title: "Just Chatting",
  blurb: "Your base. Fix things up, build and decorate your house, visit your ghost.",
  controls: Object.freeze([
    ["WASD", "walk"],
    ["E", "use / go in or out"],
    ["B / bag button", "your bag: place furniture"],
    ["Right-click", "move or pack furniture"],
  ]),
  bindings: BINDINGS,
  drawThumbnail,

  /**
   * @param {object} opts
   * @param {{width: number, height: number}} opts.world
   * @param {{donations: () => number}} opts.stream
   * @param {object} [opts.perks] - main.js: `progress` (the store; in the study one that
   *   remembers nothing) and `ghost()` (the badge: the ghost lives in the house).
   */
  create({ world, stream, perks = {} }) {
    const base = createBase();
    const progress = perks.progress;
    const ghostOut = () => perks.ghost?.() ?? false;
    let events = [];
    let notice = null;
    let petMs = 0;
    // Dollars spent on materials whose events haven't reached the stats yet (as the coin store).
    let unsettled = 0;
    /** The bag panel, a piece being placed ({id, from: index or null}), the right-click menu. */
    const ui = { bag: false, placing: null, context: null, store: false };

    const room = () => progress.get().room;
    const donations = () => stream.donations() - unsettled;
    const rows = () =>
      base.state.menu ? baseRows(base.state.menu.target, { progress: progress.get() }) : [];

    function say(text) {
      notice = { text, ms: 2400 };
    }

    function choose(row) {
      if (!row?.action) return;
      const { action } = row;
      if (action.kind === "pet") {
        if (petMs > 0) return say("The ghost is still happy from the last one");
        petMs = PET_COOLDOWN_MS;
        events.push({ name: "ghost_pet", data: {} });
        return say("The ghost wiggles happily 👻");
      }
      if (!row.ok) return say(row.detail);
      if (action.kind === "wear") {
        const { name, slot } = CLOTHES[action.id];
        const on = progress.toggleWear(action.id).clothes.worn[slot] === action.id;
        return say(on ? `Wearing the ${name.toLowerCase()}` : `Took off the ${name.toLowerCase()}`);
      }
      if (action.kind === "play") {
        if (progress.get().house < 2) return say("Upgrade the Haunted House to unlock level 2");
        return say(`You'll play level ${progress.nextPlayLevel().play}`);
      }
      if (action.kind === "carry") {
        const carried = progress.toggleCarry(action.id).carry === action.id;
        const { name } = HORROR_ITEMS[action.id];
        return say(carried ? `You'll bring the ${name.toLowerCase()}` : "You'll bring no item");
      }
      const result = progress.buy(action);
      if (!result.ok) return say(result.reason);
      const item = action.kind === "craft" ? FURNITURE[action.id].name : itemName(action);
      events.push({ name: "crafted", data: { item } });
      say(action.kind === "craft" ? `${item} is in your bag (B)` : `Done: ${item}`);
    }

    /** The Store: one pack of a material for donation dollars. */
    function buyPack(pack) {
      if (donations() < pack.dollars) return say("Not enough donations");
      unsettled += pack.dollars;
      progress.add({ [pack.material]: pack.amount });
      events.push({
        name: "material_purchase",
        data: { material: pack.material, amount: pack.amount, dollars: pack.dollars },
      });
      say(`+${pack.amount} ${MATERIALS[pack.material].icon}`);
    }

    /** The placed piece under a screen point, as its index in the room, or -1. */
    function pieceAt(point) {
      const tile = tileAt(point.x, point.y);
      if (!tile) return -1;
      return room().findIndex((f) => tilesOf(f).some((t) => t.gx === tile.gx && t.gy === tile.gy));
    }

    /** Where the piece being placed would go: its top-left tile under the pointer. */
    function placeAt(pointer) {
      if (!ui.placing || !pointer) return null;
      const { w, h } = FURNITURE[ui.placing.id];
      const tile = tileAt(pointer.x - ((w - 1) * TILE) / 2, pointer.y - ((h - 1) * TILE) / 2);
      if (!tile) return null;
      const skip = ui.placing.from ?? -1;
      const ok =
        fits(room(), ui.placing.id, tile.gx, tile.gy, skip) &&
        !base.standsOn(ui.placing.id, tile.gx, tile.gy);
      return { ...tile, ok };
    }

    function drop(point) {
      const at = placeAt(point);
      if (!at?.ok) return say("It doesn't fit there");
      const { id, from } = ui.placing;
      if (from === null) progress.place(id, at.gx, at.gy);
      else progress.move(from, at.gx, at.gy);
      ui.placing = null;
      say(`${FURNITURE[id].name} placed`);
    }

    function bagRows() {
      return Object.entries(progress.get().bag).filter(([, n]) => n > 0);
    }

    function clickBag(point) {
      const index = Math.floor((point.y - (BAG.y + 44)) / BAG.rowHeight);
      const list = bagRows();
      if (index < 0 || index >= list.length) return;
      if (base.state.scene !== "inside") return say("Go inside your house to place furniture");
      ui.placing = { id: list[index][0], from: null };
      ui.bag = false;
    }

    function clickContext(point) {
      const c = ui.context;
      ui.context = null;
      const index = Math.floor((point.y - c.y) / CONTEXT.rowHeight);
      if (point.x < c.x || point.x > c.x + CONTEXT.width) return;
      if (index === 0) ui.placing = { id: room()[c.index].id, from: c.index };
      else if (index === 1) {
        const { name } = FURNITURE[room()[c.index].id];
        progress.pickUp(c.index);
        say(`${name} is in your bag`);
      }
    }

    function closeAll() {
      base.close();
      Object.assign(ui, { bag: false, placing: null, context: null, store: false });
    }

    return {
      get state() {
        return base.state;
      },

      update(dt, { input }) {
        if (notice && (notice.ms -= dt) <= 0) notice = null;
        petMs = Math.max(0, petMs - dt);
        const s = base.state;
        if (input.wasPressed("bag")) ui.bag = !ui.bag;
        if (ui.store) return; // the store is open: no walking
        if (input.wasPressed("use") && !ui.placing) {
          ui.context = null;
          if (s.menu) base.close();
          else {
            const what = base.use(room(), ghostOut());
            if (what === "enter") say("Home sweet home");
            else if (!what) say("Nothing to use here");
          }
        }
        if (s.menu) {
          const list = rows();
          const step = (input.wasPressed("down") ? 1 : 0) - (input.wasPressed("up") ? 1 : 0);
          if (step) base.move(step, list.length);
          for (let n = 1; n <= 6; n++) {
            if (input.wasPressed(`row${n}`) && n <= list.length) {
              base.point(n - 1, list.length);
              choose(list[n - 1]);
            }
          }
          if (input.wasPressed("action")) choose(list[s.menu.index]);
        }
        const axis = (minus, plus) => (input.isDown(plus) ? 1 : 0) - (input.isDown(minus) ? 1 : 0);
        base.update(dt, { moveX: axis("left", "right"), moveY: axis("up", "down") }, room());
      },

      /** Left click: bag, placing, menus. Right click: a piece's Move / Put in bag menu. */
      pointerDown(point, { button = 0 } = {}) {
        const s = base.state;
        if (button === 2) {
          ui.context = null;
          if (s.scene !== "inside" || ui.placing || s.menu) return;
          const index = pieceAt(point);
          if (index >= 0) ui.context = { index, x: point.x, y: point.y };
          return;
        }
        if (inside(BAG_BUTTON, point.x, point.y)) {
          ui.bag = !ui.bag;
          return;
        }
        if (inside(STORE_BUTTON, point.x, point.y)) {
          ui.store = !ui.store;
          return;
        }
        if (ui.store) {
          const card = storeCards().findIndex((c) => inside(c, point.x, point.y));
          if (card >= 0) buyPack(MATERIAL_PACKS[card]);
          else if (!inside(STORE, point.x, point.y)) ui.store = false;
          return;
        }
        if (ui.context) return clickContext(point);
        const bagArea = { ...BAG, height: 60 + bagRows().length * BAG.rowHeight };
        if (ui.bag && inside(bagArea, point.x, point.y)) return clickBag(point);
        ui.bag = false;
        if (ui.placing) return drop(point);
        if (s.menu) {
          const list = rows();
          const index = Math.floor((point.y - (MENU.y + 70)) / MENU.rowHeight);
          const onMenu = point.x > MENU.x && point.x < MENU.x + MENU.width;
          if (onMenu && index >= 0 && index < list.length) {
            base.point(index, list.length);
            choose(list[index]);
          } else base.close();
        }
      },

      /** Escape closes the right-click menu, placing, the bag, then a menu, before pausing. */
      back() {
        if (ui.store) ui.store = false;
        else if (ui.context) ui.context = null;
        else if (ui.placing) ui.placing = null;
        else if (ui.bag) ui.bag = false;
        else return base.close();
        return true;
      },

      render(ctx, { alpha, clock, pointer }) {
        const p = progress.get();
        const s = base.state;
        const looks = { hat: p.clothes.worn.hat, shirt: p.clothes.worn.shirt };
        const target = s.menu || ui.placing ? null : base.near(p.room, ghostOut());
        if (s.scene === "outside") drawOutside(ctx, s, p, { alpha, clock, looks, target });
        else {
          drawInside(ctx, s, p, {
            alpha,
            clock,
            looks,
            target,
            ghost: ghostOut(),
            placing: ui.placing,
            at: placeAt(pointer),
          });
        }
        drawHud(ctx, world, p, donations());
        if (ui.bag) drawBag(ctx, bagRows(), s.scene === "inside");
        if (ui.context) drawContext(ctx, ui.context);
        if (s.menu) drawMenu(ctx, s, rows());
        if (ui.store) drawStore(ctx, donations(), p, pointer);
        if (notice) drawNotice(ctx, world, notice.text);
      },

      takeEvents() {
        unsettled = 0;
        const out = events;
        events = [];
        return out;
      },

      restart: closeAll,
      quit: closeAll,

      /** Chat knows when you're in a menu, like the shooter's shop. */
      chatScene() {
        return base.state.menu ? "shop" : undefined;
      },
    };
  },
});

function itemName({ kind, id }) {
  if (kind === "clothes") return CLOTHES[id].name;
  if (kind === "ghost") return `${GHOST_STATS[id].name} up`;
  if (kind === "fix") return `the ${FIXES[id].name} fixed`;
  if (kind === "house") return "a scarier Haunted House";
  if (kind === "item") return HORROR_ITEMS[id].name;
  if (kind === "boost") return "a shooter boost";
  return id;
}

function text(
  ctx,
  value,
  x,
  y,
  { size = 14, weight = 400, align = "left", color = COLORS.text } = {},
) {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function roundRect(ctx, x, y, width, height, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
  ctx.fill();
}

/** "E" bobbing over what's in reach. */
function prompt(ctx, x, y, clock, label) {
  const bob = Math.sin(clock / 200) * 2;
  text(ctx, `E  ${label}`, x, y + bob, {
    size: 13,
    weight: 800,
    align: "center",
    color: "#ffd34e",
  });
}

// --- outside --------------------------------------------------------------------------

function drawOutside(ctx, s, p, { alpha, clock, looks, target }) {
  const cam = camera(s.player);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEW.top, VIEW.width, VIEW.height);
  ctx.clip();
  ctx.translate(-cam.x, VIEW.top - cam.y);

  // Grass in big checks, only what's on screen.
  const size = 64;
  for (let y = Math.floor(cam.y / size) * size; y < cam.y + VIEW.height; y += size) {
    for (let x = Math.floor(cam.x / size) * size; x < cam.x + VIEW.width; x += size) {
      ctx.fillStyle = COLORS.grass[(x / size + y / size) % 2 === 0 ? 0 : 1];
      ctx.fillRect(x, y, size, size);
    }
  }
  // Paths from the front door to each place.
  ctx.strokeStyle = COLORS.path;
  ctx.lineWidth = 34;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const spot of OUTSIDE.spots.slice(1)) {
    ctx.moveTo(OUTSIDE.spots[0].x, OUTSIDE.spots[0].y);
    ctx.lineTo(spot.x, spot.y);
  }
  ctx.stroke();

  for (const t of TREES) drawTree(ctx, t.x, t.y);
  const solid = (id) => OUTSIDE.solids.find((r) => r.id === id);
  drawHome(ctx, solid("home"));
  drawHaunted(ctx, solid("haunted"), p.fixed.haunted, p.house, clock);
  drawBoard(ctx, solid("training"), p.fixed.training);

  // The player is in yard coordinates; drawPlayer works in screen ones.
  drawPlayer(ctx, { ...s.player, invulnerableMs: 0 }, alpha, clock, looks);
  if (target) {
    const spot = OUTSIDE.spots.find((sp) => sp.id === target.id);
    const labels = {
      door: "go inside",
      haunted: p.fixed.haunted ? "Haunted House" : "fix it",
      training: p.fixed.training ? "Training Board" : "fix it",
    };
    prompt(ctx, spot.x, spot.y - 46, clock, labels[target.id]);
  }
  ctx.restore();
}

function drawTree(ctx, x, y) {
  ctx.fillStyle = "#6b4226";
  ctx.fillRect(x - 6, y, 12, 22);
  ctx.fillStyle = "#2f6b2a";
  ctx.beginPath();
  ctx.arc(x, y - 6, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3d8236";
  ctx.beginPath();
  ctx.arc(x - 8, y - 14, 14, 0, Math.PI * 2);
  ctx.fill();
}

function drawHome(ctx, r) {
  // A cosy house seen from the front: roof, wall, two windows, the door.
  ctx.fillStyle = "#c9a27a";
  ctx.fillRect(r.x, r.y + r.height * 0.27, r.width, r.height * 0.73);
  ctx.fillStyle = "#9b3f3a";
  ctx.beginPath();
  ctx.moveTo(r.x - r.width * 0.05, r.y + r.height * 0.31);
  ctx.lineTo(r.x + r.width / 2, r.y);
  ctx.lineTo(r.x + r.width * 1.05, r.y + r.height * 0.31);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe6a3";
  ctx.fillRect(r.x + r.width * 0.12, r.y + r.height * 0.46, r.width * 0.18, r.height * 0.2);
  ctx.fillRect(r.x + r.width * 0.7, r.y + r.height * 0.46, r.width * 0.18, r.height * 0.2);
  ctx.fillStyle = "#5a3520";
  const door = { w: r.width * 0.15, h: r.height * 0.35 };
  ctx.fillRect(r.x + r.width / 2 - door.w / 2, r.y + r.height - door.h, door.w, door.h);
}

function drawHaunted(ctx, r, fixed, level, clock) {
  ctx.fillStyle = fixed ? "#3b2a4a" : "#4a4a4a";
  ctx.fillRect(r.x, r.y + 50, r.width, r.height - 50);
  ctx.fillStyle = fixed ? "#24182e" : "#333";
  ctx.beginPath();
  ctx.moveTo(r.x - 10, r.y + 60);
  ctx.lineTo(r.x + r.width / 2, r.y);
  ctx.lineTo(r.x + r.width + 10, r.y + 60);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fixed ? `rgba(160, 90, 255, ${0.6 + Math.sin(clock / 300) * 0.3})` : "#222";
  ctx.fillRect(r.x + 30, r.y + 80, 40, 36);
  ctx.fillRect(r.x + r.width - 70, r.y + 80, 40, 36);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(r.x + r.width / 2 - 22, r.y + r.height - 60, 44, 60);
  if (!fixed) {
    // Boarded up.
    ctx.fillStyle = "#8b6a44";
    for (const [dy, tilt] of [
      [-50, 0.3],
      [-30, -0.3],
    ]) {
      ctx.save();
      ctx.translate(r.x + r.width / 2, r.y + r.height + dy);
      ctx.rotate(tilt);
      ctx.fillRect(-36, -5, 72, 10);
      ctx.restore();
    }
  }
  const label = fixed ? `Haunted House Lv ${level}` : "Haunted House (broken)";
  text(ctx, label, r.x + r.width / 2, r.y + r.height + 14, {
    size: 13,
    weight: 800,
    align: "center",
  });
}

function drawBoard(ctx, r, fixed) {
  ctx.fillStyle = "#6b4226";
  ctx.fillRect(r.x + 8, r.y - 40, 8, 70);
  ctx.fillRect(r.x + r.width - 16, r.y - 40, 8, 70);
  ctx.fillStyle = fixed ? "#e8d9b5" : "#9a9a8a";
  ctx.fillRect(r.x, r.y - 50, r.width, 46);
  if (fixed) {
    for (const [rad, color] of [
      [18, "#d8343a"],
      [12, "#fff"],
      [6, "#d8343a"],
    ]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(r.x + r.width / 2, r.y - 27, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r.x + 10, r.y - 46);
    ctx.lineTo(r.x + 40, r.y - 24);
    ctx.lineTo(r.x + 30, r.y - 8);
    ctx.stroke();
  }
  const label = fixed ? "Training Board" : "Training Board (broken)";
  text(ctx, label, r.x + r.width / 2, r.y + 46, { size: 13, weight: 800, align: "center" });
}

// --- inside ---------------------------------------------------------------------------

function drawInside(ctx, s, p, { alpha, clock, looks, target, ghost, placing, at }) {
  // The yard's grass around the house, the same checks as outside.
  const size = 64;
  for (let y = VIEW.top; y < VIEW.top + VIEW.height; y += size) {
    for (let x = 0; x < VIEW.width; x += size) {
      ctx.fillStyle = COLORS.grass[(x / size + (y - VIEW.top) / size) % 2 === 0 ? 0 : 1];
      ctx.fillRect(x, y, size, size);
    }
  }
  for (let gy = 0; gy < ROOM_GRID.rows; gy++) {
    for (let gx = 0; gx < ROOM_GRID.cols; gx++) {
      ctx.fillStyle = COLORS.floor[(gx + gy) % 2];
      ctx.fillRect(ROOM.x + gx * TILE, ROOM.y + gy * TILE, TILE, TILE);
    }
  }
  // A thin wall around the floor, with a gap for the door at the bottom.
  const wall = 8;
  const gap = 80;
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(ROOM.x - wall, ROOM.y - wall, ROOM.width + wall * 2, wall); // top
  ctx.fillRect(ROOM.x - wall, ROOM.y, wall, ROOM.height + wall); // left
  ctx.fillRect(ROOM.x + ROOM.width, ROOM.y, wall, ROOM.height + wall); // right
  const bottom = ROOM.y + ROOM.height;
  ctx.fillRect(ROOM.x, bottom, ROOM_DOOR.x - gap / 2 - ROOM.x, wall);
  ctx.fillRect(ROOM_DOOR.x + gap / 2, bottom, ROOM.x + ROOM.width - ROOM_DOOR.x - gap / 2, wall);
  // The doormat.
  ctx.fillStyle = "#9b3f3a";
  ctx.fillRect(ROOM_DOOR.x - 34, ROOM_DOOR.y - 20, 68, 16);

  if (placing) {
    // The grid, while placing.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= ROOM_GRID.cols; gx++) {
      ctx.beginPath();
      ctx.moveTo(ROOM.x + gx * TILE, ROOM.y);
      ctx.lineTo(ROOM.x + gx * TILE, ROOM.y + ROOM.height);
      ctx.stroke();
    }
    for (let gy = 0; gy <= ROOM_GRID.rows; gy++) {
      ctx.beginPath();
      ctx.moveTo(ROOM.x, ROOM.y + gy * TILE);
      ctx.lineTo(ROOM.x + ROOM.width, ROOM.y + gy * TILE);
      ctx.stroke();
    }
  }

  p.room.forEach((f, i) => {
    if (placing?.from === i) return; // being moved: drawn at the pointer instead
    drawPiece(ctx, f, pieceRect(f));
  });
  if (placing && at) {
    const rect = pieceRect({ id: placing.id, gx: at.gx, gy: at.gy });
    ctx.globalAlpha = 0.6;
    drawPiece(ctx, { id: placing.id }, rect);
    ctx.globalAlpha = 1;
    ctx.fillStyle = at.ok ? "rgba(126,224,138,0.35)" : "rgba(255,80,80,0.4)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  drawPlayer(ctx, { ...s.player, invulnerableMs: 0 }, alpha, clock, looks);
  if (ghost) drawGhost(ctx, { x: s.ghost.x, y: s.ghost.y + Math.sin(clock / 300) * 3 }, clock);

  if (target) {
    if (target.kind === "ghost") prompt(ctx, s.ghost.x, s.ghost.y - 30, clock, "pet / talk");
    else if (target.kind === "spot") {
      prompt(ctx, ROOM_DOOR.x, ROOM_DOOR.y - 50, clock, "go outside");
    } else {
      const r = pieceRect(p.room[target.index]);
      prompt(ctx, r.x + r.width / 2, r.y - 12, clock, MENUS[target.use].title);
    }
  }
  if (placing) {
    text(ctx, "Click to place · Esc to stop", VIEW.width / 2, VIEW.top + 22, {
      size: 13,
      weight: 700,
      align: "center",
      color: COLORS.muted,
    });
  }
}

/** A piece of furniture, top-down, filling its tiles. */
function drawPiece(ctx, { id }, r) {
  const { x, y, width: w, height: h } = r;
  if (id === "workbench") {
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(x + 4, y + 6, w - 8, h - 10);
    ctx.fillStyle = COLORS.woodLight;
    ctx.fillRect(x + 6, y + 8, w - 12, h - 18);
    ctx.fillStyle = "#777";
    ctx.fillRect(x + w * 0.12, y + h * 0.25, w * 0.19, h * 0.21); // vise
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(x + w * 0.64, y + h * 0.3, w * 0.23, h * 0.08); // saw
    ctx.fillStyle = "#3a3a46";
    ctx.fillRect(x + w / 2 - 3, y + h * 0.25, 6, h * 0.38); // hammer
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(x + w / 2 - 8, y + h * 0.25, 16, 6);
  } else if (id === "table") {
    ctx.fillStyle = COLORS.wood;
    ctx.fillRect(x + 4, y + 8, w - 8, h - 14);
    ctx.fillStyle = COLORS.woodLight;
    ctx.fillRect(x + 6, y + 10, w - 12, h - 20);
  } else if (id === "wardrobe") {
    ctx.fillStyle = "#5a3520";
    ctx.fillRect(x + 4, y + 2, w - 8, h - 6);
    ctx.fillStyle = "#7a4a2a";
    ctx.fillRect(x + 7, y + 5, (w - 17) / 2, h - 12);
    ctx.fillRect(x + w / 2 + 1.5, y + 5, (w - 17) / 2, h - 12);
    ctx.fillStyle = "#ffd34e";
    ctx.fillRect(x + w / 2 - 4, y + h / 2, 2, 6);
    ctx.fillRect(x + w / 2 + 2, y + h / 2, 2, 6);
  } else {
    ctx.fillStyle = COLORS.wood;
    ctx.fillRect(x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.17); // back
    ctx.fillRect(x + w * 0.2, y + h * 0.29, w * 0.6, h * 0.54); // seat
    ctx.fillStyle = COLORS.woodLight;
    ctx.fillRect(x + w * 0.27, y + h * 0.35, w * 0.46, h * 0.42);
  }
}

// --- HUD, bag, menus ------------------------------------------------------------------

function drawHud(ctx, world, progress, donations) {
  ctx.fillStyle = "rgba(16, 12, 20, 0.92)";
  ctx.fillRect(0, 0, world.width, VIEW.top);
  ctx.fillStyle = "#c9932b";
  roundRect(ctx, STORE_BUTTON.x, STORE_BUTTON.y, STORE_BUTTON.width, STORE_BUTTON.height, 6);
  text(ctx, "🛒 Store", STORE_BUTTON.x + STORE_BUTTON.width / 2, 20, {
    size: 13,
    weight: 800,
    align: "center",
  });
  let x = STORE_BUTTON.x + STORE_BUTTON.width + 16;
  for (const [id, m] of Object.entries(MATERIALS)) {
    if (id !== "darkMatter") drawMaterial(ctx, id, x + 8, 20);
    else text(ctx, m.icon, x, 20, { size: 16 });
    text(ctx, `${progress.materials[id]}`, x + 22, 20, { size: 15, weight: 700 });
    x += 74;
  }
  text(ctx, `$${donations} donations`, x + 10, 20, { size: 14, weight: 700, color: "#ffd34e" });
  if (progress.fixed.haunted) {
    const reward = HOUSE_LEVELS[progress.play - 1].reward;
    text(ctx, `Dark House Lv ${progress.play} · pays ${reward} 🌑`, BAG_BUTTON.x - 14, 20, {
      size: 12,
      align: "right",
      color: COLORS.muted,
    });
  }
  const count = Object.values(progress.bag).reduce((a, b) => a + b, 0);
  ctx.fillStyle = "#3a2f45";
  roundRect(ctx, BAG_BUTTON.x, BAG_BUTTON.y, BAG_BUTTON.width, BAG_BUTTON.height, 6);
  text(ctx, `🎒 Bag (${count})`, BAG_BUTTON.x + BAG_BUTTON.width / 2, 20, {
    size: 13,
    weight: 700,
    align: "center",
  });
}

function drawBag(ctx, list, isInside) {
  const height = 60 + Math.max(1, list.length) * BAG.rowHeight;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, BAG.x, BAG.y, BAG.width, height, 10);
  text(ctx, "🎒 Bag", BAG.x + 16, BAG.y + 22, { size: 16, weight: 800 });
  const hint = isInside ? "click one to place it" : "place furniture inside";
  text(ctx, hint, BAG.x + BAG.width - 14, BAG.y + 22, {
    size: 11,
    align: "right",
    color: COLORS.muted,
  });
  if (list.length === 0) {
    text(ctx, "Empty. Craft at the workbench.", BAG.x + 16, BAG.y + 62, {
      size: 13,
      color: COLORS.muted,
    });
    return;
  }
  list.forEach(([id, n], i) => {
    const y = BAG.y + 44 + i * BAG.rowHeight;
    ctx.fillStyle = COLORS.row;
    roundRect(ctx, BAG.x + 10, y, BAG.width - 20, BAG.rowHeight - 6, 6);
    drawPiece(ctx, { id }, { x: BAG.x + 14, y: y + 1, width: 32, height: 32 });
    text(ctx, `${FURNITURE[id].name} ×${n}`, BAG.x + 56, y + 17, { size: 13, weight: 700 });
  });
}

/** The Store's cards, one per pack, centred in the panel. */
function storeCards() {
  const { card } = STORE;
  const total = MATERIAL_PACKS.length * card.width + (MATERIAL_PACKS.length - 1) * card.gap;
  const x0 = STORE.x + (STORE.width - total) / 2;
  return MATERIAL_PACKS.map((_, i) => ({
    x: x0 + i * (card.width + card.gap),
    y: card.y,
    width: card.width,
    height: card.height,
  }));
}

/** The resource store, drawn like Wave Survival's coin store. */
function drawStore(ctx, donations, progress, pointer) {
  ctx.fillStyle = "rgba(18, 24, 48, 0.97)";
  roundRect(ctx, STORE.x, STORE.y, STORE.width, STORE.height, 12);
  ctx.strokeStyle = "#ffd34e";
  ctx.lineWidth = 3;
  ctx.stroke();
  text(ctx, "RESOURCE STORE", STORE.x + 20, STORE.y + 36, {
    size: 24,
    weight: 800,
    color: "#ffd34e",
  });
  text(
    ctx,
    "Spend chat's donations on materials. They stay with you.",
    STORE.x + 20,
    STORE.y + 62,
    {
      size: 13,
      color: "#b9c4e8",
    },
  );
  text(ctx, `Donations: $${donations}`, STORE.x + STORE.width - 20, STORE.y + 36, {
    size: 18,
    weight: 800,
    align: "right",
    color: "#7ee08a",
  });
  text(ctx, "Esc or the button to close", STORE.x + STORE.width - 20, STORE.y + 62, {
    size: 12,
    align: "right",
    color: "#b9c4e8",
  });

  storeCards().forEach((card, i) => {
    const pack = MATERIAL_PACKS[i];
    const { name } = MATERIALS[pack.material];
    const affordable = donations >= pack.dollars;
    const hover = affordable && pointer && inside(card, pointer.x, pointer.y);
    const y = card.y + (hover ? -4 : 0);
    const gradient = ctx.createLinearGradient(0, y, 0, y + card.height);
    gradient.addColorStop(0, affordable ? "#3d5fb8" : "#2a3350");
    gradient.addColorStop(1, affordable ? "#1f2f66" : "#1a2036");
    ctx.fillStyle = gradient;
    roundRect(ctx, card.x, y, card.width, card.height, 10);
    ctx.strokeStyle = hover ? "#ffd34e" : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // A little pile of the material.
    const cx = card.x + card.width / 2;
    if (pack.material === "darkMatter") {
      text(ctx, MATERIALS.darkMatter.icon, cx, y + 62, { size: 42, align: "center" });
    } else {
      for (const [dx, dy] of [
        [-18, 10],
        [18, 10],
        [0, 10],
        [-9, -4],
        [9, -4],
        [0, -18],
      ]) {
        drawMaterial(ctx, pack.material, cx + dx, y + 62 + dy);
      }
    }
    text(ctx, `${pack.amount}`, cx, y + 112, {
      size: 26,
      weight: 800,
      align: "center",
      color: "#ffd34e",
    });
    text(ctx, name, cx, y + 134, { size: 13, align: "center", color: "#dfe6ff" });
    text(ctx, `you have ${progress.materials[pack.material]}`, cx, y + 152, {
      size: 11,
      align: "center",
      color: "#9aa6cc",
    });
    ctx.fillStyle = affordable ? "#2e9e4f" : "#3a4157";
    roundRect(ctx, card.x + 20, y + card.height - 38, card.width - 40, 28, 6);
    text(ctx, `$${pack.dollars}`, cx, y + card.height - 24, {
      size: 15,
      weight: 800,
      align: "center",
      color: affordable ? "#fff" : "#8a93ad",
    });
  });
}

function drawContext(ctx, c) {
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, c.x, c.y, CONTEXT.width, CONTEXT.rows.length * CONTEXT.rowHeight, 6);
  CONTEXT.rows.forEach((label, i) => {
    text(ctx, label, c.x + 12, c.y + i * CONTEXT.rowHeight + CONTEXT.rowHeight / 2, {
      size: 13,
      weight: 700,
    });
  });
}

function drawMenu(ctx, s, list) {
  const height = 90 + list.length * MENU.rowHeight;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, MENU.x, MENU.y, MENU.width, height, 10);
  const { title, icon } = MENUS[s.menu.target];
  text(ctx, `${icon}  ${title}`, MENU.x + 20, MENU.y + 32, { size: 20, weight: 800 });
  text(ctx, "E or Esc to close", MENU.x + MENU.width - 20, MENU.y + 32, {
    size: 12,
    align: "right",
    color: COLORS.muted,
  });
  list.forEach((row, i) => {
    const y = MENU.y + 70 + i * MENU.rowHeight;
    ctx.fillStyle = i === s.menu.index ? COLORS.rowActive : COLORS.row;
    roundRect(ctx, MENU.x + 14, y, MENU.width - 28, MENU.rowHeight - 8, 6);
    text(ctx, `${i + 1}  ${row.label}`, MENU.x + 26, y + 15, { size: 13, weight: 700 });
    text(ctx, row.detail, MENU.x + 26, y + 32, {
      size: 12,
      color: row.ok ? COLORS.ok : COLORS.no,
    });
  });
}

function drawNotice(ctx, world, value) {
  ctx.font = "700 15px system-ui, sans-serif";
  const width = ctx.measureText(value).width + 32;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  roundRect(ctx, world.width / 2 - width / 2, world.height - 70, width, 34, 8);
  text(ctx, value, world.width / 2, world.height - 53, { size: 15, weight: 700, align: "center" });
}

/** The hub card: a little house on the grass, and a ghost. */
function drawThumbnail(ctx, { x, y, width, height }, clock) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = COLORS.grass[0];
  ctx.fillRect(x, y, width, height);
  const home = {
    x: x + width * 0.22,
    y: y + height * 0.12,
    width: width * 0.56,
    height: height * 0.7,
  };
  drawHome(ctx, home);
  drawGhost(ctx, { x: x + width * 0.86, y: y + height * 0.3 + Math.sin(clock / 400) * 4 }, clock);
  ctx.restore();
}
