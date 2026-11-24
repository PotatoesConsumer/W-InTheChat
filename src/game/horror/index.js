/**
 * index.js
 *
 * The Dark House as a hub game module (interface in src/game/hub.js): its keymap, mouse
 * look (pointer lock after a click; dragging with the button held works without it), the
 * mouse sensitivity (a pause menu setting), the 3D view, and the 2D HUD drawn over it.
 */

import { createHorror, HORROR, HOUSES } from "./game.js";
import { loadThree, createHorrorView } from "./view3d.js";
import { HORROR_ITEMS, HOUSE_LEVELS } from "../progress.js";

const BINDINGS = Object.freeze({
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  Space: "action",
  ShiftLeft: "run",
  ShiftRight: "run",
  Digit1: "item",
  KeyQ: "item",
});

/** Mouse sensitivity 1-10, kept in this browser; radians per pixel = level x TURN_PER_LEVEL. */
export const SENSITIVITY = Object.freeze({ min: 1, max: 10, start: 5, turnPerLevel: 0.0005 });
const SENSITIVITY_KEY = "witc.mouseSensitivity";
let sensitivity = loadSensitivity();

function loadSensitivity() {
  try {
    const saved = Number(globalThis.localStorage?.getItem(SENSITIVITY_KEY));
    if (Number.isInteger(saved) && saved >= SENSITIVITY.min && saved <= SENSITIVITY.max) {
      return saved;
    }
  } catch {
    // Storage blocked: the default for this page.
  }
  return SENSITIVITY.start;
}

export const darkHouse = Object.freeze({
  id: "dark-house",
  title: "The Dark House",
  blurb: "3D horror. Find the keys by flashlight and get out before the monster finds you.",
  controls: Object.freeze([
    ["WASD", "move"],
    ["Shift", "run (stamina)"],
    ["1 / Q", "use your item"],
    ["Mouse / drag / ← →", "look around"],
    ["Click", "start, lock the mouse"],
    ["Esc", "free the mouse, pause"],
  ]),
  bindings: BINDINGS,
  drawThumbnail,

  /** Shown as a row of the pause menu (hub.js); ← → change it. */
  setting: Object.freeze({
    label: "Mouse sensitivity",
    value: () => sensitivity,
    change(delta) {
      sensitivity = Math.min(SENSITIVITY.max, Math.max(SENSITIVITY.min, sensitivity + delta));
      try {
        globalThis.localStorage?.setItem(SENSITIVITY_KEY, String(sensitivity));
      } catch {
        // Not saved; it lasts until the page reloads.
      }
    },
  }),

  /**
   * @param {object} opts
   * @param {{width: number, height: number}} opts.world
   * @param {() => number} [opts.random]
   * @param {object} [opts.perks] - From the Just Chatting base (main.js): `horror()` is
   *   null in the study, else {level, item}: the house level and the one item carried.
   * @param {{playAt: Function}} [opts.sound] - For the monster's footsteps.
   */
  create({ world, random, perks = {}, sound }) {
    const base = () => perks.horror?.() ?? null;
    const game = createHorror({ random, level: () => base()?.level ?? 1 });
    let three = null;
    const views = new Map(); // one per house level, built when first played
    let failed = null;
    let canvas = null;
    let look = 0;

    loadThree().then(
      (THREE) => (three = THREE),
      (err) => {
        failed = err;
        console.warn("The Dark House could not load Three.js:", err);
      },
    );

    const locked = () => canvas && document.pointerLockElement === canvas;
    // Locked, any movement turns; without the lock (refused, or freed with Esc), dragging
    // with the left button held does.
    document.addEventListener("pointermove", (event) => {
      if (locked() || (canvas && event.target === canvas && event.buttons & 1)) {
        look += event.movementX * sensitivity * SENSITIVITY.turnPerLevel;
      }
    });

    function viewFor(house) {
      if (!views.has(house.level))
        views.set(house.level, createHorrorView(three, world, house.rows));
      return views.get(house.level);
    }

    const start = () => game.start({ sonar: base()?.item === "sonar" });

    /** 1 or Q: the carried item (the sonar needs no key: it's always on). */
    function useItem(input) {
      if (!input.wasPressed("item")) return;
      const item = base()?.item;
      if (item === "energy") game.energy();
      else if (item === "gun") game.freeze();
    }

    // The monster's footsteps: louder when it's close, from its side; faster on a chase.
    let stepMs = 0;
    function footsteps(dt) {
      const s = game.state;
      const m = s.monster;
      if (!sound || m.frozenMs > 0 || s.elapsedMs < HORROR.graceMs) return;
      stepMs -= dt;
      if (stepMs > 0) return;
      stepMs = m.mode === "chase" ? 330 : 620;
      const dx = m.x - s.player.x;
      const dy = m.y - s.player.y;
      const volume = Math.max(0, 1 - Math.hypot(dx, dy) / 18) ** 2;
      const pan = Math.sin(Math.atan2(dy, dx) - s.player.angle);
      sound.playAt("monster_step", { volume, pan });
    }

    function lockMouse() {
      try {
        canvas?.requestPointerLock()?.catch?.(() => {});
      } catch {
        // Pointer lock refused (an iframe or an old browser): arrow keys still turn.
      }
    }

    return {
      get state() {
        return game.state;
      },

      update(dt, { input }) {
        const s = game.state;
        if (s.phase !== "playing") {
          look = 0;
          if (input.wasPressed("action") && three) start();
          return;
        }
        useItem(input);
        footsteps(dt);
        const axis = (minus, plus) => (input.isDown(plus) ? 1 : 0) - (input.isDown(minus) ? 1 : 0);
        const keyTurn = (axis("turnLeft", "turnRight") * HORROR.turnSpeed * dt) / 1000;
        game.update(dt, {
          forward: axis("back", "forward"),
          strafe: axis("left", "right"),
          turn: keyTurn + look,
          run: input.isDown("run"),
        });
        look = 0;
      },

      pointerDown() {
        if (!three) return;
        if (game.state.phase !== "playing") start();
        lockMouse();
      },

      back() {
        return false;
      },

      render(ctx, { clock }) {
        canvas = ctx.canvas;
        const { width, height } = world;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        if (!three) {
          drawCentre(
            ctx,
            world,
            failed ? "3D needs the internet the first time it loads." : "Loading 3D…",
          );
          return;
        }
        const s = game.state;
        ctx.drawImage(viewFor(s.house).render(s, clock), 0, 0, width, height);
        drawHud(ctx, world, s, { locked: locked(), ghost: perks.ghost?.() ?? false, base: base() });
      },

      takeEvents() {
        return game.takeEvents();
      },

      restart() {
        game.abandon();
        start();
      },

      quit() {
        if (locked()) document.exitPointerLock();
        game.abandon();
      },
    };
  },
});

