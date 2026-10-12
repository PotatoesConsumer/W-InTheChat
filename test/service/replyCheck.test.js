import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReply, canShowPartial } from "../../src/service/replyCheck.js";
import { parseFanResponse } from "../../src/ai/personas/fan.js";

test("accepts an ordinary chat line, trimmed", () => {
  assert.deepEqual(checkReply("  W streamer 🔥 "), { ok: true, text: "W streamer 🔥" });
});

test("rejects empty, too long, AI talk and structured output", () => {
  const reasons = (text) => checkReply(text).reason;
  assert.equal(reasons(""), "empty");
  assert.equal(reasons("   "), "empty");
  assert.equal(reasons(undefined), "empty");
  assert.equal(reasons("x".repeat(201)), "too_long");
  assert.equal(reasons("As an AI language model, I cannot watch streams."), "ai_disclosure");
  assert.equal(reasons("I'm an AI so no comment"), "ai_disclosure");
  assert.equal(reasons("sorry, I can't help with that"), "ai_disclosure");
  assert.equal(reasons('{"message": "nice shot"}'), "structured");
  assert.equal(reasons("[nice shot]"), "structured");
});

test("doesn't flag ordinary words that only look close", () => {
  for (const ok of ["brain diff", "said it ain't over", "cannot believe that 😂", "AI enemies?"]) {
    assert.equal(checkReply(ok).ok, true, ok);
  }
});

test("partials are held back until long enough and clean", () => {
  assert.equal(canShowPartial("GG W", 12), false);
  assert.equal(canShowPartial("GG WWWW chat", 12), true);
  assert.equal(canShowPartial("As an AI lang", 12), false);
});

test("the Fan parser cleans the model's usual wrapping", () => {
  assert.equal(parseFanResponse('"LETS GO"'), "LETS GO");
  assert.equal(parseFanResponse("```\nLETS GO\n```"), "LETS GO");
  assert.equal(parseFanResponse("**HYPE** chat\nsecond line\nthird"), "HYPE chat");
  assert.equal(parseFanResponse("\n\n  clip it  \n"), "clip it");
  assert.equal(parseFanResponse(""), "");
});
