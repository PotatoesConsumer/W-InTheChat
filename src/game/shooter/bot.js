/**
 * bot.js
 *
 * A bot that plays the wave shooter, for measuring the chat pipeline without a person at
 * the keyboard: headless in the laptop pilot (src/harness/shooterBot.js) and in the
 * browser with `?bot=<skill>` for the W09 benchmark (main.js). Not for the study.
 *
 * It aims at the nearest enemy (off by up to 0.6 rad at skill 0), backs away from
 * enemies that get close, and buys the first affordable item in SHOP_ORDER between waves.
 */

import { SHOP_ITEMS, checkPurchase } from "./shop.js";

/** Player messages, from the evaluation set's chat steps (eval/event-set-v1.json). */
export const BOT_CHAT = Object.freeze([
  "hey chat, we're live! let's get this first win",
  "which way do I go, left path or the bridge?",
  "I was ONE hit from dying there",
  "thank you chat, you guys carried me",
  "is this level always this hard?",
  "ok chat, who jinxed that? be honest",
  "five in a row, I'm actually locked in",
  "backseaters, now's your chance, what am I doing wrong",
  "my cat just walked across the keyboard lol",
  "lol",
]);

const SHOP_ORDER = ["medkit", "rapid", "power", "heart", "boots", "spread"];

/**
 * @param {object} opts
 * @param {{x: number, y: number, width: number, height: number}} opts.arena
 * @param {number} [opts.skill] - 0 (sloppy aim, barely dodges) to 1 (sharp).
 * @param {() => number} opts.random - Seeded, so a seed gives the same bot.
 */
export function createBot({ arena, skill = 0.6, random }) {
  const aimErrorRad = (1 - skill) * 0.6;
  const dodgeRadius = 60 + skill * 120;
  const middle = { x: arena.x + arena.width / 2, y: arena.y + arena.height / 2 };

  return {
    /** Controls for one step of a wave: {moveX, moveY, aimX, aimY, fire}. */
    controls(state) {
      const p = state.player;
      let nearest = null;
      let nearestD = Infinity;
      for (const e of state.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < nearestD) [nearest, nearestD] = [e, d];
      }
      if (!nearest) return { moveX: (middle.x - p.x) / 100, moveY: 0 };
      const angle = Math.atan2(nearest.y - p.y, nearest.x - p.x) + (random() * 2 - 1) * aimErrorRad;
      // Back away from close enemies, drifting toward the middle so the walls don't trap it.
      let moveX = 0;
      let moveY = 0;
      if (nearestD < dodgeRadius) {
        moveX = p.x - nearest.x + (middle.x - p.x) * 0.3;
        moveY = p.y - nearest.y + (middle.y - p.y) * 0.3;
      }
      return { moveX, moveY, aimX: Math.cos(angle), aimY: Math.sin(angle), fire: true };
    },

    /** The shop item to buy now, or null. */
    shopPick(state) {
      const { player } = state;
      for (const id of SHOP_ORDER) {
        if (id === "medkit" && player.hp >= player.maxHp) continue;
        if (checkPurchase({ ...state.run, hp: player.hp, maxHp: player.maxHp }, id).ok) return id;
      }
      return null;
    },
  };
}

/**
 * Drives the shooter through its normal input path (shooter/index.js) instead of the
 * keyboard and mouse: one {input, mouse} per step. Waits `shopMs` in the shop, buys one
 * item, and waits `restartMs` on the game-over screen, like a person would.
 * @param {ReturnType<typeof createBot>} bot
 * @param {{shopMs?: number, restartMs?: number}} [opts]
 */
export function createBotInput(bot, { shopMs = 6_000, restartMs = 4_000 } = {}) {
  let waitMs = 0;
  let phase = null;
  let shopped = false;
  return function step(state, dt) {
    const pressed = new Set();
    const held = new Set();
    const mouse = { pointer: null, down: false };
    if (state.phase !== phase) [phase, waitMs, shopped] = [state.phase, 0, false];
    waitMs += dt;

    if (state.phase === "wave") {
      const c = bot.controls(state);
      if (c.moveX > 0) held.add("right");
      if (c.moveX < 0) held.add("left");
      if (c.moveY > 0) held.add("down");
      if (c.moveY < 0) held.add("up");
      if (c.fire) {
        mouse.pointer = { x: state.player.x + c.aimX * 100, y: state.player.y + c.aimY * 100 };
        mouse.down = true;
      }
    } else if (state.phase === "shop" && waitMs >= shopMs) {
      // One item per visit, then the next wave.
      const id = shopped ? null : bot.shopPick(state);
      shopped = true;
      if (id) pressed.add(`key${SHOP_ITEMS.findIndex((item) => item.id === id) + 1}`);
      else pressed.add("action");
    } else if ((state.phase === "ready" || state.phase === "over") && waitMs >= restartMs) {
      pressed.add("action");
    }

    return {
      input: {
        wasPressed: (action) => pressed.has(action),
        isDown: (action) => held.has(action),
        endFrame() {},
      },
      mouse,
    };
  };
}
