import { test } from "node:test";
import assert from "node:assert/strict";
import { playShooter, BOT_CHAT } from "../../src/harness/shooterBot.js";
import { parseScenario } from "../../src/harness/scenario.js";
import { GAME_EVENTS } from "../../src/events/schema.js";

const short = { durationMs: 60_000 };

test("the trace is a valid scenario of catalog events and player messages, in time order", () => {
  const trace = playShooter(short);
  const scenario = parseScenario({ name: trace.name, steps: trace.steps });
  assert.equal(scenario.steps.length, trace.steps.length);
  for (const step of trace.steps) {
    if ("game" in step) assert.ok(Object.hasOwn(GAME_EVENTS, step.game), step.game);
    else assert.ok(BOT_CHAT.includes(step.chat));
  }
  const times = trace.steps.map((s) => s.at);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );
  assert.ok(times.at(-1) < short.durationMs);
});

test("the bot actually plays: waves start, enemies die, a wave gets cleared", () => {
  const { counts } = playShooter(short).summary;
  assert.ok(counts.round_start >= 2);
  assert.ok(counts.kill >= 10);
  assert.ok(counts.win + (counts.close_call ?? 0) + (counts.new_best ?? 0) >= 1);
  assert.ok(counts.chat >= 2);
});

test("same seed and options, same trace; another seed, another game", () => {
  assert.deepEqual(playShooter(short).steps, playShooter(short).steps);
  assert.notDeepEqual(playShooter(short).steps, playShooter({ ...short, seed: 2 }).steps);
});

test("chatEveryMs 0 means no player messages", () => {
  assert.ok(playShooter({ ...short, chatEveryMs: 0 }).steps.every((s) => "game" in s));
});
