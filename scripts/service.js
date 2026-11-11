/**
 * Runs the chat service against the local Ollama model. Guide: docs/service.md.
 *
 *   npm run service
 *   npm run service -- --condition scripted --port 8787 --streamer Pu
 *   npm run service -- --log study-logs     the study: a session log per participant
 *
 * Warms the model first (a cold load can take longer than a reply timeout), then serves
 * POST /events and GET /stream on localhost. The game can switch the condition while it
 * runs (POST /condition); switching to ai loads the model first. Ctrl+C prints p50/p95
 * latency for the current condition and exits.
 *
 * With --log, every event in, chat line out and reply latency goes to a JSON-lines file
 * in that folder, a new one per session label and condition (`?session=P07` in the
 * game's URL). Protocol: docs/study/protocol.md.
 */

import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { createService, SERVICE_DEFAULTS } from "../src/service/server.js";
import { createSessionLog } from "../src/service/sessionLog.js";
import { warmUp, loadModel, formatStats } from "./lib/serviceTools.js";

const { values } = parseArgs({
  options: {
    condition: { type: "string", default: "ai" },
    port: { type: "string", default: String(process.env.SERVICE_PORT ?? SERVICE_DEFAULTS.port) },
    streamer: { type: "string", default: "the streamer" },
    quiet: { type: "boolean", default: false },
    log: { type: "string" },
  },
});

if (!["ai", "scripted"].includes(values.condition)) {
  console.error("--condition must be ai or scripted");
  process.exit(2);
}

const client = new OllamaClient();
if (values.condition === "ai") await warmUp(client);

/** The code version, which pins the prompts: the study report has to name it. */
function codeVersion() {
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"], { encoding: "utf8" });
    return `${commit.trim()}${dirty.trim() ? "+changes" : ""}`;
  } catch {
    return "unknown";
  }
}

const sessionLog = values.log
  ? createSessionLog({ dir: values.log, about: { version: codeVersion(), model: client.model } })
  : null;
const service = createService({
  port: Number(values.port),
  sessionLog,
  prepare: (condition) => (condition === "ai" ? loadModel(client) : undefined),
  onCondition: (condition, previousStats) => {
    console.log(`\n${formatStats(previousStats)}\nSwitched to the ${condition} condition.`);
    if (sessionLog)
      console.log(`Session ${service.session() ?? "(no label)"}: ${sessionLog.file()}`);
  },
  log: (msg, err) => console.error(`! ${msg}:`, err?.message ?? err),
  deps: {
    condition: values.condition,
    streamerName: values.streamer,
    generate: (prompt, opts) => client.generate(prompt, opts),
    onReply: values.quiet
      ? undefined
      : (r) =>
          console.log(
            `${r.source.padEnd(8)} ${String(r.completionMs).padStart(5)}ms  ${r.text}` +
              (r.failure ? `  (${r.failure})` : ""),
          ),
  },
});

const { url } = await service.start();
console.log(
  `Chat service (${service.condition()}) on ${url}  POST /events  GET /stream  GET /stats  GET|POST /condition`,
);
if (sessionLog) console.log(`Session log: ${sessionLog.file()}`);

process.on("SIGINT", async () => {
  console.log(`\n${formatStats(service.stats())}`);
  await service.close();
  process.exit(0);
});
