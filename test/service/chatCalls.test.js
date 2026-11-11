import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCall, chatCallLines, CHAT_CALL_LINES } from "../../src/service/chatCalls.js";
import { QA_LIMITS } from "../../src/harness/checks.js";

test("chat calls: the token the streamer asks chat to spam", () => {
  const cases = {
    "W in the chat": "W",
    "w in chat": "W",
    "drop a W in the chat": "W",
    "Ws in the chat": "W",
    "F in chat for my run": "F",
    "chat, press F": "F",
    "press 1 if you're ready": "1",
    "spam 🔥": "🔥",
    "type gg": "GG",
    "yo drop an L in chat": "L",
  };
  for (const [text, token] of Object.entries(cases)) assert.equal(chatCall(text), token, text);
});

test("ordinary messages aren't chat calls", () => {
  for (const text of [
    "everyone in the chat is great",
    "hi chat",
    "type something nice",
    "is this boss hard?",
    "press here",
    "spam http://x.co",
    "",
  ]) {
    assert.equal(chatCall(text), null, text);
  }
});

test("chat never spams what the safety check would block", () => {
  // A self-harm token from the safety test set (eval/safety-cases-v1.json, "block").
  assert.equal(chatCall("spam kys"), null);
  assert.equal(chatCall("kys in the chat"), null);
});

test("call lines: one per viewer, within the per-event limit, same roll same lines", () => {
  assert.ok(CHAT_CALL_LINES <= QA_LIMITS.maxMessagesPerEvent);
  const lines = chatCallLines("W", ["fan", "fan", "lurker"], 0.42);
  assert.equal(lines.length, CHAT_CALL_LINES);
  assert.deepEqual(chatCallLines("W", ["fan", "fan", "lurker"], 0.42), lines);
  for (const { text } of lines) assert.match(text, /W/);
  assert.equal(lines[2].text, "W", "the Lurker just types it");
  const hater = chatCallLines("W", ["hater", "fan", "lurker"], 0.42)[0];
  assert.match(hater.text, /^L/, "the Hater answers a W with an L");
  assert.equal(chatCallLines("F", ["hater", "fan", "lurker"], 0.42)[0].persona, "hater");
});
