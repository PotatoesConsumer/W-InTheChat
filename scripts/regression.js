/**
 * Full regression pass (W08): lint, format and unit tests; every scenario under every
 * fake-model mode and both conditions through the real pipeline; the cross-run
 * comparisons; and, with --model, the evaluation set through the real model. Writes a
 * Markdown report and exits 1 if it found a regression. Guide: docs/regression/README.md.
 *
 *   npm run regression
 *   npm run regression -- --model
 *   npm run regression -- --skip-static --out my-report.md
 *
 * Tests whatever is registered in test/contracts/implementations.js, so it always covers
 * the team's current pipeline and stats model, and knows their pending edge cases.
 */

import { parseArgs } from "node:util";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { platform, release } from "node:os";
import { pipelines, statsModels } from "../test/contracts/implementations.js";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { loadScenario, listScenarios } from "../src/harness/load.js";
import { runScenario } from "../src/harness/runner.js";
import { createFakeGenerator } from "../src/harness/fakeGenerator.js";
import { runChecks, compareRuns } from "../src/harness/checks.js";
import { summarize, finalMessages } from "../src/harness/report.js";
import {
  buildMatrix,
  summarizeRun,
  hasRegressions,
  formatRegressionReport,
} from "../src/harness/regression.js";
import { warmUp } from "./lib/serviceTools.js";

const EVAL_SET = "eval/event-set-v1.json";
const SETTLE_MS = 11_000;
const run = promisify(execFile);

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "boolean", default: false },
      "skip-static": { type: "boolean", default: false },
      out: { type: "string" },
    },
  });
  if (pipelines.length === 0) fail("No pipeline registered in test/contracts/implementations.js");
  const pipeline = pipelines[0];
  const stats = statsModels[0];
  const env = await environment();
  const out = resolve(values.out ?? `docs/regression/${env.date}.md`);

  const report = {
    env,
    pipeline: pipeline.name,
    static: values["skip-static"] ? [] : await staticChecks(),
    runs: [],
    comparisons: [],
  };

  const scenarios = [...(await listScenarios()), EVAL_SET];
  const loaded = new Map();
  for (const name of scenarios) loaded.set(name, (await loadScenario(name)).scenario);
  const play = (r, generator, seed = 1) =>
    runScenario(loaded.get(r.scenario), {
      pipeline: pipeline.start,
      generator,
      condition: r.condition,
      speed: r.speed,
      settleMs: SETTLE_MS,
      seed,
      stats,
    });

  const matrix = buildMatrix(scenarios);
  const records = new Map();
  for (const [i, r] of matrix.entries()) {
    const record = await play(r, createFakeGenerator({ mode: r.mode }));
    const result = summarizeRun(r, record, runChecks(record), pipeline.pending);
    records.set(`${r.scenario}|${r.condition}|${r.mode}`, record);
    report.runs.push(result);
    log(`[${i + 1}/${matrix.length}] ${r.scenario} ${r.condition} ${r.mode}: ${result.verdict}`);
  }

  for (const scenario of scenarios) {
    const get = (mode) => records.get(`${scenario}|ai|${mode}`);
    const r = buildMatrix([scenario]).find((m) => m.condition === "ai" && m.mode === "normal");
    const again = await play(r, createFakeGenerator());
    const pairs = [
      ["same-choices", get("normal"), again],
      ["persona-independent-of-model", get("normal"), get("garbage")],
      ["same-stats", get("normal"), get("unsafe")],
    ];
    for (const [name, a, b] of pairs) {
      const [c] = compareRuns(a, b, { only: [name] });
      report.comparisons.push({ name, scenario, ok: c.ok, detail: c.violations[0]?.message });
    }
    log(`compared ${scenario}`);
  }

  if (values.model) report.model = await modelRun(pipeline, stats, loaded.get(EVAL_SET), env);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, formatRegressionReport(report));
  const regressions = hasRegressions(report);
  log(`\n${regressions ? "Regressions found" : "No regressions"}. Report: ${out}`);
  if (regressions) process.exitCode = 1;
}

