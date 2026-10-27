import { test } from "node:test";
import assert from "node:assert/strict";
import { createReplyLatency } from "../../src/game/replyLatency.js";

test("times each event from send to first text and to the finished reply", () => {
  let t = 0;
  const latency = createReplyLatency({ now: () => t });
  latency.sent("e1");
  t = 100;
  assert.equal(latency.message({ eventId: "e1", text: "", done: false, source: "ai" }), null);
  t = 150;
  latency.message({ eventId: "e1", text: "LET", done: false, source: "ai" });
  t = 300;
  const row = latency.message({ eventId: "e1", text: "LETS GO", done: true, source: "ai" });
  assert.deepEqual(row, { eventId: "e1", source: "ai", firstTextMs: 150, completionMs: 300 });

  assert.equal(latency.message({ eventId: "e1", text: "late", done: true, source: "ai" }), null);
  assert.equal(latency.summary().all.completion.p50, 300);
});

test("refused events and replies to unknown events don't count", () => {
  const latency = createReplyLatency({ now: () => 0 });
  latency.sent("e1");
  latency.dropped("e1");
  latency.message({ eventId: "e1", text: "x", done: true, source: "template" });
  latency.message({ eventId: "other", text: "x", done: true, source: "template" });
  assert.equal(latency.rows().length, 0);
});
