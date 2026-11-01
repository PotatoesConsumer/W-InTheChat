import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoalescer, coalesceKey } from "../../src/service/coalesce.js";
import { createChatEvent, createGameEvent } from "../../src/events/schema.js";
import { toContext } from "../../src/events/context.js";

const opts = { windowMs: 2_000, every: 5, maxPerRun: 3 };
const admitted = (c, key, times) => times.filter((ts) => c.admit(key, ts));

test("a run answers its first event, then every 5th, at most 3 in all", () => {
  const c = createCoalescer(opts);
  const times = Array.from({ length: 20 }, (_, i) => i * 100);
  assert.deepEqual(admitted(c, "game:kill", times), [0, 400, 900]);
});

test("a run chains on gaps under the window; a gap of the window or more starts a new one", () => {
  const c = createCoalescer(opts);
  // 1.9 s gaps keep one run going for 7.6 s; then a 2 s gap.
  assert.deepEqual(
    admitted(c, "game:streak", [0, 1_900, 3_800, 5_700, 7_600, 9_600]),
    [0, 7_600, 9_600],
  );
});

test("different keys are separate runs", () => {
  const c = createCoalescer(opts);
  assert.equal(c.admit("game:kill", 0), true);
  assert.equal(c.admit("game:win", 10), true);
  assert.equal(c.admit("chat:hi", 20), true);
  assert.equal(c.admit("game:kill", 30), false);
});

test("player messages are the same event only when the text is the same", () => {
  const key = (text) => coalesceKey(toContext(createChatEvent(text)));
  assert.equal(key("GG  chat"), key("gg chat"));
  assert.notEqual(key("ok chat"), key("should I go left?"));
  assert.notEqual(key("win"), coalesceKey(toContext(createGameEvent("win"))));
});
