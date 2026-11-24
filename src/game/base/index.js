/**
 * index.js
 *
 * Just Chatting as a hub game module (interface in src/game/hub.js): walk the room with
 * WASD, E at a station opens its menu (menus.js), and what's bought is saved in progress
 * (src/game/progress.js). Furniture goes where you stand. Buying materials spends the
 * stream's donations through a `material_purchase` event, like the coin store.
 */

import { createBase, STATIONS, BASE } from "./game.js";
import { baseRows } from "./menus.js";
import { CLOTHES, FURNITURE, MATERIALS, HOUSE_LEVELS } from "../progress.js";
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
  Space: "action",
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Digit${n}`, `row${n}`])),
});

const COLORS = Object.freeze({
  floor: ["#5b4636", "#634c3a"],
  wall: "#2c2230",
  station: "#3a2f45",
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

export const justChatting = Object.freeze({
  id: "just-chatting",
  title: "Just Chatting",
  blurb: "Your base. Spend wood, rock and dark matter on furniture, clothes and upgrades.",
  controls: Object.freeze([
    ["WASD", "walk"],
    ["E", "use a station / close"],
    ["1-6 / Space / click", "choose in a menu"],
  ]),
  bindings: BINDINGS,
  drawThumbnail,

  /**
   * @param {object} opts
   * @param {{width: number, height: number}} opts.world
   * @param {{donations: () => number}} opts.stream
   * @param {object} [opts.perks] - main.js: `progress` (the store; in the study one that
   *   remembers nothing) and `ghost()` (the badge).
   */
  create({ world, stream, perks = {} }) {
    const room = { x: 0, y: BASE.top, width: world.width, height: world.height - BASE.top };
    const base = createBase(room);
    const progress = perks.progress;
    let events = [];
    let notice = null;
    // Dollars spent on materials whose events haven't reached the stats yet (as the coin store).
    let unsettled = 0;

    const donations = () => stream.donations() - unsettled;
    const rows = () =>
      base.state.menu
        ? baseRows(base.state.menu.station.id, {
            progress: progress.get(),
            ghost: perks.ghost?.() ?? false,
            donations: donations(),
          })
        : [];

    function say(text) {
      notice = { text, ms: 2200 };
    }

    function choose(row) {
      if (!row?.action) return;
      if (!row.ok) return say(row.detail);
      const { action } = row;
      if (action.kind === "wear") {
        const { name, slot } = CLOTHES[action.id];
        const on = progress.toggleWear(action.id).clothes.worn[slot] === action.id;
        return say(on ? `Wearing the ${name.toLowerCase()}` : `Took off the ${name.toLowerCase()}`);
      }
      if (action.kind === "materials") {
        const { pack } = action;
        if (donations() < pack.dollars) return say("Not enough donations");
        unsettled += pack.dollars;
        progress.add({ [pack.material]: pack.amount });
        events.push({
          name: "material_purchase",
          data: { material: pack.material, amount: pack.amount, dollars: pack.dollars },
        });
        return say(`+${pack.amount} ${MATERIALS[pack.material].icon}`);
      }
      const p = base.state.player;
      const result = progress.buy(action, { x: Math.round(p.x), y: Math.round(p.y + 30) });
      if (!result.ok) return say(result.reason);
      const item = itemName(action);
      events.push({ name: "crafted", data: { item } });
      say(`Done: ${item}`);
    }

    return {
      get state() {
        return base.state;
      },

      update(dt, { input }) {
        if (notice && (notice.ms -= dt) <= 0) notice = null;
        const s = base.state;
        if (input.wasPressed("use")) {
          if (s.menu) base.close();
          else if (!base.open()) say("Walk up to a station to use it");
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
        base.update(dt, { moveX: axis("left", "right"), moveY: axis("up", "down") });
      },

      pointerDown(point) {
        const s = base.state;
        if (!s.menu) {
          const station = STATIONS.find((st) => Math.hypot(st.x - point.x, st.y - point.y) < 40);
          if (station && base.near() === station) base.open();
          return;
        }
        const list = rows();
        const index = Math.floor((point.y - (MENU.y + 70)) / MENU.rowHeight);
        const insideX = point.x > MENU.x && point.x < MENU.x + MENU.width;
        if (insideX && index >= 0 && index < list.length) {
          base.point(index, list.length);
          choose(list[index]);
        } else base.close();
      },

      /** Escape closes a menu before the hub pauses. */
      back() {
        return base.close();
      },

      render(ctx, { alpha, clock }) {
        drawRoom(ctx, world, base, progress.get(), {
          alpha,
          clock,
          ghost: perks.ghost?.() ?? false,
        });
        drawHud(ctx, world, progress.get(), donations());
        if (base.state.menu) drawMenu(ctx, base.state, rows());
        if (notice) drawNotice(ctx, world, notice.text);
      },

      takeEvents() {
        unsettled = 0;
        const out = events;
        events = [];
        return out;
      },

      restart() {
        base.close();
      },

      quit() {
        base.close();
      },

      /** Chat knows when you're in a menu, like the shooter's shop. */
      chatScene() {
        return base.state.menu ? "shop" : undefined;
      },
    };
  },
});

function itemName({ kind, id }) {
  if (kind === "furniture") return FURNITURE[id].name;
  if (kind === "clothes") return CLOTHES[id].name;
  if (kind === "ghost") return "a stronger ghost";
  if (kind === "house") return "a scarier Haunted House";
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

function drawRoom(ctx, world, base, progress, { alpha, clock, ghost }) {
  const s = base.state;
  // Floorboards and a back wall.
  for (let y = BASE.top; y < world.height; y += 30) {
    ctx.fillStyle = COLORS.floor[((y / 30) % 2) | 0];
    ctx.fillRect(0, y, world.width, 30);
  }
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, BASE.top, world.width, 36);

  for (const f of progress.furniture) drawFurniture(ctx, f);
  const near = base.near();
  for (const st of STATIONS) drawStation(ctx, st, progress, st === near && !s.menu, clock);

  const p = s.player;
  drawPlayer(ctx, { ...p, invulnerableMs: 0 }, alpha, clock, {
    hat: progress.clothes.worn.hat,
    shirt: progress.clothes.worn.shirt,
  });
  if (ghost) {
    const t = clock / 900;
    drawGhost(ctx, { x: p.x + Math.cos(t) * 40, y: p.y - 20 + Math.sin(t) * 12 }, clock);
  }
}

function drawFurniture(ctx, { id, x, y }) {
  ctx.fillStyle = "#8b5a33";
  if (id === "table") {
    ctx.fillRect(x - 26, y - 14, 52, 28);
    ctx.fillStyle = "#a8703f";
    ctx.fillRect(x - 24, y - 12, 48, 18);
  } else {
    ctx.fillRect(x - 12, y - 18, 24, 8); // back
    ctx.fillRect(x - 12, y - 10, 24, 18); // seat
    ctx.fillStyle = "#a8703f";
    ctx.fillRect(x - 10, y - 8, 20, 12);
  }
}

const STATION_ICONS = Object.freeze({
  workbench: "🔨",
  wardrobe: "👕",
  shrine: "👻",
  haunted: "🏚️",
  training: "🎯",
  trader: "💰",
});

function drawStation(ctx, st, progress, highlighted, clock) {
  ctx.fillStyle = highlighted ? "#5a3f7a" : COLORS.station;
  ctx.beginPath();
  ctx.roundRect(st.x - 34, st.y - 30, 68, 60, 10);
  ctx.fill();
  if (highlighted) {
    ctx.strokeStyle = "#c9a7ff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  text(ctx, STATION_ICONS[st.id], st.x, st.y - 4, { size: 26, align: "center" });
  const label = st.id === "haunted" ? `${st.name} Lv ${progress.house}` : st.name;
  text(ctx, label, st.x, st.y + 42, { size: 12, weight: 700, align: "center" });
  if (highlighted) {
    const bob = Math.sin(clock / 200) * 2;
    text(ctx, "E", st.x, st.y - 44 + bob, {
      size: 14,
      weight: 800,
      align: "center",
      color: "#ffd34e",
    });
  }
}

function drawHud(ctx, world, progress, donations) {
  ctx.fillStyle = "rgba(16, 12, 20, 0.9)";
  ctx.fillRect(0, 0, world.width, BASE.top);
  let x = 16;
  for (const [id, m] of Object.entries(MATERIALS)) {
    if (id !== "darkMatter") drawMaterial(ctx, id, x + 8, 20);
    else text(ctx, m.icon, x, 20, { size: 16 });
    text(ctx, `${progress.materials[id]}`, x + 22, 20, { size: 15, weight: 700 });
    x += 74;
  }
  text(ctx, `$${donations} donations`, x + 10, 20, { size: 14, weight: 700, color: "#ffd34e" });
  const reward = HOUSE_LEVELS[progress.house - 1].reward;
  text(ctx, `Haunted House Lv ${progress.house} · escape pays ${reward} 🌑`, world.width - 16, 20, {
    size: 13,
    align: "right",
    color: COLORS.muted,
  });
}

function drawMenu(ctx, s, list) {
  const height = 90 + list.length * MENU.rowHeight;
  ctx.fillStyle = COLORS.panel;
  ctx.beginPath();
  ctx.roundRect(MENU.x, MENU.y, MENU.width, height, 10);
  ctx.fill();
  const st = s.menu.station;
  text(ctx, `${STATION_ICONS[st.id]}  ${st.name}`, MENU.x + 20, MENU.y + 32, {
    size: 20,
    weight: 800,
  });
  text(ctx, "E or Esc to close", MENU.x + MENU.width - 20, MENU.y + 32, {
    size: 12,
    align: "right",
    color: COLORS.muted,
  });
  list.forEach((row, i) => {
    const y = MENU.y + 70 + i * MENU.rowHeight;
    ctx.fillStyle = i === s.menu.index ? COLORS.rowActive : COLORS.row;
    ctx.beginPath();
    ctx.roundRect(MENU.x + 14, y, MENU.width - 28, MENU.rowHeight - 8, 6);
    ctx.fill();
    const key = row.action ? `${i + 1}  ` : "";
    text(ctx, `${key}${row.label}`, MENU.x + 26, y + 15, { size: 13, weight: 700 });
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
  ctx.beginPath();
  ctx.roundRect(world.width / 2 - width / 2, world.height - 70, width, 34, 8);
  ctx.fill();
  text(ctx, value, world.width / 2, world.height - 53, { size: 15, weight: 700, align: "center" });
}

/** The hub card: a cosy room with a table, a chair and a ghost. */
function drawThumbnail(ctx, { x, y, width, height }, clock) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  for (let row = 0; row * 16 < height; row++) {
    ctx.fillStyle = COLORS.floor[row % 2];
    ctx.fillRect(x, y + row * 16, width, 16);
  }
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(x, y, width, 22);
  drawFurniture(ctx, { id: "table", x: x + width * 0.35, y: y + height * 0.55 });
  drawFurniture(ctx, { id: "chair", x: x + width * 0.35, y: y + height * 0.55 + 34 });
  drawGhost(ctx, { x: x + width * 0.72, y: y + height * 0.45 + Math.sin(clock / 400) * 4 }, clock);
  ctx.restore();
}
