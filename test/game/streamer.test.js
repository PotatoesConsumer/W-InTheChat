import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { createStreamer, MOOD_MS } from "../../src/game/streamer.js";

test("reacts to events, then relaxes back to neutral", () => {
  const s = createStreamer();
  assert.equal(s.mood, "neutral");
  s.react(createGameEvent("win"));
  assert.equal(s.mood, "hyped");
  s.update(MOOD_MS.hyped - 1);
  assert.equal(s.mood, "hyped");
  s.update(1);
  assert.equal(s.mood, "neutral");
});

test("talking when the streamer chats; a newer reaction replaces the old one", () => {
  const s = createStreamer();
  s.react(createGameEvent("loss"));
  s.react(createChatEvent("gg"));
  assert.equal(s.mood, "talking");
  s.update(MOOD_MS.talking);
  assert.equal(s.mood, "neutral");
});

test("events without a mood leave the face alone", () => {
  const s = createStreamer();
  s.react(createGameEvent("close_call"));
  s.react(createGameEvent("round_start"));
  assert.equal(s.mood, "shocked");
});
