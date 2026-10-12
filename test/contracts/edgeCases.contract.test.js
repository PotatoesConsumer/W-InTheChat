/**
 * W07 contract suite: the proposal's edge cases, run against every registered real
 * pipeline and output filter (implementations.js). Shows as TODO until something is
 * registered. Rules and expected outcomes: docs/pipeline-contract.md ("Edge cases").
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pipelines, filters } from "./implementations.js";
import { runChecks } from "../../src/harness/checks.js";
import { runScenario } from "../../src/harness/runner.js";
import { loadScenario } from "../../src/harness/load.js";
import { createFakeGenerator } from "../../src/harness/fakeGenerator.js";

/**
 * Proposal edge case -> how it's produced. Every check must pass in each.
 * A registered pipeline may list cases it doesn't handle yet in `pending` (id -> reason);
 * those show as TODO with the reason instead of failing.
 */
const EDGE_CASES = [
  { id: "slow", title: "slow model: falls back within the timeout", mode: "slow", speed: 20 },
  { id: "down", title: "model down: falls back", mode: "error", speed: 20 },
  {
    id: "garbage",
    title: "malformed model output never reaches chat as-is",
    mode: "garbage",
    speed: 20,
  },
  { id: "unsafe", title: "unsafe model output is blocked and replaced", mode: "unsafe", speed: 20 },
  {
    id: "burst",
    title: "event bursts are coalesced and rate-limited",
    scenario: "burst",
    speed: 1,
  },
  {
    id: "bad-input",
    title: "empty and oversized player input gets no reply",
    scenario: "player-chat",
    speed: 20,
  },
  {
    id: "malformed",
    title: "malformed events are dropped, the next one still works",
    scenario: "malformed",
    speed: 20,
  },
];
const EDGE_CASE_IDS = new Set(EDGE_CASES.map((c) => c.id));

const safety = JSON.parse(
  await readFile(new URL("../../eval/safety-cases-v1.json", import.meta.url), "utf8"),
);

if (pipelines.length === 0) {
  describe("edge-case contract (no pipeline registered yet)", () => {
    for (const c of EDGE_CASES) test.todo(c.title);
  });
}

for (const impl of pipelines) {
  describe(`edge-case contract: ${impl.name}`, () => {
    const pending = impl.pending ?? {};
    test("pending lists only known edge cases", () => {
      assert.deepEqual(
        Object.keys(pending).filter((id) => !EDGE_CASE_IDS.has(id)),
        [],
        `known ids: ${[...EDGE_CASE_IDS].join(", ")}`,
      );
    });
    for (const c of EDGE_CASES) {
      if (Object.hasOwn(pending, c.id)) {
        test.todo(`${c.title} (pending: ${pending[c.id]})`);
        continue;
      }
      test(c.title, async () => {
        const { scenario } = await loadScenario(c.scenario ?? "basic-session");
        const record = await runScenario(scenario, {
          pipeline: impl.start,
          generator: createFakeGenerator({ mode: c.mode ?? "normal" }),
          speed: c.speed,
          settleMs: 11_000,
        });
        const failed = runChecks(record)
          .filter((r) => !r.ok)
          .map((r) => ({ check: r.name, violations: r.violations }));
        assert.deepEqual(failed, []);
      });
    }
  });
}

if (filters.length === 0) {
  describe("output filter contract (no filter registered yet)", () => {
    test.todo(`blocks all ${safety.block.length} block cases (threats, self-harm, attacks, …)`);
    test.todo(
      `allows all ${safety.allow.length} allow cases (play criticism, in-game violence, …)`,
    );
  });
}

for (const filter of filters) {
  describe(`output filter contract: ${filter.name}`, () => {
    test("blocks every block case", async () => {
      const missed = [];
      for (const c of safety.block) {
        if ((await filter.check(c.text)).ok) missed.push(`[${c.category}] ${c.text}`);
      }
      assert.deepEqual(missed, [], "the filter let these through");
    });

    test("allows every allow case", async () => {
      const blocked = [];
      for (const c of safety.allow) {
        const result = await filter.check(c.text);
        if (!result.ok) blocked.push(`[${c.category}] ${c.text} (${result.reason ?? "no reason"})`);
      }
      assert.deepEqual(blocked, [], "the filter over-blocked these");
    });
  });
}
