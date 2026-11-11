import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionFromUrl, sessionFromUrl, CONDITION_LABELS } from "../../src/ui/studyPanel.js";
import { SESSION_LABEL } from "../../src/service/sessionLog.js";
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

test("the hidden attribute really hides (the study panel must stay hidden from participants)", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../../src/ui/overlay.css", import.meta.url), "utf8");
  // .study-panel sets display: flex, which beats the browser's own [hidden] rule.
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("sessionFromUrl reads ?session= with the service's label rule", () => {
  assert.equal(sessionFromUrl("?condition=ai&session=P07"), "P07");
  assert.equal(sessionFromUrl("?condition=ai"), null);
  for (const bad of ["../x", "P 07", "a@b.c", "A".repeat(33)]) {
    assert.equal(sessionFromUrl(`?session=${encodeURIComponent(bad)}`), null, bad);
    assert.ok(!SESSION_LABEL.test(bad), "the service refuses it too");
  }
});
