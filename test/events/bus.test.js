import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { createEventBus } from "../../src/events/bus.js";

const FIXED = { id: "evt-1", ts: 1_700_000_000_000 };

test("delivers events to subscribers of their kind and to '*'", () => {
  const bus = createEventBus();
  const seen = [];
  bus.subscribe("game", (e) => seen.push(`game:${e.name}`));
  bus.subscribe("chat", (e) => seen.push(`chat:${e.text}`));
  bus.subscribe("*", (e) => seen.push(`all:${e.kind}`));

  bus.publish(createGameEvent("win", {}, FIXED));
  bus.publish(createChatEvent("gg", FIXED));

  assert.deepEqual(seen, ["game:win", "all:game", "chat:gg", "all:chat"]);
});

test("rejects invalid input without calling any handler", () => {
  const bus = createEventBus();
  let calls = 0;
  bus.subscribe("*", () => calls++);

  const result = bus.publish({ v: 1, id: "x", kind: "game", ts: 0, name: "headshot", data: {} });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.path), ["name"]);
  assert.equal(calls, 0);
});

test("raw JSON input is delivered as a frozen copy", () => {
  const bus = createEventBus();
  const raw = JSON.parse(JSON.stringify(createGameEvent("streak", { count: 3 }, FIXED)));
  let received;
  bus.subscribe("game", (e) => (received = e));

  const result = bus.publish(raw);
  assert.equal(result.ok, true);
  assert.equal(received, result.event);
  assert.notEqual(received, raw);
  assert.ok(Object.isFrozen(received));
  assert.ok(Object.isFrozen(received.data));
  assert.ok(!Object.isFrozen(raw), "the caller's object is left alone");
});

test("a throwing handler is reported and doesn't stop the others", () => {
  const failures = [];
  const bus = createEventBus({ onError: (err, event) => failures.push([err.message, event.id]) });
  const seen = [];
  bus.subscribe("game", () => {
    throw new Error("boom");
  });
  bus.subscribe("game", (e) => seen.push(e.name));

  const result = bus.publish(createGameEvent("loss", {}, FIXED));
  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["loss"]);
  assert.deepEqual(failures, [["boom", "evt-1"]]);
});

test("unsubscribe stops delivery, including mid-dispatch", () => {
  const bus = createEventBus();
  const seen = [];
  const off = bus.subscribe("game", (e) => {
    seen.push(e.name);
    off();
  });
  bus.subscribe("game", () => seen.push("second"));

  bus.publish(createGameEvent("kill", {}, FIXED));
  bus.publish(createGameEvent("kill", {}, FIXED));
  assert.deepEqual(seen, ["kill", "second", "second"]);
});

test("subscribe rejects unknown kinds and non-functions", () => {
  const bus = createEventBus();
  assert.throws(() => bus.subscribe("camera", () => {}), TypeError);
  assert.throws(() => bus.subscribe("game", "nope"), TypeError);
});
