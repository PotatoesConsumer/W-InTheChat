/**
 * Runs the chat service against the local Ollama model. Guide: docs/service.md.
 *
 *   npm run service
 *   npm run service -- --condition scripted --port 8787 --streamer Pu
 *
 * Warms the model first (a cold load can take longer than a reply timeout), then serves
 * POST /events and GET /stream on localhost. Ctrl+C prints p50/p95 latency and exits.
 */

import { parseArgs } from "node:util";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { createService, SERVICE_DEFAULTS } from "../src/service/server.js";
import { warmUp, formatStats } from "./lib/serviceTools.js";

const { values } = parseArgs({
  options: {
    condition: { type: "string", default: "ai" },
    port: { type: "string", default: String(process.env.SERVICE_PORT ?? SERVICE_DEFAULTS.port) },
    streamer: { type: "string", default: "the streamer" },
    quiet: { type: "boolean", default: false },
  },
});

if (!["ai", "scripted"].includes(values.condition)) {
  console.error("--condition must be ai or scripted");
  process.exit(2);
}

const client = new OllamaClient();
if (values.condition === "ai") await warmUp(client);

const service = createService({
  port: Number(values.port),
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
console.log(`Chat service (${values.condition}) on ${url}  POST /events  GET /stream  GET /stats`);

process.on("SIGINT", async () => {
  console.log(`\n${formatStats(service.stats())}`);
  await service.close();
  process.exit(0);
});
