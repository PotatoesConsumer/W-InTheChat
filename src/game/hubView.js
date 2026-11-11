/**
 * hubView.js
 *
 * Draws the game hub (hub.js) and the pause menu on the canvas, and says what a click
 * hits. Everything stays left of and above the facecam in the bottom-right corner.
 */

import { PAUSE_OPTIONS, isPlayable } from "./hub.js";

const FONT = "Inter, 'Segoe UI Variable Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** The stream page's colours (src/ui/overlay.css). */
const UI = Object.freeze({
  bg: "#0e0e10",
  panel: "#18181b",
  raised: "#2f2f35",
  text: "#efeff1",
  muted: "#adadb8",
  faint: "#6f6f78",
  accent: "#9147ff",
});
const CARD = { width: 260, height: 250, gap: 24, x: 60, y: 120 };
const PAUSE = { x: 260, y: 100, width: 420, height: 360 };

/**
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 * @param {number} count - Games in the hub.
 * @returns {Rect[]} one card per game
 */
export function hubLayout(count) {
  return Array.from({ length: count }, (_, i) => ({
    x: CARD.x + i * (CARD.width + CARD.gap),
    y: CARD.y,
    width: CARD.width,
    height: CARD.height,
  }));
}

/** @returns {Rect[]} one button per PAUSE_OPTIONS entry */
export function pauseLayout() {
  return PAUSE_OPTIONS.map((_, i) => ({
    x: PAUSE.x + 40,
    y: PAUSE.y + 84 + i * 56,
    width: PAUSE.width - 80,
    height: 44,
  }));
}

/** The offline screen's Go live button. */
export function offlineLayout(world) {
  return { x: world.width / 2 - 70, y: world.height / 2 + 74, width: 140, height: 40 };
}

/** Whether (x, y) is on the offline screen's Go live button. */
export function offlineHit(world, x, y) {
  return inside(offlineLayout(world), x, y);
}

/**
 * The stream while it's offline, like a channel page's offline banner: the avatar, the
 * last stream if there was one, and a Go live button.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{world: {width: number, height: number}, name: string, letter: string,
 *   color: string, last: string | null}} opts - `last` sums up the last stream.
 */
export function drawOffline(ctx, { world, name, letter, color, last }) {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, world.width, world.height);
  const cx = world.width / 2;
  const cy = world.height / 2 - 60;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, letter, cx, cy + 14, { size: 38, weight: 800, align: "center", color: "#fff" });

  ctx.fillStyle = UI.raised;
  roundRect(ctx, cx - 38, cy + 34, 76, 20, 4);
  ctx.fill();
  text(ctx, "OFFLINE", cx, cy + 49, { size: 12, weight: 700, align: "center", color: UI.muted });

  text(ctx, `${name} is offline.`, cx, cy + 96, {
    size: 22,
    weight: 700,
    align: "center",
    color: UI.text,
  });
  text(ctx, last ?? "Go live and chat will start watching.", cx, cy + 122, {
    size: 14,
    align: "center",
    color: UI.muted,
  });

  const button = offlineLayout(world);
  ctx.fillStyle = UI.accent;
  roundRect(ctx, button.x, button.y, button.width, button.height, 4);
  ctx.fill();
  text(ctx, "Go live", cx, button.y + 26, {
    size: 15,
    weight: 700,
    align: "center",
    color: "#fff",
  });
}

