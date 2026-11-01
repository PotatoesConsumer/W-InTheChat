/**
 * Laptop pilot (W08): the wave shooter played by a bot (src/harness/shooterBot.js) goes
 * into the registered pipeline at real time with the real model, while nvidia-smi samples
 * the GPU. Prints what the limits in PIPELINE_DEFAULTS are set from: event rate, reply
 * latency p50/p95, reply length against maxTokens, fallbacks, chat rate and peak GPU
 * memory. Needs Ollama with qwen2.5:3b. Guide and results: docs/pilot-w08.md.
 *
 *   npm run pilot
 *   npm run pilot -- --minutes 5 --skill 0.9 --seed 3
 *   npm run pilot -- --set maxTokens=32 --set replyTimeoutMs=3000
 *   npm run pilot -- --out pilot-run.md
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pipelines, statsModels } from "../test/contracts/implementations.js";
import { PIPELINE_DEFAULTS } from "../src/service/pipeline.js";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { parseScenario } from "../src/harness/scenario.js";
import { runScenario } from "../src/harness/runner.js";
import { runChecks } from "../src/harness/checks.js";
import { summarize as summarizeRun } from "../src/harness/report.js";
import { summarize } from "../src/service/latency.js";
import { checkReply } from "../src/service/replyCheck.js";
import { parseChatLine } from "../src/ai/personas/parse.js";
import { playShooter } from "../src/harness/shooterBot.js";
import { warmUp } from "./lib/serviceTools.js";

const USAGE = `Usage: npm run pilot -- [options]

Options:
  --minutes <n>      game time the bot plays (default 3)
  --seed <n>         game and bot seed (default 1)
  --skill <0-1>      bot skill (default 0.6)
  --chat-every <s>   a player message this often, 0 for none (default 25)
  --set key=value    override a numeric PIPELINE_DEFAULTS limit (repeatable)
  --out <file>       also write the report to this file`;

async function main() {
  const { values } = parseArgs({
    options: {
      minutes: { type: "string", default: "3" },
      seed: { type: "string", default: "1" },
      skill: { type: "string", default: "0.6" },
      "chat-every": { type: "string", default: "25" },
      set: { type: "string", multiple: true, default: [] },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return console.log(USAGE);

  const overrides = {};
  for (const pair of values.set) {
    const [key, raw] = pair.split("=");
    const value = Number(raw);
    if (!Object.hasOwn(PIPELINE_DEFAULTS, key) || typeof PIPELINE_DEFAULTS[key] !== "number") {
      fail(`--set: "${key}" isn't a numeric PIPELINE_DEFAULTS limit`);
    }
    if (!Number.isFinite(value)) fail(`--set ${key}: "${raw}" isn't a number`);
    overrides[key] = value;
  }
  const limits = { ...PIPELINE_DEFAULTS, ...overrides };

  const trace = playShooter({
    seed: Number(values.seed),
    skill: Number(values.skill),
    durationMs: Number(values.minutes) * 60_000,
    chatEveryMs: Number(values["chat-every"]) * 1000,
  });
  const scenario = parseScenario({
    name: trace.name,
    description: trace.description,
    steps: trace.steps,
  });

  const client = new OllamaClient();
  await warmUp(client);
  const vram = await modelVram(client);

  const [registered] = pipelines;
  let handle = null;
  const pipeline = (bus, emit, deps) => {
    handle = registered.start(bus, emit, { ...deps, ...overrides });
    return handle;
  };
  const tokens = [];
  const rejected = []; // replies the reply check or the safety filter turned down
  const generator = {
    async generate(prompt, opts) {
      const result = await client.generate(prompt, opts);
      tokens.push(result.evalTokens);
      const line = parseChatLine(result.text);
      const check = checkReply(line);
      if (!check.ok) rejected.push({ reason: check.category ?? check.reason, text: line });
      return result;
    },
  };

  console.log(
    `Playing ${scenario.steps.length} events over ${values.minutes} min at real time ` +
      `(seed ${values.seed}, skill ${values.skill})...`,
  );
  const gpu = sampleGpu();
  const record = await runScenario(scenario, {
    pipeline,
    generator,
    stats: statsModels[0],
    seed: Number(values.seed),
    speed: 1,
    settleMs: limits.replyTimeoutMs + 2_000,
  });
  const gpuSamples = await gpu.stop();

  const report = formatReport({
    values,
    overrides,
    limits,
    trace,
    record,
    stats: handle.stats(),
    checks: runChecks(record),
    tokens,
    rejected,
    gpuSamples,
    vram,
  });
  console.log(`\n${report}`);
  if (values.out) await writeFile(values.out, `${report}\n`);
}

/** VRAM the loaded model takes, from Ollama's /api/ps (null if it doesn't say). */
async function modelVram(client) {
  try {
    const res = await fetch(`${client.host}/api/ps`);
    const { models = [] } = await res.json();
    const mine = models.find((m) => m.name === client.model || m.model === client.model);
    return mine?.size_vram ?? null;
  } catch {
    return null;
  }
}

