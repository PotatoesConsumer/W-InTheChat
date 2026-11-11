/**
 * Full pipeline benchmark (W09): the game in Chrome, played by the bot (`?bot=`), through
 * the real service and model, while nvidia-smi samples the GPU with the browser drawing.
 * Reads the service's own latency (event ts -> reply sent) at the end; the browser's
 * (send -> reply shown) is `witc.benchmark()` in the page's console.
 * Results and how to read them: docs/benchmark-w09.md.
 *
 *   npm run service                          (in another terminal)
 *   npm run dev                              (in another terminal)
 *   npm run benchmark -- --minutes 10        then open the URL it prints in Chrome
 *
 *   npm run benchmark -- --idle-test         model calls after 0-12 s idle, GPU clock
 */

import { parseArgs } from "node:util";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { buildPrompt } from "../src/ai/contextBuilder.js";
import { toContext } from "../src/events/context.js";
import { createGameEvent } from "../src/events/schema.js";
import { PIPELINE_DEFAULTS } from "../src/service/pipeline.js";
import { DEFAULT_SERVICE_URL } from "../src/service/client.js";
import { summarize } from "../src/service/latency.js";
import { warmUp } from "./lib/serviceTools.js";

const run = promisify(execFile);

const USAGE = `Usage: npm run benchmark -- [options]

Options:
  --minutes <n>    how long the bot plays (default 10)
  --skill <0-1>    bot skill in the URL (default 0.6)
  --seed <n>       bot seed in the URL (default 1)
  --service <url>  chat service (default ${DEFAULT_SERVICE_URL})
  --game <url>     the game (default http://localhost:5173)
  --idle-test      instead: model calls after 0, 1, 3, 6 and 12 s idle
  --calls <n>      calls per gap in --idle-test (default 8)
  --out <file>     also write the report to this file`;

