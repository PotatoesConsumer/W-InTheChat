import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION,
  GAME_EVENTS,
  IMPORTANCE,
  LIMITS,
  EventValidationError,
  createGameEvent,
  createChatEvent,
  validateEvent,
  importanceOf,
} from "../../src/events/schema.js";

const FIXED = { id: "evt-1", ts: 1_700_000_000_000 };

function errorPaths(event) {
  const result = validateEvent(event);
  assert.equal(result.ok, false, "expected the event to be rejected");
  return result.errors.map((e) => e.path);
}

test("createGameEvent builds a valid, frozen event", () => {
  const event = createGameEvent("win", { score: 12, mode: "duo" }, FIXED);
  assert.deepEqual(event, {
    v: SCHEMA_VERSION,
    id: "evt-1",
    kind: "game",
    ts: FIXED.ts,
    name: "win",
    data: { score: 12, mode: "duo" },
  });
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.data));
  assert.deepEqual(validateEvent(event), { ok: true });
});

test("createGameEvent fills in id and ts when not given", () => {
  const before = Date.now();
  const event = createGameEvent("kill");
  assert.equal(typeof event.id, "string");
  assert.ok(event.id.length > 0);
  assert.ok(event.ts >= before && event.ts <= Date.now());
  assert.notEqual(createGameEvent("kill").id, event.id);
});

test("createGameEvent does not share its data object with the caller", () => {
  const data = { hp: 10 };
  const event = createGameEvent("damage_taken", data, FIXED);
  data.hp = 0;
  assert.equal(event.data.hp, 10);
});

test("createChatEvent trims the player's text", () => {
  const event = createChatEvent("  gg chat  ", FIXED);
  assert.equal(event.kind, "chat");
  assert.equal(event.text, "gg chat");
  assert.ok(Object.isFrozen(event));
});

test("factories throw EventValidationError with the failing paths", () => {
  assert.throws(
    () => createGameEvent("not_an_event", {}, FIXED),
    (err) => err instanceof EventValidationError && err.errors[0].path === "name",
  );
  assert.throws(() => createChatEvent("   ", FIXED), EventValidationError);
});

test("importanceOf reads the catalog", () => {
  assert.equal(importanceOf(createGameEvent("win", {}, FIXED)), IMPORTANCE.MAJOR);
  assert.equal(importanceOf(createGameEvent("kill", {}, FIXED)), IMPORTANCE.MINOR);
  assert.throws(() => importanceOf(createChatEvent("hi", FIXED)), TypeError);
});

test("every catalog entry has a valid importance and phrase", () => {
  const levels = Object.values(IMPORTANCE);
  for (const [name, entry] of Object.entries(GAME_EVENTS)) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, name);
    assert.ok(levels.includes(entry.importance), `${name}: bad importance`);
    assert.ok(typeof entry.phrase === "string" && entry.phrase.length > 0, `${name}: no phrase`);
  }
});

test("events survive a JSON round trip (browser -> service)", () => {
  const game = createGameEvent("streak", { count: 5 }, FIXED);
  const chat = createChatEvent("hello chat", FIXED);
  assert.deepEqual(validateEvent(JSON.parse(JSON.stringify(game))), { ok: true });
  assert.deepEqual(validateEvent(JSON.parse(JSON.stringify(chat))), { ok: true });
});

test("rejects non-objects", () => {
  for (const value of [null, undefined, "win", 42, [], new Date()]) {
    assert.deepEqual(errorPaths(value), [""]);
  }
});

test("rejects a wrong schema version, bad id, bad ts and unknown kind", () => {
  const base = { ...createGameEvent("win", {}, FIXED) };
  assert.deepEqual(errorPaths({ ...base, v: 2 }), ["v"]);
  assert.deepEqual(errorPaths({ ...base, id: "" }), ["id"]);
  assert.deepEqual(errorPaths({ ...base, id: "x".repeat(LIMITS.maxIdLength + 1) }), ["id"]);
  assert.deepEqual(errorPaths({ ...base, ts: -1 }), ["ts"]);
  assert.deepEqual(errorPaths({ ...base, ts: 1.5 }), ["ts"]);
  assert.deepEqual(errorPaths({ ...base, kind: "camera" }), ["kind"]);
});

