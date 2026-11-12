import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPhrase, createVoiceBuffer } from "../../src/game/voice.js";
import { LIMITS } from "../../src/events/schema.js";

test("cleanPhrase drops filler, tidies spaces and fits a chat message", () => {
  assert.equal(cleanPhrase("  um so   uh chat  "), "so chat");
  assert.equal(cleanPhrase("hmm"), "");
  assert.equal(cleanPhrase("สวัสดี แชท"), "สวัสดี แชท", "Thai stays");
  assert.equal(cleanPhrase("a".repeat(500)).length, LIMITS.maxChatLength);
  assert.equal(cleanPhrase(undefined), "");
});

test("one spoken message per gap: phrases in between are joined", () => {
  const voice = createVoiceBuffer({ minGapMs: 4000 });
  assert.equal(voice.take(0), null, "nothing said");

  voice.push("hello chat");
  assert.equal(voice.take(0), "hello chat");
  voice.push("these slimes");
  voice.push("are my emotional support enemies");
  assert.equal(voice.take(1000), null, "too soon after the last one");
  assert.equal(voice.take(4000), "these slimes are my emotional support enemies");
  assert.equal(voice.take(9000), null, "nothing waiting");
});

test("filler and tiny phrases don't go to chat", () => {
  const voice = createVoiceBuffer();
  voice.push("uh");
  voice.push("ok");
  voice.push("   ");
  assert.equal(voice.pending, "");
  voice.push("W in the chat");
  voice.clear();
  assert.equal(voice.take(0), null, "cleared when the mic or the stream stops");
});
