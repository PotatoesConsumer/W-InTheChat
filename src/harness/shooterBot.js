/**
 * shooterBot.js
 *
 * Plays the wave shooter (src/game/shooter/game.js) headless with the bot from
 * src/game/shooter/bot.js and records the catalog events it sends, as a harness
 * scenario. The laptop pilot (W08, scripts/pilot.js) plays that trace into the real
 * pipeline with the real model, so the limits are set from the events the real game
 * sends, not from hand-made scenarios. The W09 benchmark runs the same bot in the
 * browser instead (`?bot=<skill>`).
 *
 * Same seed and options, same trace: the game and the bot both draw from seeded randoms.
 * The bot spends some time in the shop between waves, restarts after a death, and types
 * a player message every `chatEveryMs`.
 */

import { createShooter, seededRandom } from "../game/shooter/game.js";
import { createBot, BOT_CHAT } from "../game/shooter/bot.js";

export { BOT_CHAT };

const WORLD = { width: 960, height: 540 }; // src/game/main.js
const HUD_HEIGHT = 40;
const STEP_MS = 1000 / 60;

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
  const bot = createBot({ arena, skill, random: seededRandom(seed ^ 0x5bd1e995) });

  const steps = [];
  const record = (at, step) => steps.push({ at: Math.round(at), ...step });
  let waitMs = 0;
  let nextChatAt = chatEveryMs > 0 ? chatEveryMs / 2 : Infinity;
  let chatIndex = 0;

  game.start();
  for (let t = 0; t < durationMs; t += STEP_MS) {
    const s = game.state;
    if (s.phase === "wave") {
      game.update(STEP_MS, bot.controls(s));
    } else if (s.phase === "shop" || s.phase === "over") {
      waitMs += STEP_MS;
      if (s.phase === "shop" && waitMs >= shopMs) {
        const id = bot.shopPick(s);
        if (id) game.buy(id);
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
