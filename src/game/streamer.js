/**
 * streamer.js
 *
 * The streamer's facecam: a drawn avatar in the corner of the scene that reacts to
 * game events and to the streamer chatting. The mood logic is plain state (tested in
 * Node); draw() is the only part that touches the canvas.
 */

import { EXPRESSION_MOODS } from "./expression.js";

/** Mood per game event. Events not listed leave the current mood alone. */
export const EVENT_MOODS = Object.freeze({
  kill: "happy",
  item_pickup: "happy",
  coin_purchase: "happy",
  damage_taken: "shocked",
  win: "hyped",
  streak: "hyped",
  new_best: "hyped",
  close_call: "shocked",
  loss: "sad",
  key_found: "happy",
  monster_near: "shocked",
  escaped: "hyped",
  caught: "shocked",
});

/** How long a reaction lasts before the face relaxes back to neutral. */
export const MOOD_MS = Object.freeze({
  happy: 1200,
  hyped: 2500,
  shocked: 1500,
  sad: 3000,
  talking: 1200,
});

export function createStreamer() {
  let mood = "neutral";
  let left = 0;
  let clock = 0; // ms since start, for the idle bob and talking mouth

  return {
    /** @param {Readonly<object>} event - A valid bus event. */
    react(event) {
      const next =
        event.kind === "chat"
          ? "talking"
          : event.name === "expression"
            ? Object.hasOwn(EXPRESSION_MOODS, event.data?.expression ?? "") &&
              EXPRESSION_MOODS[event.data.expression]
            : EVENT_MOODS[event.name];
      if (!next) return;
      mood = next;
      left = MOOD_MS[next];
    },

    /** @param {number} dt - ms */
    update(dt) {
      clock += dt;
      left = Math.max(0, left - dt);
      if (left === 0) mood = "neutral";
    },

    get mood() {
      return mood;
    },

    /**
     * Draws the facecam with its top-left corner at (x, y).
     * @param {CanvasRenderingContext2D} ctx
     * @param {{x: number, y: number, width: number, height: number, hype: number}} frame
     */
    draw(ctx, { x, y, width, height, hype }) {
      drawFacecam(ctx, { x, y, width, height, hype, mood, clock });
    },
  };
}

const SKIN = "#f2c6a0";
const HAIR = "#2b2233";
const HEADSET = "#30303c";

function drawFacecam(ctx, { x, y, width, height, hype, mood, clock }) {
  ctx.save();

  // Frame: a dark room lit by the monitor, warmer as hype goes up.
  ctx.fillStyle = "#1d1a28";
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.clip();
  const glow = ctx.createRadialGradient(
    x + width / 2,
    y + height,
    10,
    x + width / 2,
    y + height,
    height * 1.2,
  );
  glow.addColorStop(0, hype >= 50 ? "rgba(255,122,89,0.35)" : "rgba(120,140,255,0.25)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, width, height);

  const cx = x + width / 2;
  const bob = mood === "hyped" ? Math.sin(clock / 70) * 4 : Math.sin(clock / 600) * 1.5;
  const headR = height * 0.26;
  const cy = y + height * 0.5 + bob;

  // Shoulders
  ctx.fillStyle = "#4b3f72";
  ctx.beginPath();
  ctx.ellipse(cx, y + height + 10, width * 0.36, height * 0.32, 0, Math.PI, 0);
  ctx.fill();

  // Head and hair
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(cx, cy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(cx, cy - headR * 0.15, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();

  // Headset: band over the head, cups at the ears, mic towards the mouth
  ctx.strokeStyle = HEADSET;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, headR * 1.12, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.fillStyle = HEADSET;
  for (const side of [-1, 1]) {
    roundRect(ctx, cx + side * headR * 1.05 - 6, cy - 10, 12, 22, 4);
    ctx.fill();
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 1.05, cy + 8);
  ctx.quadraticCurveTo(cx - headR * 0.9, cy + headR * 0.85, cx - headR * 0.35, cy + headR * 0.7);
  ctx.stroke();

  drawFace(ctx, { cx, cy, r: headR, mood, clock });

  ctx.restore();
  // A thin frame, like a webcam overlay on a real stream.
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, width, height, 8);
  ctx.stroke();
  ctx.restore();
}

function drawFace(ctx, { cx, cy, r, mood, clock }) {
  const eyeY = cy - r * 0.1;
  const eyeDx = r * 0.38;
  ctx.fillStyle = "#1b1b1b";
  ctx.strokeStyle = "#1b1b1b";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDx;
    ctx.beginPath();
    if (mood === "hyped") {
      // ^ ^
      ctx.moveTo(ex - 5, eyeY + 2);
      ctx.lineTo(ex, eyeY - 4);
      ctx.lineTo(ex + 5, eyeY + 2);
      ctx.stroke();
    } else if (mood === "shocked") {
      ctx.arc(ex, eyeY, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood === "sad") {
      ctx.moveTo(ex - 5, eyeY - side * 2);
      ctx.lineTo(ex + 5, eyeY + side * 2);
      ctx.stroke();
    } else {
      ctx.arc(ex, eyeY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const my = cy + r * 0.42;
  ctx.beginPath();
  if (mood === "hyped" || mood === "happy") {
    ctx.arc(cx, my - 4, r * (mood === "hyped" ? 0.32 : 0.24), 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else if (mood === "shocked") {
    ctx.ellipse(cx, my, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood === "sad") {
    ctx.arc(cx, my + 8, r * 0.22, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
  } else if (mood === "talking") {
    const open = 2 + Math.abs(Math.sin(clock / 90)) * 5;
    ctx.ellipse(cx, my, 7, open, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(cx - 7, my);
    ctx.lineTo(cx + 7, my);
    ctx.stroke();
  }
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
