/**
 * Mock-event harness CLI: plays a scenario into a pipeline, headless, and prints what
 * the chat did. No game, no browser, no Ollama. Guide: docs/harness.md.
 *
 *   npm run harness -- --list
 *   npm run harness -- basic-session
 *   npm run harness -- player-chat --mode garbage --speed max
 *   npm run harness -- path/to/scenario.json --pipeline src/service/pipeline.js --json
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenario, listScenarios } from "../src/harness/load.js";
import { runScenario } from "../src/harness/runner.js";
import { createFakeGenerator, FAKE_MODES } from "../src/harness/fakeGenerator.js";
import { formatRun } from "../src/harness/report.js";

const USAGE = `Usage: npm run harness -- <scenario | file.json> [options]

Options:
  --mode <m>         fake model behavior: ${FAKE_MODES.join(" | ")} (default normal)
  --condition <c>    ai | scripted, passed to the pipeline (default ai)
  --pipeline <file>  module exporting the pipeline (default export or "start");
                     defaults to the naive harness stub
  --speed <n|max>    playback speed, max = no waiting between steps (default 1)
  --seed <n>         seed for the pipeline's random choices (default 1)
  --settle <ms>      longest wait for in-flight replies at the end (default 10500)
  --json             print the full run record as JSON
  --list             list bundled scenarios`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: "string", default: "normal" },
      condition: { type: "string", default: "ai" },
      pipeline: { type: "string" },
      speed: { type: "string", default: "1" },
      seed: { type: "string", default: "1" },
      settle: { type: "string", default: "10500" },
      json: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) return console.log(USAGE);
  if (values.list || positionals.length === 0) {
    console.log(`Bundled scenarios: ${(await listScenarios()).join(", ")}\n\n${USAGE}`);
    return;
  }
  if (!["ai", "scripted"].includes(values.condition)) fail("--condition must be ai or scripted");

  const speed = values.speed === "max" ? Infinity : Number(values.speed);
  const seed = Number(values.seed);
  const settleMs = Number(values.settle);
  if (!(speed > 0)) fail("--speed must be a positive number or max");
  if (!Number.isInteger(seed)) fail("--seed must be an integer");
  if (!(settleMs >= 0)) fail("--settle must be a non-negative number");

  const { scenario, path, sha256 } = await loadScenario(positionals[0]);
  const record = await runScenario(scenario, {
    pipeline: values.pipeline ? await loadPipeline(values.pipeline) : undefined,
    generator: createFakeGenerator({ mode: values.mode }),
    condition: values.condition,
    seed,
    speed,
    settleMs,
  });
  record.scenario.file = { path, sha256 };
  record.generatorMode = values.mode;

  console.log(values.json ? JSON.stringify(record, null, 2) : formatRun(record));
}

async function loadPipeline(file) {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const start = mod.default ?? mod.start;
  if (typeof start !== "function") {
    fail(`${file} must export the pipeline as its default export or as "start"`);
  }
  return start;
}

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
