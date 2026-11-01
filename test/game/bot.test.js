import { test } from "node:test";
import assert from "node:assert/strict";
import { createBot, createBotInput } from "../../src/game/shooter/bot.js";
import { waveSurvival } from "../../src/game/shooter/index.js";
import { seededRandom } from "../../src/game/random.js";
import { HUD_HEIGHT } from "../../src/game/shooter/view.js";

const WORLD = { width: 960, height: 540 };
const ARENA = { x: 0, y: HUD_HEIGHT, width: WORLD.width, height: WORLD.height - HUD_HEIGHT };
const STEP = 1000 / 60;

/** The real hub game module, driven by the bot through its normal input path. */
function botGame({ seed = 1, skill = 0.6, ...opts } = {}) {
  const game = waveSurvival.create({
    world: WORLD,
    random: seededRandom(seed + 1000),
    stream: { donations: () => 0 },
  });
  const step = createBotInput(createBot({ arena: ARENA, skill, random: seededRandom(seed) }), opts);
  const events = [];
  const play = (ms) => {
    for (let t = 0; t < ms; t += STEP) {
      game.update(STEP, step(game.state, STEP));
      events.push(...game.takeEvents().map((e) => e.name));
    }
  };
  return { game, events, play };
}

test("through the game's input path, the bot starts, kills, clears a wave and shops", () => {
  const { events, play } = botGame({ shopMs: 1_000, restartMs: 500 });
  play(90_000);
  assert.ok(events.includes("round_start"));
  assert.ok(events.filter((e) => e === "kill").length >= 10);
  assert.ok(events.some((e) => ["win", "close_call", "new_best"].includes(e)));
  assert.ok(events.includes("item_pickup"), "bought something in the shop");
  assert.ok(events.filter((e) => e === "round_start").length >= 2, "went on to another wave");
});

test("it waits restartMs before starting and shopMs in the shop", () => {
  const { game, play } = botGame({ restartMs: 2_000 });
  play(1_900);
  assert.equal(game.state.phase, "ready");
  play(200);
  assert.equal(game.state.phase, "wave");
});

test("one item per shop visit", () => {
  const bot = createBot({ arena: ARENA, random: seededRandom(1) });
  const step = createBotInput(bot, { shopMs: 0 });
  const shop = {
    phase: "shop",
    player: { hp: 1, maxHp: 5 },
    run: { coins: 10_000, levels: {}, kills: 0, streakKills: 0, cleared: 1 },
  };
  const first = step(shop, STEP).input;
  assert.ok(first.wasPressed("key1"), "medkit first when hurt");
  const second = step(shop, STEP).input;
  assert.ok(second.wasPressed("action"), "then the next wave");
});

test("same seed, same game", () => {
  const a = botGame();
  const b = botGame();
  a.play(30_000);
  b.play(30_000);
  assert.deepEqual(a.events, b.events);
});
