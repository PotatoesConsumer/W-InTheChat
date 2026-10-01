import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatMessage } from "../../src/events/chatMessage.js";
import { createChatEvent, createGameEvent } from "../../src/events/schema.js";
import { createChatLog, PLAYER_NAME } from "../../src/ui/chatLog.js";

const msg = (id, text, extra = {}) =>
  createChatMessage({
    id,
    persona: "fan",
    viewer: "hype_train_99",
    source: "ai",
    text,
    ts: 1_700_000_000_000,
    ...extra,
  });

test("appends new messages in order", () => {
  const log = createChatLog();
  assert.equal(log.apply(msg("a", "first")).type, "added");
  assert.equal(log.apply(msg("b", "second")).type, "added");
  assert.deepEqual(
    log.messages().map((m) => m.text),
    ["first", "second"],
  );
});

test("a streamed update replaces the text and keeps the line's position", () => {
  const log = createChatLog();
  log.apply(msg("a", "LETS", { done: false }));
  log.apply(msg("b", "other"));
  const result = log.apply(msg("a", "LETS GO", { done: true, ts: 1_700_000_000_100 }));

  assert.equal(result.type, "updated");
  assert.deepEqual(
    log.messages().map((m) => [m.id, m.text]),
    [
      ["a", "LETS GO"],
      ["b", "other"],
    ],
  );
});

test("ignores updates after done, late older updates, and invalid messages", () => {
  const log = createChatLog();
  log.apply(msg("a", "LETS GO", { done: false, ts: 200 }));

  assert.deepEqual(log.apply(msg("a", "LETS", { done: false, ts: 100 })), {
    type: "ignored",
    reason: "stale",
  });

  log.apply(msg("a", "LETS GO!!", { ts: 300 }));
  assert.equal(log.apply(msg("a", "edited", { ts: 400 })).reason, "already done");

  assert.equal(log.apply({ kind: "chat_message", text: "<b>hi</b>" }).reason, "invalid");
  assert.deepEqual(
    log.messages().map((m) => m.text),
    ["LETS GO!!"],
  );
});

test("drops the oldest lines past maxMessages and reports them", () => {
  const log = createChatLog({ maxMessages: 2 });
  log.apply(msg("a", "1"));
  log.apply(msg("b", "2"));
  const result = log.apply(msg("c", "3"));

  assert.deepEqual(result.removed, ["a"]);
  assert.equal(log.size, 2);
  assert.deepEqual(
    log.messages().map((m) => m.id),
    ["b", "c"],
  );
});

test("the player's own messages are added in order as 'Player'", () => {
  const log = createChatLog();
  log.apply(msg("a", "hello streamer"));
  const result = log.addPlayerMessage(createChatEvent("  hi chat  ", { id: "p1", ts: 5 }));

  assert.equal(result.type, "added");
  assert.deepEqual(result.message, {
    id: "p1",
    kind: "player",
    ts: 5,
    viewer: PLAYER_NAME,
    text: "hi chat",
    done: true,
  });
  assert.deepEqual(
    log.messages().map((m) => m.id),
    ["a", "p1"],
  );
});

test("player messages: only valid chat events, once each, and trimmed like the rest", () => {
  const log = createChatLog({ maxMessages: 2 });
  const event = createChatEvent("gg", { id: "p1", ts: 1 });

  assert.equal(log.addPlayerMessage(createGameEvent("win")).reason, "invalid");
  assert.equal(log.addPlayerMessage({ kind: "chat", text: "no envelope" }).reason, "invalid");
  log.addPlayerMessage(event);
  assert.equal(log.addPlayerMessage(event).reason, "duplicate");
  assert.equal(log.apply(msg("p1", "spoof")).reason, "already done");

  log.apply(msg("b", "1"));
  assert.deepEqual(log.apply(msg("c", "2")).removed, ["p1"]);
});

test("rejects a bad maxMessages", () => {
  assert.throws(() => createChatLog({ maxMessages: 0 }), RangeError);
});
