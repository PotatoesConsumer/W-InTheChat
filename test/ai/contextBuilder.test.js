import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { toContext } from "../../src/events/context.js";
import { buildPrompt, CONTEXT_LIMITS } from "../../src/ai/contextBuilder.js";
import { FAN_SYSTEM_PROMPT, buildFanPrompt } from "../../src/ai/personas/fan.js";

const FIXED = { id: "evt-secret-id", ts: 1_700_000_000_000 };

test("game event -> same prompt as buildFanPrompt when there are no details or history", () => {
  const ctx = toContext(createGameEvent("close_call", {}, FIXED));
  const built = buildPrompt(ctx);
  assert.equal(built.persona, "fan");
  assert.equal(built.system, FAN_SYSTEM_PROMPT);
  assert.equal(built.prompt, buildFanPrompt({ event: ctx.facts.event }));
  assert.ok(Object.isFrozen(built));
});

test("game details are listed in plain words", () => {
  const ctx = toContext(
    createGameEvent("win", { score: 12, enemyType: "boss", time_left: 3, solo: true }, FIXED),
  );
  assert.equal(
    buildPrompt(ctx, { streamerName: "Pu" }).prompt,
    "Event: Pu just cleared a wave.\n" +
      "Details: score 12, enemy type boss, time left 3, solo yes.\n" +
      "Write the chat message.",
  );
});

test("player chat -> quoted message on one line", () => {
  const ctx = toContext(createChatEvent("is this\nboss   hard?", FIXED));
  assert.equal(
    buildPrompt(ctx).prompt,
    'the streamer typed in chat: "is this boss hard?"\nWrite the chat message.',
  );
});

test("only facts reach the prompt, never the service fields", () => {
  const ctx = toContext(createGameEvent("loss", { score: 3 }, FIXED));
  const { system, prompt } = buildPrompt(ctx);
  for (const leaked of [FIXED.id, String(FIXED.ts), "major", "loss"]) {
    assert.ok(!prompt.includes(leaked), `prompt leaked ${leaked}`);
    assert.ok(!system.includes(leaked), `system leaked ${leaked}`);
  }
});

test("history: last few lines only, one line each, clipped, blanks dropped", () => {
  const ctx = toContext(createGameEvent("win", {}, FIXED));
  const history = [
    { viewer: "old_1", text: "too old to include" },
    ...Array.from({ length: CONTEXT_LIMITS.maxHistory - 1 }, (_, i) => ({
      viewer: `v${i}`,
      text: `line ${i}`,
    })),
    { viewer: "long", text: `a\nb ${"x".repeat(500)}` },
    { viewer: "", text: "no viewer" },
    { viewer: "no_text", text: "   " },
  ];
  const { prompt } = buildPrompt(ctx, { history });
  const chatLines = prompt.split("\n\n")[0].split("\n").slice(1);

  assert.ok(prompt.startsWith("Recent chat:\n"));
  assert.ok(!prompt.includes("too old"));
  assert.ok(!prompt.includes("no viewer"));
  assert.equal(chatLines.length, CONTEXT_LIMITS.maxHistory - 2);
  const long = chatLines.at(-1);
  assert.ok(long.startsWith("long: a b x"));
  assert.ok(long.length <= "long: ".length + CONTEXT_LIMITS.maxHistoryLineLength);
});

test("a bad or missing streamer name falls back to 'the streamer'", () => {
  const ctx = toContext(createGameEvent("win", {}, FIXED));
  assert.ok(buildPrompt(ctx, { streamerName: "  \n " }).prompt.startsWith("Event: the streamer"));
  assert.ok(buildPrompt(ctx, { streamerName: 42 }).prompt.startsWith("Event: the streamer"));
  const long = buildPrompt(ctx, { streamerName: "n".repeat(100) }).prompt;
  assert.ok(long.startsWith(`Event: ${"n".repeat(CONTEXT_LIMITS.maxStreamerNameLength)} just`));
});

test("rejects unknown personas and things that aren't context payloads", () => {
  const ctx = toContext(createGameEvent("win", {}, FIXED));
  assert.throws(() => buildPrompt(ctx, { persona: "mod" }), /no prompt for persona "mod"/);
  assert.throws(() => buildPrompt(ctx, { persona: "toString" }), /no prompt for persona/);
  assert.throws(() => buildPrompt({ kind: "game" }), /context payload/);
  assert.throws(() => buildPrompt({ facts: {} }), /event or a playerMessage/);
  assert.throws(() => buildPrompt(ctx, { history: "nope" }), /history must be an array/);
});

test("something the streamer said out loud is quoted as said on stream", () => {
  const ctx = toContext(createChatEvent("these slimes are my friends", { ...FIXED, spoken: true }));
  assert.deepEqual(ctx.facts, { playerMessage: "these slimes are my friends", spoken: true });
  assert.equal(
    buildPrompt(ctx, { streamerName: "Pu" }).prompt,
    'Pu said on stream: "these slimes are my friends"\nWrite the chat message.',
  );
});

test("in the menu or paused, the prompt says so before the message", () => {
  const say = (scene) =>
    buildPrompt(toContext(createChatEvent("hi chat", { ...FIXED, scene })), { streamerName: "Pu" })
      .prompt;
  assert.equal(
    say("menu"),
    "Right now Pu is in the game menu and hasn't started a game.\n" +
      'Pu typed in chat: "hi chat"\nWrite the chat message.',
  );
  assert.ok(say("paused").startsWith("Pu has paused the game.\n"));
  assert.ok(say("playing").startsWith('Pu typed in chat: "hi chat"'), "playing adds nothing");
});

test("in the shop, the prompt says nobody is fighting", () => {
  const ctx = toContext(createChatEvent("what should I buy", { ...FIXED, scene: "shop" }));
  assert.ok(
    buildPrompt(ctx, { streamerName: "Pu" }).prompt.startsWith(
      "Right now Pu is in the shop between waves, not fighting.\n",
    ),
  );
});
