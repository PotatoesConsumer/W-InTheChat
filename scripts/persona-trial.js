/**
 * Persona prompt trial: runs each persona's prompt on fixed events and player messages
 * with the real model, prints every reply with the weaknesses it was flagged for, then
 * a table of counts and p50/p95 model time. How to read it: docs/personas.md ("Trials").
 * Needs Ollama with qwen2.5:3b; not the pilot benchmark (W08).
 *
 *   npm run ai:personas
 *   npm run ai:personas -- --persona hater,backseat --repeats 2
 *   npm run ai:personas -- --persona hater --name Pu
 */

import { parseArgs } from "node:util";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { buildPrompt } from "../src/ai/contextBuilder.js";
import { PERSONA_PROMPTS, AI_PERSONAS } from "../src/ai/personas/index.js";
import { PIPELINE_DEFAULTS } from "../src/service/pipeline.js";
import { toContext } from "../src/events/context.js";
import { trialInputs, flagReply, checkNames } from "../src/ai/personaTrial.js";

const USAGE = `Usage: npm run ai:personas -- [options]

Options:
  --persona <ids>   comma-separated, from ${AI_PERSONAS.join(", ")} (default all)
  --repeats <n>     replies per input (default 4)
  --name <name>     streamer name in the prompt (default "the streamer", as the service sends)
  --quiet           only print the summary`;

async function main() {
  const { values } = parseArgs({
    options: {
      persona: { type: "string", default: AI_PERSONAS.join(",") },
      repeats: { type: "string", default: "4" },
      name: { type: "string", default: "the streamer" },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return console.log(USAGE);

  const personas = values.persona.split(",").map((p) => p.trim());
  const unknown = personas.filter((p) => !AI_PERSONAS.includes(p));
  const repeats = Number(values.repeats);
  if (unknown.length > 0 || !Number.isInteger(repeats) || repeats < 1) {
    console.error(unknown.length > 0 ? `Unknown persona: ${unknown.join(", ")}` : "Bad --repeats");
    console.error(USAGE);
    process.exit(2);
  }

  // A cold model load can take longer than the default 15 s timeout.
  const client = new OllamaClient({ timeoutMs: 120_000 });
  const health = await client.health();
  if (!health.ok) {
    console.error(`Ollama not reachable: ${health.reason}`);
    process.exit(1);
  }
  if (!health.hasDefaultModel) {
    console.error(`Model "${client.model}" not found locally. Run: ollama pull ${client.model}`);
    process.exit(1);
  }
  await client.generate("hi", { maxTokens: 4 }); // warm up, so loading isn't timed

  const streamerName = values.name;
  const times = [];
  const summary = {};
  for (const persona of personas) {
    if (!values.quiet) console.log(`\n=== ${persona} ===`);
    const counts = Object.fromEntries(checkNames(persona).map((name) => [name, 0]));
    const seen = [];
    for (const event of trialInputs()) {
      const ctx = toContext(event);
      const { system, prompt } = buildPrompt(ctx, { persona, streamerName });
      const lines = [];
      for (let i = 0; i < repeats; i++) {
        const start = Date.now();
        const { text } = await client.generate(prompt, {
          system,
          maxTokens: PIPELINE_DEFAULTS.maxTokens,
        });
        times.push(Date.now() - start);
        const line = PERSONA_PROMPTS[persona].parse(text);
        const flags = flagReply(persona, line, ctx, streamerName);
        for (const flag of flags) counts[flag]++;
        seen.push(line.toLowerCase());
        lines.push(flags.length > 0 ? `[${flags.join(",")}] ${line}` : line);
      }
      if (!values.quiet) console.log(`${describe(ctx, event)}:\n    ${lines.join("\n    ")}`);
    }
    summary[persona] = {
      n: seen.length,
      ...counts,
      distinct: (new Set(seen).size / seen.length).toFixed(2),
    };
  }

  times.sort((a, b) => a - b);
  console.log(
    `\nmodel ${client.model}, name "${streamerName}", n=${times.length}, ` +
      `p50=${percentile(times, 50)}ms p95=${percentile(times, 95)}ms`,
  );
  console.table(summary);
}

function describe(ctx, event) {
  if (typeof ctx.facts.playerMessage === "string") return `chat "${ctx.facts.playerMessage}"`;
  return Object.keys(event.data ?? {}).length > 0 ? `${ctx.facts.event} +details` : ctx.facts.event;
}

function percentile(sortedMs, p) {
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

main().catch((err) => {
  console.error("Trial failed:", err.message);
  process.exit(1);
});
