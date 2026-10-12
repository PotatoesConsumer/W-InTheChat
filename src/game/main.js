/**
 * main.js
 *
 * Browser entry point (loaded by index.html). Wires the canvas, game loop, input,
 * event bus, stats, chat overlay and the chat service together.
 *
 * Every event goes on the local bus first: the stats, the HUD and the streamer's face
 * react to it here, and it is sent to the chat service (`npm run service`), whose
 * replies come back over SSE into the overlay. The service URL can be changed with
 * `?service=http://localhost:8787`.
 *
 * The scene is a placeholder until the mini-game is chosen: a box you move with
 * WASD/arrows, Space for a kill, and keys 1-5 for the major events (dev only).
 */

import { createGameLoop } from "./loop.js";
import { createInput, DEFAULT_BINDINGS } from "./input.js";
import { stats } from "./stats.js";
import { createStreamer } from "./streamer.js";
import { createReplyLatency } from "./replyLatency.js";
import { createEventBus } from "../events/bus.js";
import { createGameEvent, createChatEvent } from "../events/schema.js";
import { connectToService, DEFAULT_SERVICE_URL } from "../service/client.js";
import { createChatOverlay } from "../ui/chatOverlay.js";
import { createStatsHud } from "../ui/statsHud.js";

/** Logical scene size. The canvas is scaled to fit, keeping 16:9. */
const WORLD = { width: 960, height: 540 };
const PLAYER_SIZE = 40;
const PLAYER_SPEED = 320; // px per second
const FACECAM = { width: 200, height: 150, margin: 16 };

/** Dev keys for the major events, until the mini-game emits them itself. */
const DEV_EVENT_KEYS = Object.freeze({
  Digit1: "win",
  Digit2: "loss",
  Digit3: "close_call",
  Digit4: "streak",
  Digit5: "new_best",
});

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const bus = createEventBus({ onError: (err, event) => console.error(err, event) });
const overlay = createChatOverlay(document.getElementById("chat"), {
  onSend(text) {
    const result = bus.publish(createChatEvent(text));
    if (result.ok) overlay.pushPlayer(result.event);
    else console.warn("Chat message rejected:", result.errors);
  },
});

// Stats: a pure reducer over the bus, so chat replies can never change them.
let streamStats = stats.initial();
const hud = createStatsHud(document.getElementById("stats"), streamStats);
const streamer = createStreamer();
bus.subscribe("*", (event) => {
  streamStats = stats.reduce(streamStats, event);
  hud.set(streamStats);
  streamer.react(event);
});

// Chat service: every event goes out, chat_message updates come back.
const latency = createReplyLatency();
const statusEl = document.getElementById("service-status");
const serviceUrl = new URLSearchParams(location.search).get("service") ?? DEFAULT_SERVICE_URL;
const service = connectToService({
  url: serviceUrl,
  onMessage(message) {
    overlay.push(message);
    const row = latency.message(message);
    if (row) showLatency();
  },
  onStatus: showStatus,
});
bus.subscribe("*", async (event) => {
  latency.sent(event.id);
  const result = await service.send(event);
  if (!result.ok) {
    latency.dropped(event.id);
    console.warn("Chat service refused the event:", result.errors);
  }
});

let roundStarted = false;

function showStatus(status) {
  // Start the round once chat can see it, so its reply isn't sent to nobody.
  if (status === "connected" && !roundStarted) {
    roundStarted = true;
    bus.publish(createGameEvent("round_start"));
  }
  const text = { connected: "chat live", reconnecting: "chat offline", closed: "chat off" };
  statusEl.textContent = text[status] ?? status;
  statusEl.dataset.status = status;
  statusEl.title =
    status === "connected"
      ? `Connected to ${serviceUrl}`
      : `No chat service at ${serviceUrl}. Start it with: npm run service`;
}

function showLatency() {
  const { completion } = latency.summary().all;
  const el = document.getElementById("latency");
  el.textContent = `reply p50 ${completion.p50} ms · p95 ${completion.p95} ms (n=${completion.n})`;
}

// For the demo and the bug bash: witc.latency() / witc.rows() / witc.stats() in the console.
window.witc = {
  latency: () => latency.summary(),
  rows: () => latency.rows(),
  stats: () => streamStats,
};

const input = createInput(window, {
  ...DEFAULT_BINDINGS,
  ...Object.fromEntries(Object.keys(DEV_EVENT_KEYS).map((code) => [code, code])),
});

const player = {
  x: (WORLD.width - PLAYER_SIZE) / 2,
  y: (WORLD.height - PLAYER_SIZE) / 2,
  prevX: 0,
  prevY: 0,
};
let flash = 0; // ms left of the "action" highlight

function update(dt) {
  player.prevX = player.x;
  player.prevY = player.y;

  const dx = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
  const dy = (input.isDown("down") ? 1 : 0) - (input.isDown("up") ? 1 : 0);
  const len = Math.hypot(dx, dy) || 1; // diagonal isn't faster
  const dist = (PLAYER_SPEED * dt) / 1000;
  player.x = clamp(player.x + (dx / len) * dist, 0, WORLD.width - PLAYER_SIZE);
  player.y = clamp(player.y + (dy / len) * dist, 0, WORLD.height - PLAYER_SIZE);

  if (input.wasPressed("action")) {
    flash = 200;
    bus.publish(createGameEvent("kill"));
  }
  for (const [code, name] of Object.entries(DEV_EVENT_KEYS)) {
    if (input.wasPressed(code)) bus.publish(createGameEvent(name));
  }
  flash = Math.max(0, flash - dt);
  streamer.update(dt);

  input.endFrame();
}

function render(alpha) {
  const scale = canvas.width / WORLD.width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = "#14121c";
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.strokeStyle = "#221f2e";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD.width; x += 40) line(x, 0, x, WORLD.height);
  for (let y = 0; y <= WORLD.height; y += 40) line(0, y, WORLD.width, y);

  const x = lerp(player.prevX, player.x, alpha);
  const y = lerp(player.prevY, player.y, alpha);
  ctx.fillStyle = flash > 0 ? "#ffd166" : "#ff7a59";
  ctx.fillRect(x, y, PLAYER_SIZE, PLAYER_SIZE);

  ctx.fillStyle = "#8a8599";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText("Mini-game TBD · WASD / arrows to move · Space: kill", 16, 28);
  ctx.fillText("Test events: 1 win · 2 loss · 3 close call · 4 streak · 5 new best", 16, 50);

  streamer.draw(ctx, {
    x: WORLD.width - FACECAM.width - FACECAM.margin,
    y: WORLD.height - FACECAM.height - FACECAM.margin,
    width: FACECAM.width,
    height: FACECAM.height,
    hype: streamStats.hype,
  });
}

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, y1 + 0.5);
  ctx.lineTo(x2 + 0.5, y2 + 0.5);
  ctx.stroke();
}

/** Match the canvas's pixel size to its CSS size, so it stays sharp on HiDPI screens. */
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * dpr);
  canvas.width = width;
  canvas.height = Math.round((width * WORLD.height) / WORLD.width);
}

new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();

// Enter jumps to the chat box; Escape gives the keyboard back to the game.
window.addEventListener("keydown", (event) => {
  const typing = document.activeElement?.tagName === "INPUT";
  if (event.key === "Enter" && !typing) {
    event.preventDefault();
    overlay.focusInput();
  } else if (event.key === "Escape" && typing) {
    document.activeElement.blur();
  }
});

player.prevX = player.x;
player.prevY = player.y;
createGameLoop({ update, render }).start();

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
