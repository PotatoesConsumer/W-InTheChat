import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionFromUrl, CONDITION_LABELS } from "../../src/ui/studyPanel.js";
import { CONDITIONS } from "../../src/service/pipeline.js";

test("conditionFromUrl reads ?condition= and ignores anything else", () => {
  assert.equal(conditionFromUrl("?condition=scripted"), "scripted");
  assert.equal(conditionFromUrl("?service=http://localhost:8787&condition=ai"), "ai");
  assert.equal(conditionFromUrl(""), null);
  assert.equal(conditionFromUrl("?condition=both"), null);
  assert.equal(conditionFromUrl("?condition=__proto__"), null);
});

test("the panel offers exactly the service's conditions", () => {
  assert.deepEqual(Object.keys(CONDITION_LABELS).sort(), [...CONDITIONS].sort());
});
