/**
 * Plays the fixed evaluation event set (docs/evaluation.md) into the registered chat
 * pipeline in both conditions, with the real model for ai, at real time, and saves each
 * run record. The blind rating sheet is made from these (`npm run study:rating-sheet`).
 *
 *   npm run eval:runs                                  seeds 1 and 2, both conditions
 *   npm run eval:runs -- --seeds 1,2,3 --out study-logs/eval-runs
 *   npm run eval:runs -- --fake --speed max            try it without Ollama
 *
 * Each record notes the event set's sha256, the code version (git commit: the prompt
 * version) and the model, which the evaluation report has to state.
 */

import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipelines } from "../test/contracts/implementations.js";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { loadScenario } from "../src/harness/load.js";
import { runScenario } from "../src/harness/runner.js";
import { runChecks } from "../src/harness/checks.js";
import { createFakeGenerator } from "../src/harness/fakeGenerator.js";
import { PIPELINE_DEFAULTS } from "../src/service/pipeline.js";
import { warmUp } from "./lib/serviceTools.js";

const { values } = parseArgs({
  options: {
    set: { type: "string", default: "eval/event-set-v1.json" },
    seeds: { type: "string", default: "1,2" },
    out: { type: "string", default: "study-logs/eval-runs" },
    fake: { type: "boolean", default: false },
    speed: { type: "string", default: "1" },
  },
});

const seeds = values.seeds.split(",").map(Number);
if (seeds.some((s) => !Number.isInteger(s))) throw new Error("--seeds: whole numbers, e.g. 1,2");
const speed = values.speed === "max" ? Infinity : Number(values.speed);
if (!values.fake && speed !== 1) throw new Error("real-model runs play at real time (--speed 1)");

const { scenario, sha256 } = await loadScenario(values.set);
let version = "unknown";
try {
  version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Not a git checkout: the report then has to name the version some other way.
}

let generator;
let model;
if (values.fake) {
  generator = createFakeGenerator({ mode: "normal" });
  model = "fake (normal)";
} else {
  const client = new OllamaClient();
  await warmUp(client);
  generator = client;
  model = client.model;
}

const [registered] = pipelines;
await mkdir(values.out, { recursive: true });
console.log(
  `${scenario.name}: ${scenario.steps.length} steps, sha256 ${sha256.slice(0, 12)}…, ` +
    `version ${version}, model ${model}`,
);

for (const seed of seeds) {
  for (const condition of ["ai", "scripted"]) {
    const record = await runScenario(scenario, {
      pipeline: registered.start,
      generator,
      condition,
      seed,
      speed,
      settleMs: PIPELINE_DEFAULTS.replyTimeoutMs + 2_000,
    });
    record.scenario.file = { path: values.set, sha256 };
    record.version = version;
    record.model = condition === "ai" ? model : null;
    const checks = runChecks(record);
    const file = join(values.out, `${scenario.name}-${condition}-seed${seed}.json`);
    await writeFile(file, `${JSON.stringify({ ...record, checks }, null, 2)}\n`);
    const sources = record.messages.reduce((acc, { message }) => {
      if (message.done) acc[message.source] = (acc[message.source] ?? 0) + 1;
      return acc;
    }, {});
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    console.log(
      `${condition.padEnd(8)} seed ${seed}: ${JSON.stringify(sources)}` +
        `${failed.length ? `  checks failed: ${failed.join(", ")}` : ""}  -> ${file}`,
    );
  }
}
