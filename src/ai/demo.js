/**
 * Manual smoke test for the Ollama wrapper + Fan persona.
 * Run: npm run ai:demo
 *
 * Prints the generated chat line and round-trip latency for a few
 * sample events, so latency regressions are visible without a full game loop.
 */
import { OllamaClient } from "./ollamaClient.js";
import { FAN_SYSTEM_PROMPT, buildFanPrompt, parseFanResponse } from "./personas/fan.js";

const SAMPLE_EVENTS = [
  "landed a headshot",
  "got a clutch 1v3 win",
  "died to fall damage",
];

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

  for (const event of SAMPLE_EVENTS) {
    const prompt = `${FAN_SYSTEM_PROMPT}\n\n${buildFanPrompt({ event })}`;
    const start = Date.now();
    const { text, evalTokens, totalMs } = await client.generate(prompt);
    const wallMs = Date.now() - start;

    console.log(`Event: ${event}`);
    console.log(`  → ${parseFanResponse(text)}`);
    console.log(`  (${evalTokens} tokens, ${totalMs ?? wallMs}ms server-reported, ${wallMs}ms wall)\n`);
  }
}

main().catch((err) => {
  console.error("Demo failed:", err.message);
  process.exit(1);
});
