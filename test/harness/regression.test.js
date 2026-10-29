import { test } from "node:test";
import assert from "node:assert/strict";
import { FAKE_MODES } from "../../src/harness/fakeGenerator.js";
import { EDGE_CASES, pendingFor } from "../../src/harness/edgeCases.js";
import {
  buildMatrix,
  verdict,
  summarizeRun,
  hasRegressions,
  formatRegressionReport,
} from "../../src/harness/regression.js";

test("the matrix covers every mode in the AI condition and scripted once per scenario", () => {
  const matrix = buildMatrix(["basic-session", "burst"]);
  assert.equal(matrix.length, 2 * (FAKE_MODES.length + 1));
  assert.deepEqual(
    matrix.filter((r) => r.condition === "scripted").map((r) => [r.scenario, r.mode]),
    [
      ["basic-session", "normal"],
      ["burst", "normal"],
    ],
  );
  assert.ok(matrix.filter((r) => r.scenario === "burst").every((r) => r.speed === 1));
  assert.ok(matrix.filter((r) => r.scenario !== "burst").every((r) => r.speed > 1));
});

test("pendingFor matches an edge case by its scenario and mode", () => {
  const pending = { unsafe: "no filter yet", burst: "no coalescing yet" };
  assert.deepEqual(pendingFor({ scenario: "eval", mode: "unsafe" }, pending), [
    { id: "unsafe", reason: "no filter yet" },
  ]);
  assert.deepEqual(
    pendingFor({ scenario: "burst", mode: "normal" }, pending).map((p) => p.id),
    ["burst"],
  );
  assert.deepEqual(pendingFor({ scenario: "basic-session", mode: "normal" }, pending), []);
  assert.deepEqual(pendingFor({ scenario: "burst", mode: "unsafe" }, {}), []);
});

test("every edge case has an id, a title and a positive speed", () => {
  const ids = EDGE_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of EDGE_CASES) assert.ok(c.title && c.speed > 0, c.id);
});

const ok = [{ name: "routing", ok: true }];
const bad = [{ name: "unsafe-blocked", ok: false, violations: [{ message: "m1: shows it" }] }];

test("verdict: pass, fail, known gap, or ready to unblock", () => {
  const unsafeRun = { scenario: "basic-session", mode: "unsafe" };
  const pending = { unsafe: "no filter yet" };
  assert.equal(verdict({ scenario: "basic-session", mode: "normal" }, ok, pending).verdict, "pass");
  assert.equal(verdict(unsafeRun, bad, {}).verdict, "fail");
  assert.equal(verdict(unsafeRun, bad, pending).verdict, "known");
  assert.equal(verdict(unsafeRun, ok, pending).verdict, "unblock");
});

function record() {
  return {
    events: [{ id: "e1", t: 0, accepted: true }],
    messages: [
      {
        seq: 1,
        t: 40,
        message: { id: "m1", eventId: "e1", done: true, source: "ai", persona: "fan" },
      },
    ],
    generatorCalls: [{ outcome: "ok" }],
    handlerErrors: [],
    lateMessages: 0,
  };
}

function report(runs, extra = {}) {
  return {
    env: {
      date: "2026-10-29",
      commit: "abc1234",
      node: "v22",
      os: "win32",
      gpu: "RTX 4060",
      ollama: "qwen2.5:3b",
    },
    pipeline: "service pipeline",
    static: [{ name: "Lint", ok: true, detail: "clean" }],
    runs,
    comparisons: [{ name: "same-choices", scenario: "basic-session", ok: true }],
    ...extra,
  };
}

test("summarizeRun keeps the verdict, failing checks and latency", () => {
  const run = { scenario: "basic-session", condition: "ai", mode: "unsafe", speed: 20 };
  const r = summarizeRun(run, record(), bad, { unsafe: "no filter yet" });
  assert.equal(r.verdict, "known");
  assert.deepEqual(r.failed, ["unsafe-blocked"]);
  assert.deepEqual(r.violations, [{ check: "unsafe-blocked", first: ["m1: shows it"] }]);
  assert.deepEqual(r.completion, { n: 1, p50: 40, p95: 40 });
  assert.deepEqual(r.covering, [{ id: "unsafe", reason: "no filter yet" }]);
});

test("hasRegressions: failed runs, static checks, comparisons or model checks", () => {
  const pass = summarizeRun({ scenario: "s", mode: "normal" }, record(), ok, {});
  const fail = summarizeRun({ scenario: "s", mode: "unsafe" }, record(), bad, {});
  const known = summarizeRun({ scenario: "s", mode: "unsafe" }, record(), bad, { unsafe: "x" });

  assert.equal(hasRegressions(report([pass, known])), false);
  assert.equal(hasRegressions(report([fail])), true);
  assert.equal(hasRegressions(report([pass], { static: [{ ok: false }] })), true);
  assert.equal(hasRegressions(report([pass], { comparisons: [{ ok: false }] })), true);
  assert.equal(hasRegressions(report([pass], { model: { checks: [{ ok: false }] } })), true);
});

test("the report shows the result, known gaps with reasons, and regressions in detail", () => {
  const pass = summarizeRun(
    { scenario: "basic-session", condition: "ai", mode: "normal" },
    record(),
    ok,
    {},
  );
  const known = summarizeRun(
    { scenario: "basic-session", condition: "ai", mode: "unsafe" },
    record(),
    bad,
    { unsafe: "needs the filter" },
  );
  const fail = summarizeRun(
    { scenario: "burst", condition: "ai", mode: "unsafe" },
    record(),
    bad,
    {},
  );

  const clean = formatRegressionReport(report([pass, known]));
  assert.match(clean, /Result: ✅ no regressions/);
  assert.match(clean, /2 harness runs: 1 pass, 1 known gaps, 0 fail/);
  assert.match(clean, /\*\*unsafe\*\*: needs the filter \(1 runs\)/);
  assert.match(clean, /Not run\. Pass `--model`/);

  const broken = formatRegressionReport(report([pass, fail]));
  assert.match(broken, /Result: ❌ regressions found/);
  assert.match(
    broken,
    /### Regressions\n\n\*\*burst \/ ai \/ unsafe\*\*\n\n- `unsafe-blocked`: m1: shows it/,
  );
});

test("the report flags pending edge cases that now pass", () => {
  const unblocked = summarizeRun(
    { scenario: "basic-session", condition: "ai", mode: "unsafe" },
    record(),
    ok,
    { unsafe: "needs the filter" },
  );
  assert.match(
    formatRegressionReport(report([unblocked])),
    /### Ready to unblock\n\nEvery run covered by `unsafe` passed/,
  );
});

test("the real-model section includes the hardware note and samples", () => {
  const model = {
    scenario: "event-set-v1",
    checks: [{ name: "routing", ok: true }],
    summary: {
      messages: { bySource: { ai: 2 }, byPersona: { fan: 2 } },
      generator: { calls: 2, byOutcome: { ok: 2 } },
      latency: { completion: { n: 2, p50: 300, p95: 500 } },
    },
    samples: [{ trigger: "win", persona: "fan", text: "LETS GO" }],
    hardwareNote: "Measured on RTX 4060, not the RTX 4050.",
  };
  const text = formatRegressionReport(report([], { model }));
  assert.match(text, /Event to completed reply: p50 300 ms, p95 500 ms \(n=2\)/);
  assert.match(text, /> Measured on RTX 4060, not the RTX 4050\./);
  assert.match(text, /- \*win\* → \[fan\] LETS GO/);
});
