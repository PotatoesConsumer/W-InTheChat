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
 * The baseline switch: `?condition=ai` or `?condition=scripted` sets the service's
 * condition before the round starts. F2 opens the study panel, which reloads the page
 * with the other condition. Without the parameter the service's own condition is used.
 *
 * The mini-game is a top-down wave shooter (src/game/shooter/): WASD to move, arrow keys
 * or the mouse to shoot, a shop between waves (1-6 or click to buy, C to cash out
 * donations into coins, Space for the next wave). It emits the catalog events itself.
 */

import { createGameLoop } from "./loop.js";
import { createInput } from "./input.js";
import { stats } from "./stats.js";
import { createStreamer } from "./streamer.js";
import { createReplyLatency } from "./replyLatency.js";
import { createShooter } from "./shooter/game.js";
import { drawShooter, shopHit, HUD_HEIGHT } from "./shooter/view.js";
import { SHOP_ITEMS } from "./shooter/shop.js";
import { createEventBus } from "../events/bus.js";
import { createGameEvent, createChatEvent } from "../events/schema.js";
import { connectToService, DEFAULT_SERVICE_URL } from "../service/client.js";
import { createChatOverlay } from "../ui/chatOverlay.js";
import { createStatsHud } from "../ui/statsHud.js";
import { createStudyPanel, conditionFromUrl } from "../ui/studyPanel.js";

/** Logical scene size. The canvas is scaled to fit, keeping 16:9. */
const WORLD = { width: 960, height: 540 };
const FACECAM = { width: 200, height: 150, margin: 16 };
const ARENA = { x: 0, y: HUD_HEIGHT, width: WORLD.width, height: WORLD.height - HUD_HEIGHT };
/** The facecam sits on the arena's corner, so it's solid: nothing walks under it. */
const FACECAM_BLOCK = {
  x: WORLD.width - FACECAM.width - FACECAM.margin,
  y: WORLD.height - FACECAM.height - FACECAM.margin,
  width: FACECAM.width + FACECAM.margin,
  height: FACECAM.height + FACECAM.margin,
};

