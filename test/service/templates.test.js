import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, MESSAGE_LIMITS } from "../../src/events/chatMessage.js";
import {
  VIEWERS,
  EVENT_LINES,
  CHAT_LINES,
  FALLBACK_LINES,
  lineFor,
  pick,
  missingEventLines,
} from "../../src/service/templates.js";

test("every catalog event has template lines (update templates.js with the catalog)", () => {
  assert.deepEqual(missingEventLines(), []);
});

test("every persona has viewer names that fit the chat_message limit", () => {
  for (const persona of PERSONAS) {
    assert.ok(VIEWERS[persona]?.length > 0, persona);
    for (const name of VIEWERS[persona]) {
      assert.ok(name.length <= MESSAGE_LIMITS.maxViewerLength, name);
    }
  }
});

test("every line is non-empty and within the text limit", () => {
  for (const line of [...Object.values(EVENT_LINES).flat(), ...CHAT_LINES, ...FALLBACK_LINES]) {
    assert.ok(line.trim().length > 0 && line.length <= MESSAGE_LIMITS.maxTextLength, line);
  }
});

test("pick and lineFor use the given random, including its edges", () => {
  assert.equal(
    pick(["a", "b", "c"], () => 0),
    "a",
  );
  assert.equal(
    pick(["a", "b", "c"], () => 0.999999),
    "c",
  );
  assert.equal(
    lineFor({ kind: "game", name: "win" }, () => 0),
    EVENT_LINES.win[0],
  );
  assert.equal(
    lineFor({ kind: "chat", name: null }, () => 0),
    CHAT_LINES[0],
  );
  assert.throws(() => lineFor({ kind: "game", name: "headshot" }, () => 0), /headshot/);
});
