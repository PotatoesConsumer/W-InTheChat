/**
 * main.js
 *
 * Browser entry point (loaded by index.html). Wires the canvas, game loop, input,
 * event bus and chat overlay together.
 *
 * The scene is a placeholder until the mini-game is chosen: a box you move with
 * WASD/arrows, and Space emits a game event so the input -> event -> chat path exists.
 */

import { createGameLoop } from "./loop.js";
import { createInput } from "./input.js";
import { startDevChatFeed } from "./devChatFeed.js";
import { createEventBus } from "../events/bus.js";
import { createGameEvent, createChatEvent } from "../events/schema.js";
import { createChatOverlay } from "../ui/chatOverlay.js";

/** Logical scene size. The canvas is scaled to fit, keeping 16:9. */
const WORLD = { width: 960, height: 540 };
const PLAYER_SIZE = 40;
const PLAYER_SPEED = 320; // px per second

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const bus = createEventBus({ onError: (err, event) => console.error(err, event) });
const overlay = createChatOverlay(document.getElementById("chat"), {
  onSend(text) {
    const result = bus.publish(createChatEvent(text));
    if (!result.ok) console.warn("Chat message rejected:", result.errors);
  },
});
startDevChatFeed(bus, (message) => overlay.push(message));

const input = createInput(window);

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
  flash = Math.max(0, flash - dt);

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
  ctx.fillText("Mini-game TBD · WASD / arrows to move · Space for a test event", 16, 28);
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
