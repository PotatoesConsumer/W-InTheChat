/**
 * home.js
 *
 * The home page (index.html): draws the featured stream's live preview and the category
 * box art with the game's own thumbnail, and says whether the chat service is up.
 * Nothing here talks to the model or sends events; the stream page (stream.html) does.
 */

import { drawThumbnail } from "../game/shooter/view.js";
import { DEFAULT_SERVICE_URL } from "../service/client.js";

/** The thumbnail's own size: drawThumbnail places its scene around the centre. */
const SCENE = { width: 320, height: 180 };
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sizes a canvas's backing store to its CSS box and returns its 2D context, scaled. */
function fit(canvas, sceneWidth) {
  const ratio = devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  const scale = (width / sceneWidth) * ratio;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, width: sceneWidth, height: (height / width) * sceneWidth };
}

// The featured stream: the game's thumbnail, moving, scaled to the preview.
const preview = document.getElementById("preview");
let view = fit(preview, SCENE.width);
new ResizeObserver(() => {
  view = fit(preview, SCENE.width);
  if (still) frame(900);
}).observe(preview);

function frame(clock) {
  drawThumbnail(view.ctx, { x: 0, y: 0, width: view.width, height: view.height }, clock);
  if (!still) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The category's box art: a still frame with the title, like a game's cover.
const tile = document.getElementById("tile-art");
function drawTile() {
  const art = fit(tile, 188);
  const { ctx, width, height } = art;
  drawThumbnail(ctx, { x: 0, y: 0, width, height }, 900);
  const shade = ctx.createLinearGradient(0, height * 0.55, 0, height);
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.75)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.font = "800 24px Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  ctx.fillText("WAVE", 14, height - 44);
  ctx.fillText("SURVIVAL", 14, height - 18);
}
drawTile();

// Is the chat up? The stream page works without it, but its chat stays empty.
const status = document.getElementById("service-status");
fetch(`${DEFAULT_SERVICE_URL}/health`)
  .then((res) => res.ok)
  .catch(() => false)
  .then((up) => {
    status.dataset.status = up ? "connected" : "closed";
    status.textContent = up ? "chat live" : "chat offline";
    status.title = up ? "The chat service is running" : "Start it with: npm run service";
  });