/** Samples GPU memory and use every 250 ms with nvidia-smi, until stop(). */
function sampleGpu() {
  const samples = [];
  let proc = null;
  try {
    proc = spawn("nvidia-smi", [
      "--query-gpu=memory.used,memory.total,utilization.gpu",
      "--format=csv,noheader,nounits",
      "-lms",
      "250",
    ]);
    proc.on("error", () => (proc = null));
    let buffer = "";
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const [used, total, util] = line.split(",").map((v) => Number(v.trim()));
        if (Number.isFinite(used)) samples.push({ used, total, util });
      }
    });
  } catch {
    proc = null;
  }
  return {
    async stop() {
      proc?.kill();
      return samples;
    },
  };
}

function formatReport({
  values,
  overrides,
  limits,
  trace,
  record,
  stats,
  checks,
  tokens,
  rejected,
  gpuSamples,
  vram,
}) {
  const run = summarizeRun(record);
  const minutes = trace.summary.durationMs / 60_000;
  const accepted = record.events.filter((e) => e.accepted);
  const majors = accepted.filter((e) => e.importance === "major").length;
  const chats = accepted.filter((e) => e.kind === "chat").length;
  const minors = accepted.filter((e) => e.importance === "minor").length;

  const callMs = record.generatorCalls
    .filter((c) => c.end !== null)
    .map((c) => Math.round(c.end - c.start));
  const ai = stats.latency.bySource.ai?.completion;
  const words = record.messages
    .filter((m) => m.message.done && m.message.source === "ai")
    .map((m) => m.message.text.split(/\s+/).length);
  const capped = tokens.filter((n) => n >= limits.maxTokens).length;
  const peakPerSecond = peakWindow(
    [...new Set(record.messages.map((m) => m.message.id))].map(
      (id) => record.messages.find((m) => m.message.id === id).t,
    ),
    1_000,
  );
  const failed = checks.filter((c) => !c.ok);
  const ran = checks.filter((c) => !c.skipped);
  const used = gpuSamples.map((s) => s.used);
  const util = gpuSamples.map((s) => s.util);
  const mib = (bytes) => (bytes === null ? "unknown" : `${Math.round(bytes / 2 ** 20)} MiB`);
  const fmt = (s) => (s && s.n ? `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} (n=${s.n})` : "none");

  return [
    `## Pilot run: seed ${values.seed}, skill ${values.skill}, ${values.minutes} min`,
    "",
    `Limits: ${
      Object.keys(overrides).length
        ? Object.entries(overrides)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "PIPELINE_DEFAULTS"
    } (replyTimeoutMs ${limits.replyTimeoutMs}, maxTokens ${limits.maxTokens}, maxMessagesPerSecond ${limits.maxMessagesPerSecond}).`,
    "",
    "| What | Result |",
    "|------|--------|",
    `| Events | ${accepted.length} (${(accepted.length / minutes).toFixed(1)}/min): ${majors} major, ${chats} player messages, ${minors} minor; best wave ${trace.summary.bestWave} |`,
    `| Model calls | ${callMs.length} (${(callMs.length / minutes).toFixed(1)}/min); call time ms ${fmt(summarize(callMs))} |`,
    `| AI replies, event to reply shown (ms) | ${fmt(ai)} |`,
    `| Replies by source | ${Object.entries(stats.replies)
      .filter(([, n]) => n)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}; coalesced ${stats.coalesced} |`,
    `| Failures | ${
      Object.entries(stats.failures)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ") || "none"
    } |`,
    `| Personas | ${Object.entries(run.messages.byPersona)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")} |`,
    `| AI reply length (words) | ${fmt(summarize(words))} |`,
    `| Tokens per reply | ${fmt(summarize(tokens))}; ${capped} of ${tokens.length} hit maxTokens |`,
    `| Peak new messages in 1 s | ${peakPerSecond} |`,
    `| GPU memory used (MiB) | ${used.length ? `${fmt(summarize(used))} of ${gpuSamples[0].total}` : "no nvidia-smi samples"}; model ${mib(vram)} |`,
    `| GPU use (%) | ${util.length ? fmt(summarize(util)) : "no samples"} |`,
    `| Checks | ${ran.length - failed.length}/${ran.length} pass${failed.length ? `; FAIL: ${failed.map((c) => c.name).join(", ")}` : ""} |`,
    "",
    rejected.length
      ? `Rejected model replies (a fallback was shown instead):\n\n${rejected.map((r) => `- ${r.reason}: "${r.text}"`).join("\n")}`
      : "No model reply was rejected.",
  ].join("\n");
}

function peakWindow(times, windowMs) {
  const sorted = [...times].sort((a, b) => a - b);
  let peak = 0;
  for (let i = 0, j = 0; j < sorted.length; j++) {
    while (sorted[j] - sorted[i] >= windowMs) i++;
    peak = Math.max(peak, j - i + 1);
  }
  return peak;
}

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

main().catch((err) => {
  console.error("Pilot failed:", err.message);
  process.exit(1);
});
