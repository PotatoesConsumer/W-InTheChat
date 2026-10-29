import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent, EventValidationError } from "../../src/events/schema.js";
import { toContext } from "../../src/events/context.js";
import { buildFanPrompt } from "../../src/ai/personas/fan.js";

const FIXED = { id: "evt-1", ts: 1_700_000_000_000 };

test("game event -> payload with catalog phrase, importance and details", () => {
  const ctx = toContext(createGameEvent("win", { score: 12 }, FIXED));
  assert.deepEqual(ctx, {
    eventId: "evt-1",
    ts: FIXED.ts,
    kind: "game",
    name: "win",
    importance: "major",
    facts: { event: "cleared a wave", details: { score: 12 } },
  });
  assert.ok(Object.isFrozen(ctx));
  assert.ok(Object.isFrozen(ctx.facts));
  assert.ok(Object.isFrozen(ctx.facts.details));
});

test("chat event -> payload with only the player's message as facts", () => {
  const ctx = toContext(createChatEvent("is this boss hard?", FIXED));
  assert.deepEqual(ctx, {
    eventId: "evt-1",
    ts: FIXED.ts,
    kind: "chat",
    name: null,
    importance: null,
    facts: { playerMessage: "is this boss hard?" },
  });
});

test("facts never include the id or timestamp (AI boundary)", () => {
  const ctx = toContext(createGameEvent("loss", { round: 3 }, FIXED));
  const serialized = JSON.stringify(ctx.facts);
  assert.ok(!serialized.includes("evt-1"));
  assert.ok(!serialized.includes(String(FIXED.ts)));
});

test("facts.event plugs straight into the existing Fan prompt", () => {
  const ctx = toContext(createGameEvent("close_call", {}, FIXED));
  assert.equal(
    buildFanPrompt({ event: ctx.facts.event }),
    "Event: the streamer just barely survived a wave on low health.\nWrite the chat message.",
  );
});

test("rejects invalid events", () => {
  assert.throws(() => toContext({ kind: "game", name: "win" }), EventValidationError);
  assert.throws(() => toContext(null), EventValidationError);
});
