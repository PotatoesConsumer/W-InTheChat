/**
 * Shared bits for scripts/service.js and scripts/e2e.js.
 */

/**
 * Checks Ollama and loads the model, so the first real reply doesn't pay the cold load
 * (which can take longer than a reply timeout). Exits the process with a hint on failure.
 * @param {import("../../src/ai/ollamaClient.js").OllamaClient} client
 */
export async function warmUp(client) {
  try {
    await loadModel(client);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Like warmUp, but throws instead of exiting, for a running service switching to the ai
 * condition (POST /condition).
 * @param {import("../../src/ai/ollamaClient.js").OllamaClient} client
 */
export async function loadModel(client) {
  const health = await client.health();
  if (!health.ok) {
    throw new Error(
      `Ollama not reachable (${health.reason}). Start it (it usually runs after install) and try again.`,
    );
  }
  if (!health.hasDefaultModel) {
    throw new Error(`Model "${client.model}" not found. Run: ollama pull ${client.model}`);
  }
  process.stdout.write(`Loading ${client.model}... `);
  const started = Date.now();
  const slow = new client.constructor({
    host: client.host,
    model: client.model,
    timeoutMs: 180_000,
    keepAlive: client.keepAlive,
  });
  await slow.generate("Say hi.", { maxTokens: 1 });
  console.log(`ready (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

/** Readable p50/p95 summary of a pipeline stats() object. */
export function formatStats(stats) {
  const ms = (s) => (s.n === 0 ? "n=0" : `n=${s.n} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms`);
  const lines = [
    `--- Pipeline (${stats.condition}) ---`,
    `  replies:  ${fmt(stats.replies)}`,
    `  failures: ${fmt(stats.failures)}`,
    `  all:      first text ${ms(stats.latency.all.firstText)}; completed ${ms(stats.latency.all.completion)}`,
  ];
  for (const [source, s] of Object.entries(stats.latency.bySource)) {
    lines.push(
      `  ${source.padEnd(9)} first text ${ms(s.firstText)}; completed ${ms(s.completion)}`,
    );
  }
  return lines.join("\n");
}

function fmt(counts) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  return entries.length ? entries.map(([k, n]) => `${k} ${n}`).join(", ") : "none";
}
