import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createPacer } from "../../src/service/pacer.js";

test("under the limit, lines go out at once; over it, they wait their turn in order", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pacer = createPacer({ maxPerSecond: 2, now: Date.now });
  const out = [];
  for (const n of [1, 2, 3, 4, 5]) pacer.push(true, () => out.push([n, Date.now()]));
  assert.deepEqual(out, [
    [1, 0],
    [2, 0],
  ]);

  t.mock.timers.tick(999);
  assert.equal(out.length, 2);
  t.mock.timers.tick(1);
  t.mock.timers.tick(1_000);
  assert.deepEqual(out, [
    [1, 0],
    [2, 0],
    [3, 1_000],
    [4, 1_000],
    [5, 2_000],
  ]);
});

test("follow-up updates don't count toward the limit but keep their place", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pacer = createPacer({ maxPerSecond: 1, now: Date.now });
  const out = [];
  pacer.push(true, () => out.push("a1"));
  pacer.push(false, () => out.push("a2"));
  pacer.push(true, () => out.push("b1"));
  pacer.push(false, () => out.push("a3"));
  assert.deepEqual(out, ["a1", "a2"]);
  t.mock.timers.tick(1_000);
  assert.deepEqual(out, ["a1", "a2", "b1", "a3"]);
});

test("idle() waits for the queue; stop() drops it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pacer = createPacer({ maxPerSecond: 1, now: Date.now });
  const out = [];
  pacer.push(true, () => out.push(1));
  pacer.push(true, () => out.push(2));
  let idle = false;
  const done = pacer.idle().then(() => (idle = true));
  await Promise.resolve();
  assert.equal(idle, false);
  t.mock.timers.tick(1_000);
  await done;
  assert.deepEqual(out, [1, 2]);

  pacer.push(true, () => out.push(3));
  pacer.stop();
  t.mock.timers.tick(5_000);
  assert.deepEqual(out, [1, 2]);
  await pacer.idle();
});

test("a delivery that throws after waiting is reported, and the rest still go out", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const onError = mock.fn();
  const pacer = createPacer({ maxPerSecond: 1, now: Date.now, onError });
  const out = [];
  pacer.push(true, () => out.push(1));
  pacer.push(true, () => {
    throw new Error("boom");
  });
  pacer.push(false, () => out.push(3));
  t.mock.timers.tick(1_000);
  assert.equal(onError.mock.callCount(), 1);
  assert.deepEqual(out, [1, 3]);
});
