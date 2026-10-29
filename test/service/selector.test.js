import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGameEvent,
  createChatEvent,
  GAME_EVENTS,
  IMPORTANCE,
} from "../../src/events/schema.js";
import { toContext } from "../../src/events/context.js";
import { PERSONAS } from "../../src/events/chatMessage.js";
import { PERSONA_WEIGHTS, selectPersona } from "../../src/service/selector.js";

const win = toContext(createGameEvent("win", {}));
const chat = toContext(createChatEvent("hi"));
const rolls = Array.from({ length: 1000 }, (_, i) => i / 1000);
const share = (ctx, personas) => {
  const counts = {};
  for (const r of rolls) {
    const p = selectPersona(ctx, r, personas);
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return counts;
};

test("weights name only real personas, and every major event can be answered", () => {
  for (const table of Object.values(PERSONA_WEIGHTS)) {
    for (const p of Object.keys(table)) assert.ok(PERSONAS.includes(p), p);
  }
  for (const [name, { importance }] of Object.entries(GAME_EVENTS)) {
    if (importance !== IMPORTANCE.MAJOR) continue;
    assert.ok(
      PERSONAS.includes(selectPersona(toContext(createGameEvent(name, {})), 0.5, PERSONAS)),
    );
  }
});

test("the draw follows the weights", () => {
  const counts = share(win, PERSONAS);
  const w = PERSONA_WEIGHTS.win;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const p of PERSONAS) {
    assert.ok(Math.abs(counts[p] - (w[p] / total) * rolls.length) <= 1, p);
  }
});

test("only enabled personas are picked; the Lurker never answers chat", () => {
  assert.deepEqual(Object.keys(share(win, ["fan", "lurker"])).sort(), ["fan", "lurker"]);
  assert.ok(!("lurker" in share(chat, PERSONAS)));
  assert.ok(!("hater" in share(chat, ["fan", "backseat", "lurker"])));
  assert.throws(() => selectPersona(chat, 0.5, ["lurker"]), /no enabled persona/);
});

test("same event and roll, same persona; unknown major events use the default weights", () => {
  for (const r of [0, 0.3, 0.99]) {
    assert.equal(selectPersona(win, r, PERSONAS), selectPersona(win, r, PERSONAS));
  }
  const other = { kind: "game", name: "boss_defeated" };
  assert.deepEqual(share(other, PERSONAS), share({ kind: "game", name: "major" }, PERSONAS));
});
