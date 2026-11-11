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
 *
 * Benchmark bot (W09): `?bot=<skill 0-1>` plays Wave Survival by itself (the bot from
 * shooter/bot.js, through the game's normal input path) and types a player message every
 * 25 s; `&seed=` picks its seed and `&minutes=` stops it after that much play and logs
 * `witc.benchmark()`. It never pauses on blur. For measuring the pipeline, not the study.
 */

import { createGameLoop } from "./loop.js";
import { createInput } from "./input.js";
import { stats } from "./stats.js";
import { donationFor } from "./donations.js";
import { createStreamer } from "./streamer.js";
import { createEffects } from "./effects.js";
import { createSound } from "./sound.js";
import { createExpressionTracker } from "./expression.js";
import { startCamera, drawCamera } from "./camera.js";
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
import { createBot, createBotInput, BOT_CHAT } from "./shooter/bot.js";
import { HUD_HEIGHT } from "./shooter/view.js";
import { seededRandom } from "./random.js";

/** Logical scene size. The canvas is scaled to fit, keeping 16:9. */
const WORLD = { width: 960, height: 540 };
const FACECAM_MARGIN = 16;
/**
 * The facecam on the scene's corner. Not solid (the W10 pilot read a wall there as a
 * bug): the player can go under it, and it fades while anything is behind it.
 */
const FACECAM = {
  x: WORLD.width - 200 - FACECAM_MARGIN,
  y: WORLD.height - 150 - FACECAM_MARGIN,
  width: 200,
  height: 150,
};
const FACECAM_FADED = 0.3;

/** Whether the player or an enemy is under the facecam (it's in the bottom-right corner). */
function behindFacecam(state) {
  const things = [state?.player, ...(state?.enemies ?? [])];
  return things.some((t) => t && t.x + t.r > FACECAM.x && t.y + t.r > FACECAM.y);
}

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
const overlay = createChatOverlay(document.getElementById("chat"), { onSend: sendChat });

/** A message from the player (typed, or the benchmark bot's). */
function sendChat(text) {
  const result = bus.publish(createChatEvent(text));
  if (result.ok) overlay.pushPlayer(result.event);
  else console.warn("Chat message rejected:", result.errors);
}

const params = new URLSearchParams(location.search);
const bot = params.has("bot")
  ? {
      skill: Math.min(1, Math.max(0, Number(params.get("bot")) || 0.6)),
      seed: Number(params.get("seed")) || 1,
      stopAfterMs: (Number(params.get("minutes")) || Infinity) * 60_000,
      chatEveryMs: 25_000,
      playedMs: 0,
      chatAt: 12_500,
      chats: 0,
      done: false,
      input: null,
    }
  : null;

// Stats: a pure reducer over the bus, so chat replies can never change them.
let streamStats = stats.initial();
const hud = createStatsHud(document.getElementById("stats"), streamStats);
const streamer = createStreamer();
const effects = createEffects();
const sound = createSound();
bus.subscribe("*", (event) => {
  streamStats = stats.reduce(streamStats, event);
  hud.set(streamStats);
  streamer.react(event);
  effects.react(event);
  if (event.kind === "game") sound.play(event.name);
  // The same donation the stats just added (same event, same hype), shown in chat.
  const gift = donationFor(event, streamStats.hype);
  if (gift) {
    overlay.pushDonation({ id: `donation-${event.id}`, ts: event.ts, ...gift });
    effects.donation(gift);
    sound.play("donation");
  }
});

// Chat service: every event goes out, chat_message updates come back.
const latency = createReplyLatency();
const statusEl = document.getElementById("service-status");
const serviceUrl = params.get("service") ?? DEFAULT_SERVICE_URL;
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
  el.textContent = `${bot ? "BOT · " : ""}reply p50 ${completion.p50} ms · p95 ${completion.p95} ms (n=${completion.n})`;
}

// For the demo and the bug bash: witc.latency() / witc.rows() / witc.stats() in the console.
window.witc = {
  condition: () => condition,
  latency: () => latency.summary(),
  rows: () => latency.rows(),
  stats: () => streamStats,
  game: () => hub.current?.instance.state ?? null,
  /** The camera's live expression and blendshape scores, for tuning EXPRESSION_RULES. */
  camera: () => ({ on: Boolean(camera), expression: tracker.current, scores: cameraScores }),
  /** The benchmark bot's run so far (null without `?bot=`). */
  benchmark: () =>
    bot && {
      skill: bot.skill,
      seed: bot.seed,
      playedMs: Math.round(bot.playedMs),
      done: bot.done,
      chats: bot.chats,
      wave: hub.current?.instance.state.wave ?? 0,
      bestWave: hub.current?.instance.state.bestWave ?? 0,
      latency: latency.summary(),
    },
};
if (bot) document.title = `[BOT] ${document.title}`;

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

  if (bot && !bot.done && hub.screen === "hub" && chatReady) {
    hub.confirm({ canPlay: true }); // Wave Survival is the first game
  } else if (hub.screen === "hub") {
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
  } else if (bot && !bot.done) {
    playBot(dt);
  } else {
    const { game, instance } = hub.current;
    instance.update(dt, { input: gameInputs.get(game.id), mouse });
  }
  playShotSound();
  publishGameEvents();
  streamer.update(dt);
  effects.update(dt);

  // Every keymap sees every key; presses not used this step are dropped, so a key that
  // opened a screen doesn't also act in it.
  menuInput.endFrame();
  for (const input of gameInputs.values()) input.endFrame();
}

