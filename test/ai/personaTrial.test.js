import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { toContext } from "../../src/events/context.js";
import { AI_PERSONAS } from "../../src/ai/personas/index.js";
import { trialInputs, flagReply, checkNames } from "../../src/ai/personaTrial.js";

const loss = toContext(createGameEvent("loss", {}));
const win = toContext(createGameEvent("win", {}));
const chat = toContext(createChatEvent("hi"));

test("trial inputs are valid events: majors, details, a minor and player chat", () => {
  const inputs = trialInputs().map(toContext);
  assert.ok(inputs.some((c) => c.facts.details));
  assert.ok(inputs.some((c) => c.importance === "minor"));
  assert.equal(inputs.filter((c) => typeof c.facts.playerMessage === "string").length, 4);
});

test("every persona has a check list, and a clean reply gets no flags", () => {
  for (const persona of AI_PERSONAS) {
    assert.ok(checkNames(persona).includes("failed"));
    assert.deepEqual(flagReply(persona, "you rushed that", loss), []);
  }
});

test("common checks: pronouns, labels, failed replies, the name opener only with a name", () => {
  assert.deepEqual(flagReply("fan", "his aim is wild", win), ["heShe"]);
  assert.deepEqual(flagReply("fan", 'Player: "gg"', win), ["label"]);
  assert.deepEqual(flagReply("fan", "", win), ["failed"]);
  assert.deepEqual(flagReply("hater", "Pu? fluke", win, "Pu"), ["nameOpener"]);
  assert.deepEqual(flagReply("hater", "the streamer? fluke", win), []);
});

test("persona checks catch the known weaknesses", () => {
  assert.deepEqual(flagReply("fan", "you're up big now!", loss), ["lossAsWin"]);
  assert.deepEqual(flagReply("fan", "you're up big now!", win), []);
  assert.deepEqual(flagReply("hater", "nice shot, bot", win), ["nameCalling"]);
  assert.deepEqual(flagReply("hater", "Hey chat, how's everyone", chat), ["greetsAsStreamer"]);
  assert.deepEqual(flagReply("backseat", "Good job! next time wait", win), ["praiseFirst"]);
  assert.deepEqual(flagReply("backseat", "read the map", loss), ["invented"]);
  assert.deepEqual(flagReply("backseat", "how can I assist", chat), ["assistant"]);
  assert.deepEqual(flagReply("backseat", "w ".repeat(16).trim(), loss), ["over15Words"]);
  assert.deepEqual(flagReply("lurker", "that was a close one", win), ["over4Words"]);
  assert.deepEqual(flagReply("lurker", ":L扑", loss), ["oddChars"]);
  assert.deepEqual(flagReply("lurker", "gg 🔥", win), []);
});
