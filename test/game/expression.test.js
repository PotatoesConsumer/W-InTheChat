import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, createExpressionTracker, EXPRESSION_RULES } from "../../src/game/expression.js";
import { createStreamer } from "../../src/game/streamer.js";
import { createGameEvent, GAME_EVENTS } from "../../src/events/schema.js";
import { stats } from "../../src/game/stats.js";

const SMILE = { mouthSmileLeft: 0.8, mouthSmileRight: 0.7 };
const SURPRISE = { jawOpen: 0.7, browInnerUp: 0.6, mouthSmileLeft: 0.6, mouthSmileRight: 0.6 };
const FROWN = { browDownLeft: 0.6, browDownRight: 0.5 };

test("blendshape scores -> one coarse word", () => {
  assert.equal(classify(SMILE), "smiling");
  assert.equal(
    classify(SURPRISE),
    "surprised",
    "an open mouth with raised brows wins over a smile",
  );
  assert.equal(classify(FROWN), "frowning");
  assert.equal(classify({ jawOpen: 0.9 }), "neutral", "talking isn't surprise");
  assert.equal(classify({}), "neutral");
  assert.equal(classify(null), "neutral", "no face");
});

test("an expression must hold before it counts, and events are rate-limited", () => {
  const t = createExpressionTracker();
  const { holdMs, cooldownMs } = EXPRESSION_RULES;
  assert.equal(t.push(SMILE, 0), null);
  assert.equal(t.push(SMILE, holdMs - 1), null, "not held long enough");
  assert.deepEqual(t.push(SMILE, holdMs), { expression: "smiling", emit: true });
  assert.equal(t.push(SMILE, holdMs + 100), null, "no repeat while it stays");

  assert.equal(t.push({}, 2000), null);
  assert.deepEqual(t.push({}, 2000 + holdMs), { expression: "neutral", emit: false });
  t.push(FROWN, 3000);
  assert.deepEqual(
    t.push(FROWN, 3000 + holdMs),
    { expression: "frowning", emit: false },
    "within the cooldown: the face follows, chat doesn't",
  );
  t.push(SMILE, cooldownMs + 1000);
  assert.deepEqual(t.push(SMILE, cooldownMs + 1000 + holdMs), {
    expression: "smiling",
    emit: true,
  });
  assert.equal(t.current, "smiling");
});

test("a blink-length flicker never counts", () => {
  const t = createExpressionTracker();
  for (let ms = 0; ms < 3000; ms += 100) {
    assert.equal(t.push(ms % 400 === 0 ? SMILE : {}, ms), null, `${ms} ms`);
  }
});

test("the expression event: valid, minor and optional, moves the facecam, never the stats", () => {
  const event = createGameEvent("expression", { expression: "surprised" });
  assert.equal(GAME_EVENTS.expression.importance, "minor");
  assert.equal(GAME_EVENTS.expression.optional, true);
  const streamer = createStreamer();
  streamer.react(event);
  assert.equal(streamer.mood, "shocked");
  streamer.react(createGameEvent("expression", { expression: "toString" }));
  assert.equal(streamer.mood, "shocked", "unknown words are ignored");
  const before = stats.initial();
  assert.equal(stats.reduce(before, event), before);
});
