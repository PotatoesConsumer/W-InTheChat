import { test } from "node:test";
import assert from "node:assert/strict";
import { EventValidationError, LIMITS } from "../../src/events/schema.js";
import {
  PERSONAS,
  MESSAGE_SOURCES,
  MESSAGE_LIMITS,
  createChatMessage,
  validateChatMessage,
} from "../../src/events/chatMessage.js";

const BASE = {
  eventId: "evt-1",
  persona: "fan",
  viewer: "hype_andy",
  source: "ai",
  text: "LETS GOOO",
  id: "msg-1",
  ts: 1_700_000_000_000,
};

function errorPaths(message) {
  const result = validateChatMessage(message);
  assert.equal(result.ok, false, "expected the message to be rejected");
  return result.errors.map((e) => e.path);
}

test("createChatMessage builds a valid, frozen message", () => {
  const message = createChatMessage(BASE);
  assert.deepEqual(message, { v: 1, kind: "chat_message", done: true, ...BASE });
  assert.ok(Object.isFrozen(message));
  assert.deepEqual(validateChatMessage(message), { ok: true });
});

test("defaults: ambient chat (no event), fresh id and ts", () => {
  const { eventId, id, ts, ...rest } = BASE;
  const message = createChatMessage(rest);
  assert.equal(message.eventId, null);
  assert.equal(typeof message.id, "string");
  assert.ok(Number.isSafeInteger(message.ts));
});

test("streamed updates share an id and carry the full text so far", () => {
  const updates = ["LETS", "LETS GO", "LETS GOOO 🔥"].map((text, i, all) =>
    createChatMessage({ ...BASE, text, done: i === all.length - 1 }),
  );
  assert.deepEqual(updates.map((u) => u.id), ["msg-1", "msg-1", "msg-1"]);
  assert.deepEqual(updates.map((u) => u.done), [false, false, true]);
  assert.equal(updates.at(-1).text, "LETS GOOO 🔥");
});

test("accepts every persona and source", () => {
  for (const persona of PERSONAS) {
    for (const source of MESSAGE_SOURCES) {
      assert.deepEqual(validateChatMessage(createChatMessage({ ...BASE, persona, source })), { ok: true });
    }
  }
});

test("createChatMessage throws EventValidationError naming the message", () => {
  assert.throws(
    () => createChatMessage({ ...BASE, persona: "troll" }),
    (err) => err instanceof EventValidationError && err.message.startsWith("Invalid chat message"),
  );
});

test("survives a JSON round trip (service -> UI)", () => {
  const message = createChatMessage(BASE);
  assert.deepEqual(validateChatMessage(JSON.parse(JSON.stringify(message))), { ok: true });
});

test("rejects bad fields", () => {
  const base = { ...createChatMessage(BASE) };
  assert.deepEqual(errorPaths(null), [""]);
  assert.deepEqual(errorPaths({ ...base, v: 2 }), ["v"]);
  assert.deepEqual(errorPaths({ ...base, kind: "chat" }), ["kind"]);
  assert.deepEqual(errorPaths({ ...base, id: "" }), ["id"]);
  assert.deepEqual(errorPaths({ ...base, eventId: "" }), ["eventId"]);
  assert.deepEqual(errorPaths({ ...base, eventId: "x".repeat(LIMITS.maxIdLength + 1) }), ["eventId"]);
  assert.deepEqual(errorPaths({ ...base, ts: -1 }), ["ts"]);
  assert.deepEqual(errorPaths({ ...base, persona: "troll" }), ["persona"]);
  assert.deepEqual(errorPaths({ ...base, source: "gpt" }), ["source"]);
  assert.deepEqual(errorPaths({ ...base, viewer: "  " }), ["viewer"]);
  assert.deepEqual(errorPaths({ ...base, viewer: "x".repeat(MESSAGE_LIMITS.maxViewerLength + 1) }), ["viewer"]);
  assert.deepEqual(errorPaths({ ...base, text: "" }), ["text"]);
  assert.deepEqual(errorPaths({ ...base, text: "x".repeat(MESSAGE_LIMITS.maxTextLength + 1) }), ["text"]);
  assert.deepEqual(errorPaths({ ...base, done: "yes" }), ["done"]);
  assert.deepEqual(errorPaths({ ...base, donation: 5 }), ["donation"]);
});
