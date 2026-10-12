import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameLoop } from "../../src/game/loop.js";

/** A loop driven by hand: `tick(ms)` advances the clock and runs one frame. */
function harness(opts = {}) {
  let time = 0;
  let pending = null;
  const updates = [];
  const renders = [];
  const loop = createGameLoop({
    update: (dt) => updates.push(dt),
    render: (alpha) => renders.push(alpha),
    step: 10,
    now: () => time,
    requestFrame: (cb) => (pending = cb),
    cancelFrame: () => (pending = null),
    ...opts,
  });
  return {
    loop,
    updates,
    renders,
    tick(ms) {
      time += ms;
      const cb = pending;
      pending = null;
      cb?.();
    },
    get pending() {
      return pending;
    },
  };
}

test("runs fixed-size updates and carries the remainder to the next frame", () => {
  const h = harness();
  h.loop.start();

  h.tick(25);
  assert.deepEqual(h.updates, [10, 10]);
  assert.equal(h.renders.at(-1), 0.5);

  h.tick(5); // 5 left over + 5 = one more step
  assert.deepEqual(h.updates, [10, 10, 10]);
  assert.equal(h.renders.at(-1), 0);
});

test("renders every frame even when no update is due", () => {
  const h = harness();
  h.loop.start();
  h.tick(4);
  assert.equal(h.updates.length, 0);
  assert.equal(h.renders.length, 1);
  assert.ok(h.renders[0] >= 0 && h.renders[0] < 1);
});

test("clamps a long gap so it doesn't run hundreds of catch-up updates", () => {
  const h = harness({ maxFrame: 50 });
  h.loop.start();
  h.tick(10_000); // e.g. the tab was in the background
  assert.equal(h.updates.length, 5);
});

test("stop() cancels the next frame, including from inside update", () => {
  const h = harness();
  h.loop.start();
  h.tick(10);
  h.loop.stop();
  assert.equal(h.pending, null);
  assert.equal(h.loop.running, false);

  let calls = 0;
  const h2 = harness({
    update: () => {
      calls++;
      h2.loop.stop();
    },
  });
  h2.loop.start();
  h2.tick(50);
  assert.equal(calls, 1, "no more updates after stop()");
  assert.equal(h2.pending, null);
});

test("start() twice doesn't run two loops", () => {
  const h = harness();
  h.loop.start();
  h.loop.start();
  h.tick(10);
  assert.deepEqual(h.updates, [10]);
});

test("rejects bad options", () => {
  assert.throws(() => createGameLoop({ render() {} }), TypeError);
  assert.throws(() => createGameLoop({ update() {}, render() {}, step: 0 }), RangeError);
});