test("rejects unknown top-level fields (catches typos)", () => {
  const base = { ...createGameEvent("win", {}, FIXED) };
  assert.deepEqual(errorPaths({ ...base, importance: "major" }), ["importance"]);
  const chat = { ...createChatEvent("hi", FIXED) };
  assert.deepEqual(errorPaths({ ...chat, name: "win" }), ["name"]);
});

test("rejects game names that are not in the catalog, including prototype keys", () => {
  const base = { ...createGameEvent("win", {}, FIXED) };
  for (const name of ["headshot", "toString", "__proto__", "", 7]) {
    assert.deepEqual(errorPaths({ ...base, name }), ["name"], String(name));
  }
});

test("rejects data that is not small, flat and primitive", () => {
  const base = { ...createGameEvent("win", {}, FIXED) };
  assert.deepEqual(errorPaths({ ...base, data: null }), ["data"]);
  assert.deepEqual(errorPaths({ ...base, data: [1] }), ["data"]);
  assert.deepEqual(errorPaths({ ...base, data: { pos: { x: 1 } } }), ["data.pos"]);
  assert.deepEqual(errorPaths({ ...base, data: { list: [1, 2] } }), ["data.list"]);
  assert.deepEqual(errorPaths({ ...base, data: { hp: NaN } }), ["data.hp"]);
  assert.deepEqual(errorPaths({ ...base, data: { hp: Infinity } }), ["data.hp"]);
  assert.deepEqual(errorPaths({ ...base, data: { "Bad-Key": 1 } }), ["data.Bad-Key"]);
  assert.deepEqual(
    errorPaths({ ...base, data: { note: "x".repeat(LIMITS.maxDataStringLength + 1) } }),
    ["data.note"],
  );

  const tooMany = Object.fromEntries(
    Array.from({ length: LIMITS.maxDataKeys + 1 }, (_, i) => [`k${i}`, i]),
  );
  assert.deepEqual(errorPaths({ ...base, data: tooMany }), ["data"]);
});

test("rejects chat text that is missing, empty or too long", () => {
  const base = { ...createChatEvent("hi", FIXED) };
  assert.deepEqual(errorPaths({ ...base, text: 5 }), ["text"]);
  assert.deepEqual(errorPaths({ ...base, text: " \n\t " }), ["text"]);
  assert.deepEqual(errorPaths({ ...base, text: "x".repeat(LIMITS.maxChatLength + 1) }), ["text"]);
  assert.deepEqual(validateEvent({ ...base, text: "x".repeat(LIMITS.maxChatLength) }), {
    ok: true,
  });
});

test("reports every problem at once", () => {
  const paths = errorPaths({ v: 1, id: "", kind: "game", ts: -5, name: "nope", data: { a: {} } });
  assert.deepEqual(paths.sort(), ["data.a", "id", "name", "ts"]);
});

test("a spoken chat event says so; typed ones have no spoken field", () => {
  const spoken = createChatEvent("  hi chat  ", { spoken: true });
  assert.equal(spoken.spoken, true);
  assert.equal(spoken.text, "hi chat");
  assert.equal("spoken" in createChatEvent("hi chat"), false, "typed stays as before");
  assert.equal("spoken" in createChatEvent("hi chat", { spoken: false }), false);

  const typed = createChatEvent("hi");
  assert.equal(validateEvent({ ...typed, spoken: true }).ok, true);
  const bad = validateEvent({ ...typed, spoken: "yes" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].path, "spoken");
  assert.equal(validateEvent({ ...typed, spoken: false }).ok, false, "true or absent");
  assert.equal(validateEvent({ ...createGameEvent("win"), spoken: true }).ok, false);
});
