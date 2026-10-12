import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  percentile,
  latencies,
  summarize,
  finalMessages,
  formatRun,
} from "../../src/harness/report.js";

const msg = (id, eventId, done, extra = {}) => ({
  id,
  eventId,
  done,
  persona: "fan",
  source: "ai",
  viewer: "v",
  text: "t",
  ...extra,
});

const record = {
  scenario: { name: "r", description: "" },
  condition: "ai",
  seed: 1,
  events: [
    {
      seq: 0,
      id: "e1",
      t: 100,
      accepted: true,
      importance: "major",
      event: { kind: "game", name: "win", data: {} },
    },
    {
      seq: 1,
      id: "e2",
      t: 200,
      accepted: false,
      errors: [{ path: "text", message: "must not be empty" }],
    },
    { seq: 2, id: "e3", t: 300, accepted: true, event: { kind: "chat", text: "hi" } },
  ],
  messages: [
    { seq: 3, t: 150, message: msg("m1", "e1", false) },
    { seq: 4, t: 400, message: msg("m1", "e1", true) },
    { seq: 5, t: 320, message: msg("m2", "e3", true, { source: "template", persona: "hater" }) },
  ],
  generatorCalls: [{ outcome: "ok" }, { outcome: "error" }],
  handlerErrors: [],
  lateMessages: 0,
};

test("percentile uses nearest rank", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
});

test("latencies measure from the event to first text and to done", () => {
  assert.deepEqual(latencies(record), { firstText: [50, 20], completion: [300, 20] });
});

test("finalMessages keeps the last update per message id", () => {
  assert.deepEqual(
    finalMessages(record).map((m) => [m.message.id, m.message.done]),
    [
      ["m1", true],
      ["m2", true],
    ],
  );
});

test("summarize counts events, final messages and generator outcomes", () => {
  const s = summarize(record);
  assert.deepEqual(s.events, { published: 3, accepted: 2, rejected: 1 });
  assert.deepEqual(s.messages.bySource, { ai: 1, template: 1 });
  assert.deepEqual(s.messages.byPersona, { fan: 1, hater: 1 });
  assert.deepEqual(s.generator.byOutcome, { ok: 1, error: 1 });
  assert.deepEqual(s.latency.completion, { n: 2, p50: 20, p95: 300 });
});

test("formatRun prints the timeline and the summary", () => {
  const text = formatRun(record);
  assert.match(text, /▶ win \[major\]/);
  assert.match(text, /✗ e2 rejected \(text: must not be empty\)/);
  assert.match(text, /← \[hater\/template\] v: "t"/);
  assert.match(text, /--- Summary ---/);
});

test("formatRun lists check results when given", () => {
  const text = formatRun(record, {
    checks: [
      { name: "ok-check", ok: true, violations: [] },
      { name: "bad-check", ok: false, violations: [{ message: "something broke" }] },
    ],
  });
  assert.match(text, /Checks: 1\/2 passed/);
  assert.match(text, /FAIL {2}bad-check\n {10}- something broke/);
});

test("the CLI runs a bundled scenario end to end", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "scripts/harness.js",
    "malformed",
    "--speed",
    "max",
  ]);
  assert.match(stdout, /Scenario: malformed/);
  assert.match(stdout, /10 published, 1 accepted, 9 rejected/);
});

test("the CLI rejects bad options with exit code 2", async () => {
  await assert.rejects(
    promisify(execFile)(process.execPath, ["scripts/harness.js", "malformed", "--speed", "0"]),
    (err) => err.code === 2 && /--speed must be/.test(err.stderr),
  );
});