/** The index of the card or button at (x, y) on the current screen, or -1. */
export function hubHit(hub, x, y) {
  if (hub.screen === "hub") return hubLayout(hub.games.length).findIndex((r) => inside(r, x, y));
  if (hub.screen === "paused") return pauseLayout().findIndex((r) => inside(r, x, y));
  return -1;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./hub.js").createHub>} hub
 * @param {{world: {width: number, height: number}, clock: number, hint: string}} opts
 */
export function drawHub(ctx, hub, { world, clock, hint }) {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, world.width, world.height);

  text(ctx, "Choose what to stream", CARD.x, 70, { size: 28, weight: 700, color: UI.text });
  text(ctx, "Your chat reacts to everything you do in the game.", CARD.x, 98, {
    size: 14,
    color: UI.muted,
  });

  const cards = hubLayout(hub.games.length);
  hub.games.forEach((game, i) => {
    const r = cards[i];
    const active = i === hub.selected;
    const playable = isPlayable(game);
    // Box art, like a category tile: the selected one lifts and gets the accent edge.
    const lift = active ? 6 : 0;
    const pic = { x: r.x, y: r.y - lift, width: r.width, height: 160 };
    if (active) {
      ctx.fillStyle = UI.accent;
      ctx.fillRect(pic.x - lift, pic.y + lift, pic.width, pic.height);
    }
    if (playable && game.drawThumbnail) {
      game.drawThumbnail(ctx, pic, clock);
    } else {
      ctx.fillStyle = UI.panel;
      ctx.fillRect(pic.x, pic.y, pic.width, pic.height);
    }
    text(ctx, game.title, r.x, r.y + 188, {
      size: 16,
      weight: 700,
      color: playable ? UI.text : UI.faint,
    });
    wrapText(ctx, game.blurb, r.x, r.y + 208, r.width, 17, { size: 13, color: UI.muted });
  });

  const game = hub.games[hub.selected];
  if (isPlayable(game)) {
    const controls = game.controls.map(([keys, what]) => `${keys}: ${what}`).join("   ·   ");
    wrapText(ctx, controls, CARD.x, 410, 620, 18, { size: 13, color: UI.muted });
  }
  text(ctx, "Space or click to play   ·   Esc pauses a game", CARD.x, 470, {
    size: 13,
    color: UI.faint,
  });
  text(ctx, hint, CARD.x, 500, { size: 15, weight: 600, color: UI.text });
}

/**
 * The pause menu, over the paused game.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./hub.js").createHub>} hub
 * @param {{world: {width: number, height: number}}} opts
 */
export function drawPause(ctx, hub, { world }) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.fillStyle = UI.panel;
  roundRect(ctx, PAUSE.x, PAUSE.y, PAUSE.width, PAUSE.height, 6);
  ctx.fill();

  text(ctx, "Paused", PAUSE.x + PAUSE.width / 2, PAUSE.y + 52, {
    size: 26,
    weight: 700,
    align: "center",
    color: UI.text,
  });
  pauseLayout().forEach((r, i) => {
    const active = i === hub.pauseIndex;
    ctx.fillStyle = active ? UI.accent : UI.raised;
    roundRect(ctx, r.x, r.y, r.width, r.height, 4);
    ctx.fill();
    text(ctx, PAUSE_OPTIONS[i].label, r.x + r.width / 2, r.y + 28, {
      size: 16,
      weight: 600,
      align: "center",
      color: UI.text,
    });
  });
  const game = hub.current?.game;
  if (game) {
    text(ctx, game.title, PAUSE.x + PAUSE.width / 2, PAUSE.y + 290, {
      size: 13,
      weight: 600,
      align: "center",
      color: UI.muted,
    });
  }
  text(
    ctx,
    "↑ ↓ choose  ·  Space select  ·  Esc resume",
    PAUSE.x + PAUSE.width / 2,
    PAUSE.y + 330,
    {
      size: 13,
      align: "center",
      color: UI.faint,
    },
  );
}

function wrapText(ctx, value, x, y, maxWidth, lineHeight, style) {
  ctx.font = `${style.weight ?? 400} ${style.size}px ${FONT}`;
  let line = "";
  let row = 0;
  for (const word of value.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      text(ctx, line, x, y + row * lineHeight, style);
      line = word;
      row++;
    } else line = next;
  }
  if (line) text(ctx, line, x, y + row * lineHeight, style);
}

function text(ctx, value, x, y, { size = 14, weight = 400, align = "left", color = "#fff" } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.textAlign = "left";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function inside(r, x, y) {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}
