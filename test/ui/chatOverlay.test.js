import { test } from "node:test";
import assert from "node:assert/strict";
import { typeInDelay, TYPE_IN } from "../../src/ui/chatOverlay.js";

test("whole replies are typed in, long ones faster so they never drag", () => {
  assert.equal(typeInDelay("gg"), TYPE_IN.msPerChar);
  const long = "x".repeat(200);
  assert.equal(typeInDelay(long) * long.length, TYPE_IN.maxMs);
  assert.equal(typeInDelay(""), 0);
  assert.equal(typeInDelay("gg", { msPerChar: 0, maxMs: 1000 }), 0, "0 turns typing off");
});
