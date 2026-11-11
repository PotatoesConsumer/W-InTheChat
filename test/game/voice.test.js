import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_LIMITS,
  cleanPhrase,
  createSubtitles,
  createVoiceBuffer,
} from "../../src/game/voice.js";
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

test("filler and tiny phrases stay on the subtitles only", () => {
  const voice = createVoiceBuffer();
  voice.push("uh");
  voice.push("ok");
  voice.push("   ");
  assert.equal(voice.pending, "");
  voice.push("W in the chat");
  voice.clear();
  assert.equal(voice.take(0), null, "cleared when the mic or the stream stops");
});

test("subtitles show the last phrases and what's being heard, then clear", () => {
  const subs = createSubtitles({ holdMs: 4000, lines: 2 });
  assert.equal(subs.current(0), null);

  subs.interim("these sli", 0);
  assert.deepEqual(subs.current(10), { lines: [], interim: "these sli" });
  subs.final("these slimes are my friends", 100);
  subs.final("chat", 200);
  subs.final("look at this", 300);
  subs.interim("I'm gon", 400);
  assert.deepEqual(subs.current(500), {
    lines: ["chat", "look at this"],
    interim: "I'm gon",
  });

  assert.equal(subs.current(400 + VOICE_LIMITS.holdMs + 1), null, "quiet: cleared");
  assert.equal(subs.current(400 + VOICE_LIMITS.holdMs + 2), null);
  subs.final("back", 10_000);
  assert.deepEqual(subs.current(10_001), { lines: ["back"], interim: "" }, "old lines gone");
  subs.clear();
  assert.equal(subs.current(10_002), null);
});
