/**
 * Manual smoke test for the Ollama wrapper + Fan persona.
 * Run: npm run ai:demo
 *
 * Prints the generated chat line and round-trip latency for a set of
 * sample events, then reports p50/p95 wall-clock latency across the run —
 * the metric the proposal's evaluation plan requires (event-to-completed-
 * response, reported as median and p95), plus peak eval-token count as a
 * rough proxy for output length. This is a smoke test, not the final
 * benchmark harness (that needs a real event distribution + GPU memory
 * sampling), but it keeps latency regressions visible without a full game loop.
 */
import { OllamaClient } from "./ollamaClient.js";
import { FAN_SYSTEM_PROMPT, buildFanPrompt, parseFanResponse } from "./personas/fan.js";

// A handful of repeats per event type so percentiles mean something; still
// far short of a real benchmark run.
const SAMPLE_EVENTS = [
  "landed a headshot",
  "got a clutch 1v3 win",
  "died to fall damage",
  "landed a headshot",
  "got a clutch 1v3 win",
  "died to fall damage",
];

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return null;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

async function main() {
  const client = new OllamaClient();

  const health = await client.health();
  if (!health.ok) {
    console.error(`Ollama not reachable: ${health.reason}`);
    console.error("Is `ollama serve` running? (it starts automatically after install)");
    process.exit(1);
  }
  if (!health.hasDefaultModel) {
    console.error(`Model "${client.model}" not found locally. Run: ollama pull ${client.model}`);
    process.exit(1);
  }

  console.log(`Connected to Ollama — model: ${client.model}\n`);

  const wallTimes = [];

  for (const event of SAMPLE_EVENTS) {
    const prompt = `${FAN_SYSTEM_PROMPT}\n\n${buildFanPrompt({ event })}`;
    const start = Date.now();
    const { text, evalTokens, totalMs } = await client.generate(prompt);
    const wallMs = Date.now() - start;
    wallTimes.push(wallMs);

    console.log(`Event: ${event}`);
    console.log(`  → ${parseFanResponse(text)}`);
    console.log(`  (${evalTokens} tokens, ${totalMs ?? wallMs}ms server-reported, ${wallMs}ms wall)\n`);
  }

  const sorted = [...wallTimes].sort((a, b) => a - b);
  console.log("--- Latency summary (wall-clock, this run only) ---");
  console.log(`  n=${sorted.length}  p50=${percentile(sorted, 50)}ms  p95=${percentile(sorted, 95)}ms  max=${sorted[sorted.length - 1]}ms`);
}

main().catch((err) => {
  console.error("Demo failed:", err.message);
  process.exit(1);
});