const BINDINGS = Object.freeze({
  KeyW: "up",
  KeyA: "left",
  KeyS: "down",
  KeyD: "right",
  ArrowUp: "shootUp",
  ArrowLeft: "shootLeft",
  ArrowDown: "shootDown",
  ArrowRight: "shootRight",
  Space: "action",
  KeyC: "cashOut",
  ...Object.fromEntries(SHOP_ITEMS.map((_, i) => [`Digit${i + 1}`, `buy${i + 1}`])),
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

// Baseline switch (W07): the researcher picks the condition in the study panel (F2).
const wantedCondition = conditionFromUrl(location.search);
let condition = null;
const study = createStudyPanel(document.getElementById("study"), {
  onPick(next) {
    const url = new URL(location.href);
    url.searchParams.set("condition", next);
    location.assign(url);
  },
});

/**
 * Makes sure the service runs the condition in the URL (if any) and learns which one
 * it runs. On every (re)connect, since a restarted service is back on its default.
 * @returns {Promise<boolean>} false if the wanted condition couldn't be set
 */
async function syncCondition() {
  const result = wantedCondition
    ? await service.setCondition(wantedCondition)
    : await service.getCondition();
  condition = result.condition ?? null;
  study.setCondition(condition);
  if (result.ok) {
    study.setError(null);
    return true;
  }
  const why = result.error ?? result.errors?.[0]?.message ?? "unknown error";
  study.setError(`Couldn't switch to ${wantedCondition}: ${why}`);
  study.show();
  console.warn("Condition switch failed:", result);
  return false;
}

// The run can start once chat can see it in the right condition, so the first replies
// aren't sent to nobody or answered by the wrong condition. Without a service it can
// start anyway (no chat).
let chatReady = false;
let serviceStatus = "connecting";

async function showStatus(status) {
  serviceStatus = status;
  if (status === "connected") chatReady = await syncCondition();
  else chatReady = false;
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
  condition: () => condition,
  latency: () => latency.summary(),
  rows: () => latency.rows(),
  stats: () => streamStats,
  game: () => game.state,
};

// The mini-game. Its events go on the bus like any other: stats, facecam and chat react.
const game = createShooter({ arena: ARENA, obstacles: [FACECAM_BLOCK] });
const input = createInput(window, BINDINGS);
const mouse = { pointer: null, down: false };
let clock = 0;

function publishGameEvents() {
  for (const { name, data } of game.takeEvents()) bus.publish(createGameEvent(name, data));
}

const canStart = () => chatReady || serviceStatus === "reconnecting" || serviceStatus === "closed";

function startHint() {
  if (chatReady) return "Press Space to go live";
  if (serviceStatus === "connected" || serviceStatus === "connecting") return "Connecting to chat…";
  return "Chat is offline (npm run service). Space to play without it";
}

function shopAction(action) {
  if (action.kind === "item") game.buy(action.id);
  else if (action.kind === "cashOut") game.cashOut(streamStats.donations);
  else if (action.kind === "next") game.nextWave();
}

function update(dt) {
  clock += dt;
  const { phase, player } = game.state;

  if ((phase === "ready" || phase === "over") && input.wasPressed("action") && canStart()) {
    game.start();
  } else if (phase === "shop") {
    if (input.wasPressed("action")) shopAction({ kind: "next" });
    if (input.wasPressed("cashOut")) shopAction({ kind: "cashOut" });
    SHOP_ITEMS.forEach((item, i) => {
      if (input.wasPressed(`buy${i + 1}`)) shopAction({ kind: "item", id: item.id });
    });
  }

  // Arrow keys shoot in 8 directions; otherwise holding the mouse shoots at the cursor.
  const axis = (minus, plus) => (input.isDown(plus) ? 1 : 0) - (input.isDown(minus) ? 1 : 0);
  let aimX = axis("shootLeft", "shootRight");
  let aimY = axis("shootUp", "shootDown");
  let fire = aimX !== 0 || aimY !== 0;
  if (!fire && mouse.pointer) {
    aimX = mouse.pointer.x - player.x;
    aimY = mouse.pointer.y - player.y;
    fire = mouse.down;
  }
  game.update(dt, { moveX: axis("left", "right"), moveY: axis("up", "down"), aimX, aimY, fire });
  publishGameEvents();
  streamer.update(dt);

  input.endFrame();
}

function render(alpha) {
  const scale = canvas.width / WORLD.width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  drawShooter(ctx, game, {
    arena: ARENA,
    alpha,
    donations: streamStats.donations,
    pointer: mouse.pointer,
    startHint: startHint(),
    clock,
  });

  streamer.draw(ctx, {
    x: WORLD.width - FACECAM.width - FACECAM.margin,
    y: WORLD.height - FACECAM.height - FACECAM.margin,
    width: FACECAM.width,
    height: FACECAM.height,
    hype: streamStats.hype,
  });
}

/** Pointer position in world coordinates. */
function toWorld(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * WORLD.width) / rect.width,
    y: ((event.clientY - rect.top) * WORLD.height) / rect.height,
  };
}

canvas.addEventListener("pointermove", (event) => {
  mouse.pointer = toWorld(event);
});
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  // Clicking the game takes the keyboard back from the chat box.
  if (document.activeElement?.tagName === "INPUT") document.activeElement.blur();
  mouse.pointer = toWorld(event);
  mouse.down = true;
  canvas.setPointerCapture(event.pointerId);
  const { phase } = game.state;
  if (phase === "shop") {
    const hit = shopHit(mouse.pointer.x, mouse.pointer.y);
    if (hit) shopAction(hit);
    publishGameEvents();
  } else if ((phase === "ready" || phase === "over") && canStart()) {
    game.start();
    publishGameEvents();
  }
});
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, () => (mouse.down = false));
}
canvas.addEventListener("pointerleave", () => {
  if (!mouse.down) mouse.pointer = null;
});
window.addEventListener("blur", () => (mouse.down = false));

/** Match the canvas's pixel size to its CSS size, so it stays sharp on HiDPI screens. */
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * dpr);
  canvas.width = width;
  canvas.height = Math.round((width * WORLD.height) / WORLD.width);
}

new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();

// Enter jumps to the chat box; Escape gives the keyboard back to the game; F2 toggles
// the study panel.
window.addEventListener("keydown", (event) => {
  if (event.key === "F2") {
    event.preventDefault();
    study.toggle();
    return;
  }
  const typing = document.activeElement?.tagName === "INPUT";
  if (event.key === "Enter" && !typing) {
    event.preventDefault();
    overlay.focusInput();
  } else if (event.key === "Escape" && typing) {
    document.activeElement.blur();
  }
});

createGameLoop({ update, render }).start();
