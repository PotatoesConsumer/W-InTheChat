/**
 * W06 contract suite: the deterministic checks, run against every registered real
 * pipeline and stats model (implementations.js) on every bundled scenario and the
 * evaluation set, in both conditions. Shows as TODO until something is registered.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pipelines, statsModels } from "./implementations.js";
import { CHECKS, COMPARISONS, runChecks, compareRuns } from "../../src/harness/checks.js";
import { runScenario } from "../../src/harness/runner.js";
import { loadScenario, listScenarios } from "../../src/harness/load.js";
import { createFakeGenerator } from "../../src/harness/fakeGenerator.js";

const SCENARIOS = [...(await listScenarios()), "eval/event-set-v1.json"];
const CONDITIONS = ["ai", "scripted"];
const RUN = { speed: 50, settleMs: 11_000 };

const loaded = new Map();
for (const name of SCENARIOS) loaded.set(name, (await loadScenario(name)).scenario);

function failed(results) {
  return results.filter((r) => !r.ok).map((r) => ({ check: r.name, violations: r.violations }));
}

if (pipelines.length === 0) {
  describe("pipeline contract (no pipeline registered yet)", () => {
    for (const c of [...CHECKS, ...COMPARISONS].filter(
      (c) => !c.group && !c.name.includes("stats"),
    )) {
      test.todo(`${c.name}: ${c.description}`);
    }
  });
}

for (const impl of pipelines) {
  describe(`pipeline contract: ${impl.name}`, () => {
    for (const name of SCENARIOS) {
      for (const condition of CONDITIONS) {
        test(`${name} (${condition}) passes every check`, async () => {
          const record = await runScenario(loaded.get(name), {
            ...RUN,
            pipeline: impl.start,
            condition,
            generator: createFakeGenerator(),
          });
          assert.deepEqual(failed(runChecks(record)), []);
        });
      }
    }

    test("same seed, same model output: same chat", async () => {
      const run = () =>
        runScenario(loaded.get("basic-session"), {
          ...RUN,
          pipeline: impl.start,
          seed: 11,
          generator: createFakeGenerator(),
        });
      const results = compareRuns(await run(), await run(), { only: ["same-choices"] });
      assert.deepEqual(failed(results), []);
    });

    test("the persona answering an event doesn't depend on the model's output", async () => {
      const run = (mode) =>
        runScenario(loaded.get("basic-session"), {
          ...RUN,
          pipeline: impl.start,
          generator: createFakeGenerator({ mode }),
        });
      const results = compareRuns(await run("normal"), await run("garbage"), {
        only: ["persona-independent-of-model"],
      });
      assert.deepEqual(failed(results), []);
    });
  });
}

if (statsModels.length === 0) {
  describe("stats contract (no stats model registered yet)", () => {
    test.todo("stats-valid: stats are finite, non-negative numbers after every event");
    test.todo("same-stats: the same events give the same stats, whatever the model said");
  });
}

for (const model of statsModels) {
  describe(`stats contract: ${model.name}`, () => {
    const run = (mode) =>
      runScenario(loaded.get("eval/event-set-v1.json"), {
        speed: Infinity,
        settleMs: 2_000,
        stats: model,
        generator: createFakeGenerator({ mode, delayMs: 0 }),
      });

    test("stats stay valid through the evaluation set", async () => {
      assert.deepEqual(failed(runChecks(await run("normal"), { only: ["stats-valid"] })), []);
    });

    test("the model's output never changes the stats", async () => {
      const results = compareRuns(await run("normal"), await run("unsafe"), {
        only: ["same-stats"],
      });
      assert.deepEqual(failed(results), []);
    });
  });
}
