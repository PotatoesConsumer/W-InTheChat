/**
 * main.js
 *
 * Browser entry point (loaded by index.html). Wires the canvas, game loop, input,
 * event bus, stats, chat overlay, the chat service and the game hub together.
 *
 * Every event goes on the local bus first: the stats, the HUD and the streamer's face
 * react to it here, and it is sent to the chat service (`npm run service`), whose
 * replies come back over SSE into the overlay. The service URL can be changed with
 * `?service=http://localhost:8787`.
 *
 * The baseline switch: `?condition=ai` or `?condition=scripted` sets the service's
 * condition before a game starts. F2 opens the study panel, which reloads the page
 * with the other condition. Without the parameter the service's own condition is used.
 *
 * The stream opens on the game hub (hub.js, games list in games.js). Each game reads its
 * own keymap and sends catalog events; Escape or P pauses it (pause menu: resume,
 * restart, quit to the hub), and so does leaving the window.
 */

import { createGameLoop } from "./loop.js";
import { createInput } from "./input.js";
import { stats } from "./stats.js";
import { createStreamer } from "./streamer.js";
import { createReplyLatency } from "./replyLatency.js";
import { createHub } from "./hub.js";
import { drawHub, drawPause, hubHit } from "./hubView.js";
import { GAMES } from "./games.js";
import { createEventBus } from "../events/bus.js";
import { createGameEvent, createChatEvent } from "../events/schema.js";
import { connectToService, DEFAULT_SERVICE_URL } from "../service/client.js";
import { createChatOverlay } from "../ui/chatOverlay.js";
import { createStatsHud } from "../ui/statsHud.js";
import { createStudyPanel, conditionFromUrl } from "../ui/studyPanel.js";

/** Logical scene size. The canvas is scaled to fit, keeping 16:9. */
const WORLD = { width: 960, height: 540 };
const FACECAM = { width: 200, height: 150, margin: 16 };
/** The facecam sits on the scene's corner, so games treat it as solid. */
const FACECAM_BLOCK = {
  x: WORLD.width - FACECAM.width - FACECAM.margin,
  y: WORLD.height - FACECAM.height - FACECAM.margin,
  width: FACECAM.width + FACECAM.margin,
  height: FACECAM.height + FACECAM.margin,
};

/** Keys for the hub and the pause menu. Each game has its own keymap. */
const MENU_BINDINGS = Object.freeze({
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "select",
  Escape: "back",
  KeyP: "pause",
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

// A game can start once chat can see it in the right condition, so the first replies
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
  game: () => hub.current?.instance.state ?? null,
};

// The hub and its games. A game's events go on the bus like any other: stats, facecam
// and chat react.
const menuInput = createInput(window, MENU_BINDINGS);
const gameInputs = new Map();
const mouse = { pointer: null, down: false };
let clock = 0;

const hub = createHub({
  games: GAMES,
  makeGame(game) {
    gameInputs.set(game.id, createInput(window, game.bindings));
    return game.create({
      world: WORLD,
      obstacles: [FACECAM_BLOCK],
      stream: { donations: () => streamStats.donations },
    });
  },
});

function publishGameEvents() {
  const instance = hub.current?.instance;
  if (!instance) return;
  for (const { name, data } of instance.takeEvents()) bus.publish(createGameEvent(name, data));
}

const canPlay = () => chatReady || serviceStatus === "reconnecting" || serviceStatus === "closed";

function hubHint() {
  if (chatReady) return "Chat is live. Pick a game and go!";
  if (serviceStatus === "connected" || serviceStatus === "connecting") return "Connecting to chat…";
  return "Chat is offline (npm run service). You can still play without it.";
}

function update(dt) {
  clock += dt;
  const pressed = (action) => menuInput.wasPressed(action);
  const step =
    (pressed("right") || pressed("down") ? 1 : 0) - (pressed("left") || pressed("up") ? 1 : 0);

  if (hub.screen === "hub") {
    if (step) hub.move(step);
    if (pressed("select")) hub.confirm({ canPlay: canPlay() });
  } else if (hub.screen === "paused") {
    if (step) hub.move(step);
    if (pressed("select")) hub.confirm({ canPlay: true });
    else if (pressed("back") || pressed("pause")) hub.resume();
  } else if (pressed("back")) {
    hub.back();
  } else if (pressed("pause")) {
    hub.pause();
  } else {
    const { game, instance } = hub.current;
    instance.update(dt, { input: gameInputs.get(game.id), mouse });
  }
  publishGameEvents();
  streamer.update(dt);

  // Every keymap sees every key; presses not used this step are dropped, so a key that
  // opened a screen doesn't also act in it.
  menuInput.endFrame();
  for (const input of gameInputs.values()) input.endFrame();
}

function render(alpha) {
  const scale = canvas.width / WORLD.width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  if (hub.screen === "hub") {
    drawHub(ctx, hub, { world: WORLD, clock, hint: hubHint() });
  } else {
    const paused = hub.screen === "paused";
    hub.current.instance.render(ctx, {
      alpha: paused ? 1 : alpha,
      pointer: paused ? null : mouse.pointer,
      clock,
    });
    if (paused) drawPause(ctx, hub, { world: WORLD });
  }

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
  const index = hubHit(hub, mouse.pointer.x, mouse.pointer.y);
  if (index >= 0) hub.point(index);
});
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  // Clicking the game takes the keyboard back from the chat box.
  if (document.activeElement?.tagName === "INPUT") document.activeElement.blur();
  mouse.pointer = toWorld(event);
  canvas.setPointerCapture(event.pointerId);
  if (hub.screen === "playing") {
    mouse.down = true;
    hub.current.instance.pointerDown(mouse.pointer);
  } else {
    const index = hubHit(hub, mouse.pointer.x, mouse.pointer.y);
    if (index >= 0) {
      hub.point(index);
      hub.confirm({ canPlay: canPlay() });
    }
  }
  publishGameEvents();
});
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, () => (mouse.down = false));
}
canvas.addEventListener("pointerleave", () => {
  if (!mouse.down) mouse.pointer = null;
});
// Leaving the window pauses the game, so nothing happens while nobody is looking.
window.addEventListener("blur", () => {
  mouse.down = false;
  hub.pause();
});

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