function drawCentre(ctx, { width, height }, text, size = 22, color = "#ddd") {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}

function drawHud(ctx, world, s, { locked, ghost, base }) {
  const { width, height } = world;

  // The closer the monster, the redder the edges.
  const dist = Math.hypot(s.monster.x - s.player.x, s.monster.y - s.player.y);
  const fear = s.phase === "playing" ? Math.max(0, 1 - dist / (HORROR.nearRange * 1.5)) : 0;
  if (fear > 0) {
    const g = ctx.createRadialGradient(
      width / 2,
      height / 2,
      height * 0.3,
      width / 2,
      height / 2,
      width * 0.6,
    );
    g.addColorStop(0, "rgba(120,0,0,0)");
    g.addColorStop(1, `rgba(150,0,0,${0.65 * fear})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillStyle = s.door.open ? "#7ee08a" : "#e8d27a";
  const keys = `🔑 ${s.keysFound}/${s.keys.length}`;
  ctx.fillText(s.door.open ? `${keys}  The door is open!` : keys, 16, 14);

  if (s.phase === "playing") {
    drawStamina(ctx, s.player, s.house.stamina);
    drawItems(ctx, world, s, base);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(width / 2 - 1.5, height / 2 - 1.5, 3, 3);
    if (!locked)
      drawCentre(
        ctx,
        { width, height: height * 0.6 },
        "Click to look around (or hold the button and drag)",
        16,
        "#aaa",
      );
    return;
  }

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, width, height);
  const lines = {
    ready: [
      `THE DARK HOUSE${base ? ` · LEVEL ${base.level}` : ""}`,
      `Find ${HOUSES[(base?.level ?? 1) - 1].keys} keys, then get out through the door.`,
    ],
    escaped: ["YOU ESCAPED!", `${s.keysFound} keys in ${Math.round(s.elapsedMs / 1000)} s`],
    caught: ["CAUGHT", `${s.keysFound} of ${s.keys.length} keys`],
  }[s.phase];
  const color = { ready: "#e8d27a", escaped: "#7ee08a", caught: "#ff4d4d" }[s.phase];
  drawCentre(ctx, { width, height: height - 70 }, lines[0], 40, color);
  drawCentre(ctx, { width, height: height + 10 }, lines[1], 18);
  drawCentre(ctx, { width, height: height + 70 }, "Click or press Space to play", 16, "#aaa");
  if (s.phase === "escaped" && base) {
    const reward = HOUSE_LEVELS[s.house.level - 1].reward;
    drawCentre(ctx, { width, height: height + 110 }, `+${reward} 🌑 dark matter`, 18, "#c9a7ff");
  }
  if (s.phase === "escaped" && ghost) {
    drawCentre(
      ctx,
      { width, height: height + 140 },
      "👻 Ghost Friend badge: a ghost now fights beside you in Wave Survival",
      16,
      "#9fe7ff",
    );
  }
}

/** The stamina bar, top left under the keys: red while too tired, blue on an energy boost. */
function drawStamina(ctx, p, max) {
  const width = 140;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(16, 40, width, 6);
  ctx.fillStyle =
    p.energyMs > 0 ? "#6fd3ff" : p.tired ? "#ff4d4d" : p.running ? "#ffd34e" : "#e8e8e8";
  ctx.fillRect(16, 40, (width * p.stamina) / max, 6);
}

/** Bottom left: the item you carry (1 or Q), what's active, and the sonar's radar. */
function drawItems(ctx, { height }, s, base) {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 13px system-ui, sans-serif";
  const status = [];
  if (s.player.energyMs > 0) status.push(`⚡ ${Math.ceil(s.player.energyMs / 1000)} s`);
  if (s.monster.frozenMs > 0)
    status.push(`❄ monster frozen ${Math.ceil(s.monster.frozenMs / 1000)} s`);
  ctx.fillStyle = "#9fe7ff";
  ctx.fillText(status.join("   "), 16, 54);
  // The sonar has no line: its radar shows it's on.
  const item = base?.item && base.item !== "sonar" && HORROR_ITEMS[base.item];
  if (item) {
    const ready =
      s.cooldownMs > 0 ? `ready in ${Math.ceil(s.cooldownMs / 1000)} s` : "1 / Q to use";
    ctx.fillStyle = s.cooldownMs > 0 ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.8)";
    ctx.fillText(`${item.name}: ${ready}`, 16, height - 26);
  }
  if (!s.sonar) return;
  // Sonar: a disc whose dot is the nearest key, relative to where you face (up = ahead).
  const key = s.keys
    .filter((k) => !k.taken)
    .sort(
      (a, b) =>
        Math.hypot(a.x - s.player.x, a.y - s.player.y) -
        Math.hypot(b.x - s.player.x, b.y - s.player.y),
    )[0];
  const cx = 70;
  const cy = height - 90;
  ctx.strokeStyle = "rgba(111,211,255,0.8)";
  ctx.fillStyle = "rgba(0,40,60,0.6)";
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const target = key ?? (s.door.open ? s.door : null);
  if (!target) return;
  const dx = target.x - s.player.x;
  const dy = target.y - s.player.y;
  const turn = Math.atan2(dy, dx) - s.player.angle;
  const r = Math.min(40, Math.hypot(dx, dy) * 3);
  ctx.fillStyle = key ? "#ffd34e" : "#7ee08a";
  ctx.beginPath();
  ctx.arc(cx + Math.sin(turn) * r, cy - Math.cos(turn) * r, 5, 0, Math.PI * 2);
  ctx.fill();
}

/** The hub card: darkness, a flashlight cone, two eyes that blink. */
function drawThumbnail(ctx, { x, y, width, height }, clock) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = "#050505";
  ctx.fillRect(x, y, width, height);
  const cx = x + width * 0.3;
  const cy = y + height;
  const beam = ctx.createRadialGradient(cx, cy, 4, cx, cy, height * 1.1);
  beam.addColorStop(0, "rgba(255,240,200,0.55)");
  beam.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x + width * 0.55, y);
  ctx.lineTo(x + width * 0.95, y + height * 0.2);
  ctx.closePath();
  ctx.fill();
  if (Math.floor(clock / 1800) % 4 !== 3) {
    ctx.fillStyle = "#ff2a1a";
    for (const dx of [-7, 7]) {
      ctx.beginPath();
      ctx.arc(x + width * 0.72 + dx, y + height * 0.42, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