// Firing isn't a catalog event (chat doesn't need it), so the sound reads the shot count.
let lastShots = 0;
function playShotSound() {
  const shots = hub.current?.instance.state?.player?.shots ?? 0;
  if (shots > lastShots) sound.play("shot");
  lastShots = shots; // drops back to 0 on a new run
}

/** One step of the benchmark bot: it plays, chats on a timer, and stops when time's up. */
function playBot(dt) {
  const { instance } = hub.current;
  bot.input ??= createBotInput(
    createBot({
      arena: { x: 0, y: HUD_HEIGHT, width: WORLD.width, height: WORLD.height - HUD_HEIGHT },
      skill: bot.skill,
      random: seededRandom(bot.seed),
    }),
  );
  instance.update(dt, bot.input(instance.state, dt));
  bot.playedMs += dt;
  if (bot.playedMs >= bot.chatAt) {
    sendChat(BOT_CHAT[bot.chats++ % BOT_CHAT.length]);
    bot.chatAt += bot.chatEveryMs;
  }
  if (bot.playedMs >= bot.stopAfterMs) {
    bot.done = true;
    hub.pause();
    console.log("Benchmark done:", JSON.stringify(window.witc.benchmark()));
  }
}

function render(alpha) {
  const scale = canvas.width / WORLD.width;
  const shake = effects.shake();
  ctx.setTransform(scale, 0, 0, scale, shake.x * scale, shake.y * scale);

  if (hub.screen === "hub") {
    drawHub(ctx, hub, { world: WORLD, clock, hint: hubHint() });
  } else {
    const paused = hub.screen === "paused";
    hub.current.instance.render(ctx, {
      alpha: paused ? 1 : alpha,
      pointer: paused ? null : mouse.pointer,
      clock,
    });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    effects.draw(ctx, {
      world: WORLD,
      alertAt: FACECAM,
    });
    if (paused) drawPause(ctx, hub, { world: WORLD });
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const playing = hub.screen === "playing" ? hub.current.instance.state : null;
  if (behindFacecam(playing)) ctx.globalAlpha = FACECAM_FADED;
  // With the optional camera on, the facecam shows the player instead of the avatar.
  if (camera) drawCamera(ctx, camera.video, FACECAM, tracker.current);
  else streamer.draw(ctx, { ...FACECAM, hype: streamStats.hype });
  ctx.globalAlpha = 1;
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
  sound.unlock();
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
  if (!bot) hub.pause();
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

// Optional camera (W11): off until the player opts in. Only an expression word leaves
// the tab: it moves the facecam and, at most every 8 s, goes to chat as an event.
const cameraButton = document.getElementById("camera");
const tracker = createExpressionTracker();
let camera = null; // {stop} while on
let cameraStarting = false;
let cameraScores = null;
const CONSENT =
  "Turn on the camera?\n\n" +
  "You'll show in the facecam corner on this screen, and your face is read in this " +
  "browser tab to tell whether you're smiling, surprised or frowning. The video is never " +
  "saved or sent anywhere: only that one word goes to the chat.\n\n" +
  "Turn it off any time with the same button.";

function showCamera(text) {
  cameraButton.textContent = text;
  cameraButton.setAttribute("aria-pressed", String(Boolean(camera)));
}

function onScores(scores) {
  cameraScores = scores;
  const change = tracker.push(scores, performance.now());
  if (!change) return;
  showCamera(`camera on · ${change.expression}`);
  const event = createGameEvent("expression", { expression: change.expression });
  if (change.emit) bus.publish(event);
  else streamer.react(event); // the face still follows, without a chat line
}

cameraButton.addEventListener("click", async () => {
  cameraButton.blur(); // so Space goes back to the game
  if (cameraStarting) return;
  if (camera) {
    camera.stop();
    camera = null;
    cameraScores = null;
    showCamera("camera off");
    return;
  }
  if (!window.confirm(CONSENT)) return;
  cameraStarting = true;
  showCamera("camera starting…");
  try {
    camera = await startCamera(onScores, () => {
      camera = null;
      cameraScores = null;
      showCamera("camera lost · click to retry");
      console.warn("The camera disconnected (unplugged, or Iriun dropped).");
    });
    showCamera("camera on · neutral");
  } catch (err) {
    showCamera("camera off");
    console.warn("Camera failed:", err);
    window.alert(`The camera couldn't start: ${err.message}`);
  } finally {
    cameraStarting = false;
  }
});
showCamera("camera off");

// Sound: M or the top-bar button mutes (remembered in this browser).
const soundButton = document.getElementById("sound");
function showMute() {
  soundButton.textContent = sound.muted ? "sound off" : "sound on";
  soundButton.setAttribute("aria-pressed", String(!sound.muted));
}
soundButton.addEventListener("click", () => {
  sound.toggleMute();
  showMute();
  soundButton.blur(); // so Space goes back to the game
});
showMute();

// Enter jumps to the chat box; Escape gives the keyboard back to the game; F2 toggles
// the study panel; M mutes.
window.addEventListener("keydown", (event) => {
  sound.unlock();
  if (event.key === "F2") {
    event.preventDefault();
    study.toggle();
    return;
  }
  const typing = document.activeElement?.tagName === "INPUT";
  if (event.code === "KeyM" && !typing) {
    sound.toggleMute();
    showMute();
  } else if (event.key === "Enter" && !typing) {
    event.preventDefault();
    overlay.focusInput();
  } else if (event.key === "Escape" && typing) {
    document.activeElement.blur();
  }
});

createGameLoop({ update, render }).start();