/** Lint, format check and the unit tests, as separate rows. */
async function staticChecks() {
  log("static checks...");
  const node = process.execPath;
  const lint = await exec(node, ["node_modules/eslint/bin/eslint.js", "."]);
  const format = await exec(node, ["node_modules/prettier/bin/prettier.cjs", "--check", "."]);
  const tests = await exec(node, ["--test"]);

  const count = (key) => Number(tests.output.match(new RegExp(`^# ${key} (\\d+)`, "m"))?.[1] ?? 0);
  const failing = [...tests.output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return [
    {
      name: "Lint (ESLint)",
      ok: lint.code === 0,
      detail: lint.code === 0 ? "clean" : lastLine(lint.output),
    },
    {
      name: "Format (Prettier)",
      ok: format.code === 0,
      detail: format.code === 0 ? "clean" : lastLine(format.output),
    },
    {
      name: "Unit and contract tests",
      ok: tests.code === 0,
      detail:
        `${count("pass")} pass, ${count("fail")} fail, ${count("todo")} todo` +
        (failing.length ? `; failing: ${failing.slice(0, 5).join("; ")}` : ""),
    },
  ];
}

/** The evaluation set at real-time speed through the real pipeline and model. */
async function modelRun(pipeline, stats, scenario, env) {
  const client = new OllamaClient();
  // warmUp() exits the process when Ollama is missing; check first so the rest of the
  // report is still written.
  const health = await client.health();
  if (!health.ok || !health.hasDefaultModel) {
    const reason = health.ok
      ? `${client.model} isn't pulled (ollama pull ${client.model})`
      : `Ollama isn't running (${health.reason})`;
    log(`real model skipped: ${reason}`);
    return { skipped: reason };
  }
  await warmUp(client);
  log(
    `real model: ${scenario.name} at real-time speed (about ${Math.ceil(scenario.steps.at(-1).at / 1000)} s)...`,
  );
  const record = await runScenario(scenario, {
    pipeline: pipeline.start,
    generator: client,
    speed: 1,
    settleMs: SETTLE_MS,
    stats,
  });

  const events = new Map(record.events.map((e) => [e.id, e]));
  const samples = finalMessages(record)
    .map((m) => m.message)
    .filter((m) => m.source === "ai")
    .slice(0, 8)
    .map((m) => {
      const e = events.get(m.eventId)?.event;
      const trigger = e?.kind === "chat" ? `player: "${e.text}"` : (e?.name ?? m.eventId);
      return { trigger, persona: m.persona, text: m.text };
    });

  return {
    scenario: scenario.name,
    checks: runChecks(record),
    summary: summarize(record),
    samples,
    hardwareNote: /4050/.test(env.gpu)
      ? "Measured on the target laptop (RTX 4050)."
      : `Measured on ${env.gpu}, not the RTX 4050 the proposal targets. Indicative only: ` +
        "don't report these numbers as the project's latency (that's the W08/W09 pilot).",
  };
}

async function environment() {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const sha = await text("git", ["rev-parse", "--short", "HEAD"]);
  const dirty = (await text("git", ["status", "--porcelain"])) ? " (with uncommitted changes)" : "";
  const gpu =
    (await text("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"])) || "unknown GPU";
  const client = new OllamaClient();
  const health = await client.health();
  const ollama = health.ok
    ? `${client.model}${health.hasDefaultModel ? "" : " (not pulled)"}`
    : `${client.model} (Ollama not running)`;
  return {
    date,
    commit: `${sha || "unknown"}${dirty}`,
    node: process.version,
    os: `${platform()} ${release()}`,
    gpu,
    ollama,
  };
}

function exec(cmd, args) {
  return new Promise((resolveExec) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolveExec({ code, output }));
  });
}

async function text(cmd, args) {
  try {
    return (await run(cmd, args)).stdout.trim().split("\n")[0].trim();
  } catch {
    return "";
  }
}

function lastLine(output) {
  return output.trim().split("\n").at(-1).replace(/\|/g, "\\|");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function log(message) {
  console.error(message);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
