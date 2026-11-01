/**
 * shooterBot.js
 *
 * A bot that plays the wave shooter (src/game/shooter/game.js) headless and records the
 * catalog events it sends, as a harness scenario. The laptop pilot (W08,
 * scripts/pilot.js) plays that trace into the real pipeline with the real model, so the
 * limits are set from the events the real game sends, not from hand-made scenarios.
 *
 * Same seed and options, same trace: the game and the bot both draw from seeded randoms.
 * The bot aims at the nearest enemy (off by up to `aimErrorRad` at skill 0), backs away
 * from enemies that get close, spends some time in the shop between waves, restarts
 * after a death, and types a player message every `chatEveryMs`.
 */

import { createShooter, seededRandom } from "../game/shooter/game.js";

const WORLD = { width: 960, height: 540 }; // src/game/main.js
const HUD_HEIGHT = 40;
const STEP_MS = 1000 / 60;
const SHOP_ORDER = ["medkit", "rapid", "power", "heart", "boots", "spread"];

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

/**
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.skill] - 0 (sloppy aim, barely dodges) to 1 (sharp).
 * @param {number} [opts.durationMs] - Game time to play.
 * @param {number} [opts.shopMs] - Time spent in the shop between waves.
 * @param {number} [opts.restartMs] - Time on the game-over screen before a new run.
 * @param {number} [opts.chatEveryMs] - A player message this often (0 for none).
 * @returns {{name: string, description: string, steps: object[], summary: object}}
 */
export function playShooter({
  seed = 1,
  skill = 0.6,
  durationMs = 180_000,
  shopMs = 6_000,
  restartMs = 4_000,
  chatEveryMs = 25_000,
} = {}) {
  const arena = { x: 0, y: HUD_HEIGHT, width: WORLD.width, height: WORLD.height - HUD_HEIGHT };
  const game = createShooter({ arena, random: seededRandom(seed) });
  const bot = seededRandom(seed ^ 0x5bd1e995);
  const aimErrorRad = (1 - skill) * 0.6;
  const dodgeRadius = 60 + skill * 120;

  const steps = [];
  const record = (at, step) => steps.push({ at: Math.round(at), ...step });
  let waitMs = 0;
  let nextChatAt = chatEveryMs > 0 ? chatEveryMs / 2 : Infinity;
  let chatIndex = 0;

  game.start();
  for (let t = 0; t < durationMs; t += STEP_MS) {
    const s = game.state;
    if (s.phase === "wave") {
      game.update(STEP_MS, controls(s));
    } else if (s.phase === "shop" || s.phase === "over") {
      waitMs += STEP_MS;
      if (s.phase === "shop" && waitMs >= shopMs) {
        shop(s);
        game.nextWave();
        waitMs = 0;
      } else if (s.phase === "over" && waitMs >= restartMs) {
        game.start();
        waitMs = 0;
      }
    }
    for (const { name, data } of game.takeEvents()) record(t, { game: name, data });
    if (t >= nextChatAt) {
      record(t, { chat: BOT_CHAT[chatIndex++ % BOT_CHAT.length] });
      nextChatAt += chatEveryMs;
    }
  }

  function controls(s) {
    const p = s.player;
    let nearest = null;
    let nearestD = Infinity;
    for (const e of s.enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < nearestD) [nearest, nearestD] = [e, d];
    }
    if (!nearest) return { moveX: (arena.x + arena.width / 2 - p.x) / 100, moveY: 0 };
    const angle = Math.atan2(nearest.y - p.y, nearest.x - p.x) + (bot() * 2 - 1) * aimErrorRad;
    // Back away from close enemies, drifting toward the middle so the walls don't trap it.
    let moveX = 0;
    let moveY = 0;
    if (nearestD < dodgeRadius) {
      moveX = p.x - nearest.x + (arena.x + arena.width / 2 - p.x) * 0.3;
      moveY = p.y - nearest.y + (arena.y + arena.height / 2 - p.y) * 0.3;
    }
    return { moveX, moveY, aimX: Math.cos(angle), aimY: Math.sin(angle), fire: true };
  }

  function shop(s) {
    for (const id of SHOP_ORDER) {
      if (id === "medkit" && s.player.hp >= s.player.maxHp) continue;
      if (game.buy(id).ok) break;
    }
  }

  const counts = {};
  for (const step of steps) {
    const key = step.game ?? "chat";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return {
    name: `shooter-bot-seed${seed}-skill${Math.round(skill * 100)}`,
    description: `The wave shooter played headless by a bot (seed ${seed}, skill ${skill}) for ${Math.round(durationMs / 1000)} s, with a player message every ${Math.round(chatEveryMs / 1000)} s.`,
    steps,
    summary: { durationMs, events: steps.length, counts, bestWave: game.state.bestWave },
  };
}
