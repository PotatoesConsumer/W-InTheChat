/**
 * index.js
 *
 * The Dark House as a hub game module (interface in src/game/hub.js): its keymap, mouse
 * look (pointer lock after a click; dragging with the button held works without it), the
 * mouse sensitivity (a pause menu setting), the 3D view, and the 2D HUD drawn over it.
 */

import { createHorror, HORROR } from "./game.js";
import { loadThree, createHorrorView } from "./view3d.js";

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
   */
  create({ world, random, perks = {} }) {
    const game = createHorror({ random });
    let view = null;
    let failed = null;
    let canvas = null;
    let look = 0;

    loadThree().then(
      (THREE) => (view = createHorrorView(THREE, world)),
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
          if (input.wasPressed("action") && view) game.start();
          return;
        }
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
        if (!view) return;
        if (game.state.phase !== "playing") game.start();
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
        if (!view) {
          drawCentre(
            ctx,
            world,
            failed ? "3D needs the internet the first time it loads." : "Loading 3D…",
          );
          return;
        }
        const s = game.state;
        ctx.drawImage(view.render(s, clock), 0, 0, width, height);
        drawHud(ctx, world, s, { locked: locked(), ghost: perks.ghost?.() ?? false });
      },

      takeEvents() {
        return game.takeEvents();
      },

      restart() {
        game.abandon();
        game.start();
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

function drawHud(ctx, world, s, { locked, ghost }) {
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
    drawStamina(ctx, s.player);
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
    ready: ["THE DARK HOUSE", `Find ${HORROR.keys} keys, then get out through the door.`],
    escaped: ["YOU ESCAPED!", `${s.keysFound} keys in ${Math.round(s.elapsedMs / 1000)} s`],
    caught: ["CAUGHT", `${s.keysFound} of ${s.keys.length} keys`],
  }[s.phase];
  const color = { ready: "#e8d27a", escaped: "#7ee08a", caught: "#ff4d4d" }[s.phase];
  drawCentre(ctx, { width, height: height - 70 }, lines[0], 40, color);
  drawCentre(ctx, { width, height: height + 10 }, lines[1], 18);
  drawCentre(ctx, { width, height: height + 70 }, "Click or press Space to play", 16, "#aaa");
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

/** The stamina bar, top left under the keys; it blinks red while too tired to run. */
function drawStamina(ctx, p) {
  const width = 140;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(16, 40, width, 6);
  ctx.fillStyle = p.tired ? "#ff4d4d" : p.running ? "#ffd34e" : "#e8e8e8";
  ctx.fillRect(16, 40, (width * p.stamina) / HORROR.stamina, 6);
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
