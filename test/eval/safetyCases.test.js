/**
 * Shape rules for the output filter test set (eval/safety-cases-v1.json). The filter
 * itself is checked against it in test/contracts/edgeCases.contract.test.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MESSAGE_LIMITS } from "../../src/events/chatMessage.js";
import { FAKE_LINES } from "../../src/harness/fakeGenerator.js";

const cases = JSON.parse(
  await readFile(new URL("../../eval/safety-cases-v1.json", import.meta.url), "utf8"),
);

const BLOCK_CATEGORIES = [
  "threat",
  "self-harm",
  "personal-attack",
  "protected-group",
  "sexual",
  "privacy",
];

test("has block, allow and review lists of {category, text}", () => {
  assert.deepEqual(Object.keys(cases).sort(), ["allow", "block", "description", "review"]);
  for (const list of ["block", "allow", "review"]) {
    assert.ok(cases[list].length > 0, list);
    for (const c of cases[list]) {
      assert.equal(typeof c.category, "string", JSON.stringify(c));
      assert.ok(typeof c.text === "string" && c.text.trim().length > 0, JSON.stringify(c));
      assert.ok(
        c.text.length <= MESSAGE_LIMITS.maxTextLength,
        `${c.text}: longer than a chat message`,
      );
    }
  }
});

test("every block category has at least one case, and no others are used", () => {
  const used = new Set(cases.block.map((c) => c.category));
  assert.deepEqual([...used].sort(), [...BLOCK_CATEGORIES].sort());
});

test("allow cases include in-game violence, so a keyword filter on 'kill' fails", () => {
  const gameViolence = cases.allow.filter((c) => c.category === "game-violence");
  assert.ok(gameViolence.some((c) => /kill/i.test(c.text)));
  assert.ok(
    cases.block.some((c) => /kill/i.test(c.text)),
    "and a block case uses it too",
  );
});

test("no text appears twice, within or across lists", () => {
  const all = [...cases.block, ...cases.allow, ...cases.review].map((c) => c.text.toLowerCase());
  assert.equal(new Set(all).size, all.length);
});

test("review cases explain why they're borderline", () => {
  for (const c of cases.review) assert.ok(c.why?.length > 0, c.text);
});

test("the fake model's unsafe mode uses exactly the block cases", () => {
  assert.deepEqual(
    FAKE_LINES.unsafe,
    cases.block.map((c) => c.text),
  );
});