async function main() {
  const { values } = parseArgs({
    options: {
      minutes: { type: "string", default: "10" },
      skill: { type: "string", default: "0.6" },
      seed: { type: "string", default: "1" },
      service: { type: "string", default: DEFAULT_SERVICE_URL },
      game: { type: "string", default: "http://localhost:5173" },
      "idle-test": { type: "boolean", default: false },
      calls: { type: "string", default: "8" },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return console.log(USAGE);

  const report = values["idle-test"] ? await idleTest(values) : await gameRun(values);
  console.log(`\n${report}`);
  if (values.out) await writeFile(values.out, `${report}\n`);
}

/** The bot plays in Chrome; this samples the GPU and reads the service's stats. */
async function gameRun(values) {
  const service = values.service.replace(/\/$/, "");
  const minutes = Number(values.minutes);
  if (!(minutes > 0)) fail("--minutes must be a positive number");

  const health = await fetchJson(`${service}/health`).catch(() => null);
  if (!health) fail(`No chat service at ${service}. Start it with: npm run service`);
  // Fresh stats: switching the condition restarts the pipeline.
  await postJson(`${service}/condition`, { condition: "scripted" });
  await postJson(`${service}/condition`, { condition: "ai" });

  const url = `${values.game}/stream.html?condition=ai&bot=${values.skill}&seed=${values.seed}&minutes=${minutes}`;
  console.log(`Stats reset. Open this in Chrome and keep the tab in front:\n\n  ${url}\n`);
  console.log("Waiting for the first reply...");
  const deadline = Date.now() + 5 * 60_000;
  while (totalReplies(await fetchJson(`${service}/stats`)) === 0) {
    if (Date.now() > deadline) fail("No reply within 5 minutes. Is the page open?");
    await delay(1_000);
  }

  console.log(`Playing. Measuring for ${minutes} min...`);
  const gpu = sampleGpu(["memory.used", "memory.total", "utilization.gpu", "clocks.gr"]);
  await delay(minutes * 60_000 + PIPELINE_DEFAULTS.replyTimeoutMs + 2_000);
  const samples = await gpu.stop();
  const stats = await fetchJson(`${service}/stats`);

  const fmt = (s) => (s && s.n ? `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} (n=${s.n})` : "none");
  const col = (key) => samples.map((s) => s[key]).filter(Number.isFinite);
  const bySource = stats.latency?.bySource ?? {};
  return [
    `## Benchmark run: Chrome, bot skill ${values.skill}, seed ${values.seed}, ${minutes} min`,
    "",
    "Service side: from the event's ts (set in the browser) to the reply sent, so it",
    "includes the HTTP hop, the queue and the model. The browser's numbers (to the reply",
    "arriving over SSE) are `witc.benchmark()` in the page's console.",
    "",
    "| What | Result |",
    "|------|--------|",
    `| Replies by source | ${Object.entries(stats.replies ?? {})
      .filter(([, n]) => n)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}; coalesced ${stats.coalesced ?? "?"} |`,
    `| Failures | ${
      Object.entries(stats.failures ?? {})
        .map(([k, n]) => `${k} ${n}`)
        .join(", ") || "none"
    } |`,
    ...Object.entries(bySource).map(
      ([source, l]) =>
        `| ${source}: first text / completion (ms) | ${fmt(l.firstText)} / ${fmt(l.completion)} |`,
    ),
    `| GPU memory used, Chrome included (MiB) | ${col("memory.used").length ? `${fmt(summarize(col("memory.used")))} of ${samples[0]["memory.total"]}` : "no nvidia-smi samples"} |`,
    `| GPU use (%) | ${fmt(summarize(col("utilization.gpu")))} |`,
    `| GPU graphics clock (MHz) | ${fmt(summarize(col("clocks.gr")))} |`,
  ].join("\n");
}

/**
 * The same prompt after different idle gaps, with the GPU's clock read just before each
 * call: does the model answer slower after the GPU has been idle?
 */
async function idleTest(values) {
  const callsPerGap = Number(values.calls);
  if (!(callsPerGap >= 1)) fail("--calls must be at least 1");
  const client = new OllamaClient();
  await warmUp(client);
  const { system, prompt } = buildPrompt(toContext(createGameEvent("win", {})), {
    persona: "fan",
  });
  const gaps = [0, 1_000, 3_000, 6_000, 12_000];
  const rows = [];
  for (const gapMs of gaps) {
    process.stdout.write(`${gapMs / 1000} s idle: `);
    for (let i = 0; i < callsPerGap; i++) {
      await delay(gapMs);
      const [before] = await gpuNow(["clocks.gr", "pstate"]);
      const start = performance.now();
      const { evalTokens } = await client.generate(prompt, {
        system,
        maxTokens: PIPELINE_DEFAULTS.maxTokens,
      });
      const ms = Math.round(performance.now() - start);
      rows.push({
        gapMs,
        ms,
        tokens: evalTokens,
        clock: before?.["clocks.gr"],
        pstate: before?.pstate,
      });
      process.stdout.write(".");
    }
    console.log();
  }

  const fmt = (s) => (s && s.n ? `${s.p50} / ${s.p95}` : "n/a");
  const lines = gaps.map((gapMs) => {
    const mine = rows.filter((r) => r.gapMs === gapMs);
    const msPerToken = mine.map((r) => Math.round(r.ms / Math.max(1, r.tokens)));
    const clocks = mine.map((r) => r.clock).filter(Number.isFinite);
    const pstates = [...new Set(mine.map((r) => r.pstate).filter(Boolean))].join(", ");
    return `| ${gapMs / 1000} s | ${fmt(summarize(mine.map((r) => r.ms)))} | ${fmt(summarize(msPerToken))} | ${clocks.length ? fmt(summarize(clocks)) : "n/a"} | ${pstates || "n/a"} |`;
  });
  return [
    `## Idle test: ${callsPerGap} calls per gap, the Fan on \`win\`, maxTokens ${PIPELINE_DEFAULTS.maxTokens}`,
    "",
    "| Idle before the call | Call ms p50 / p95 | ms per token p50 / p95 | GPU clock before (MHz) p50 / p95 | P-state before |",
    "|---|---|---|---|---|",
    ...lines,
  ].join("\n");
}

function totalReplies(stats) {
  return Object.values(stats?.replies ?? {}).reduce((sum, n) => sum + n, 0);
}

/** The GPU's current values for `fields` (nvidia-smi names), or [] without nvidia-smi. */
async function gpuNow(fields) {
  try {
    const { stdout } = await run("nvidia-smi", [
      `--query-gpu=${fields.join(",")}`,
      "--format=csv,noheader,nounits",
    ]);
    return stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => parseRow(fields, line));
  } catch {
    return [];
  }
}

/** Samples `fields` every 250 ms until stop(). */
function sampleGpu(fields) {
  const samples = [];
  let proc = null;
  try {
    proc = spawn("nvidia-smi", [
      `--query-gpu=${fields.join(",")}`,
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
      for (const line of lines) if (line.trim()) samples.push(parseRow(fields, line));
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

function parseRow(fields, line) {
  const cells = line.split(",").map((v) => v.trim());
  return Object.fromEntries(
    fields.map((f, i) => [f, Number.isFinite(Number(cells[i])) ? Number(cells[i]) : cells[i]]),
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer = await res.json();
  if (!answer.ok) fail(`${url}: ${answer.error ?? JSON.stringify(answer)}`);
  return answer;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

main().catch((err) => {
  console.error("Benchmark failed:", err.message);
  process.exit(1);
});
