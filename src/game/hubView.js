/**
 * hubView.js
 *
 * Draws the game hub (hub.js) and the pause menu on the canvas, and says what a click
 * hits. Everything stays left of and above the facecam in the bottom-right corner.
 */

import { PAUSE_OPTIONS, isPlayable } from "./hub.js";

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
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
  const bg = ctx.createLinearGradient(0, 0, world.width, world.height);
  bg.addColorStop(0, "#1b1530");
  bg.addColorStop(1, "#0f1a2e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, world.width, world.height);
  // Slow drifting dots, so the hub doesn't look frozen on stream.
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  for (let i = 0; i < 24; i++) {
    const x = (i * 137 + clock / 40) % world.width;
    const y = (i * 89) % world.height;
    circle(ctx, x, y, 2 + (i % 3));
  }

  text(ctx, "GAME HUB", CARD.x, 64, { size: 34, weight: 800, color: "#ffd34e" });
  text(ctx, "Pick a game to stream", CARD.x, 92, { size: 15, color: "#b9b2d0" });

  const cards = hubLayout(hub.games.length);
  hub.games.forEach((game, i) => {
    const r = cards[i];
    const active = i === hub.selected;
    const playable = isPlayable(game);
    ctx.fillStyle = playable ? "#2a2342" : "#1e1a2c";
    roundRect(ctx, r.x, r.y, r.width, r.height, 12);
    ctx.fill();
    ctx.strokeStyle = active ? "#ffd34e" : "rgba(255,255,255,0.12)";
    ctx.lineWidth = active ? 4 : 2;
    ctx.stroke();

    const pic = { x: r.x + 12, y: r.y + 12, width: r.width - 24, height: 150 };
    if (playable && game.drawThumbnail) {
      game.drawThumbnail(ctx, pic, clock);
    } else {
      ctx.fillStyle = "#15121f";
      ctx.fillRect(pic.x, pic.y, pic.width, pic.height);
      text(ctx, "?", pic.x + pic.width / 2, pic.y + 100, {
        size: 64,
        weight: 800,
        align: "center",
        color: "#3a3352",
      });
    }
    text(ctx, game.title, r.x + 14, r.y + 190, {
      size: 18,
      weight: 800,
      color: playable ? "#ffffff" : "#77708c",
    });
    wrapText(ctx, game.blurb, r.x + 14, r.y + 212, r.width - 28, 17, {
      size: 12,
      color: "#b9b2d0",
    });
  });

  const game = hub.games[hub.selected];
  if (isPlayable(game)) {
    const controls = game.controls.map(([keys, what]) => `${keys}: ${what}`).join("   ·   ");
    wrapText(ctx, controls, CARD.x, 410, 620, 18, { size: 13, color: "#b9b2d0" });
  }
  text(ctx, "← → choose   ·   Space or click to play   ·   Esc pauses a game", CARD.x, 470, {
    size: 14,
    color: "#8a8599",
  });
  text(ctx, hint, CARD.x, 500, { size: 16, weight: 700, color: "#ffffff" });
}

/**
 * The pause menu, over the paused game.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./hub.js").createHub>} hub
 * @param {{world: {width: number, height: number}}} opts
 */
export function drawPause(ctx, hub, { world }) {
  ctx.fillStyle = "rgba(8, 6, 14, 0.7)";
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.fillStyle = "#211b33";
  roundRect(ctx, PAUSE.x, PAUSE.y, PAUSE.width, PAUSE.height, 14);
  ctx.fill();
  ctx.strokeStyle = "#ffd34e";
  ctx.lineWidth = 3;
  ctx.stroke();

  text(ctx, "PAUSED", PAUSE.x + PAUSE.width / 2, PAUSE.y + 50, {
    size: 30,
    weight: 800,
    align: "center",
    color: "#ffd34e",
  });
  pauseLayout().forEach((r, i) => {
    const active = i === hub.pauseIndex;
    ctx.fillStyle = active ? "#ffd34e" : "#342b4f";
    roundRect(ctx, r.x, r.y, r.width, r.height, 8);
    ctx.fill();
    text(ctx, PAUSE_OPTIONS[i].label, r.x + r.width / 2, r.y + 28, {
      size: 17,
      weight: 700,
      align: "center",
      color: active ? "#1b1530" : "#ffffff",
    });
  });
  const game = hub.current?.game;
  if (game) {
    text(ctx, game.title, PAUSE.x + PAUSE.width / 2, PAUSE.y + 290, {
      size: 13,
      weight: 700,
      align: "center",
      color: "#b9b2d0",
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
      color: "#8a8599",
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

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
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
