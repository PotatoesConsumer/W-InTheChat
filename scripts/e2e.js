/**
 * End-to-end latency run: events go over HTTP into the real service, the real pipeline
 * asks the local model, and replies come back over SSE. Everything the game will use,
 * except the browser itself. Guide: docs/service.md.
 *
 *   npm run e2e
 *   npm run e2e -- --rounds 5 --gap 1500
 *
 * Latency is measured on the client side, from each event's ts to the first chat_message
 * frame for it and to the frame with done: true, and reported as p50/p95.
 */

import { parseArgs } from "node:util";
import { OllamaClient } from "../src/ai/ollamaClient.js";
import { createService } from "../src/service/server.js";
import { readSse } from "../src/service/sse.js";
import { createGameEvent, createChatEvent, importanceOf } from "../src/events/schema.js";
import { summarize } from "../src/service/latency.js";
import { warmUp, formatStats } from "./lib/serviceTools.js";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "3" },
    gap: { type: "string", default: "1500" },
    streamer: { type: "string", default: "Pu" },
  },
});
const rounds = Number(values.rounds);
const gapMs = Number(values.gap);
if (!(Number.isInteger(rounds) && rounds > 0) || !(gapMs >= 0)) {
  console.error("--rounds must be a positive integer and --gap a non-negative number of ms");
  process.exit(2);
}

/** One round of a session: routine events, big moments and player messages. */
const ROUND = [
  () => createGameEvent("round_start", { round: 1 }),
  () => createGameEvent("kill"),
  () => createChatEvent("chat, which way should I go?"),
  () => createGameEvent("close_call", { hp: 5 }),
  () => createGameEvent("item_pickup", { item: "shield" }),
  () => createGameEvent("streak", { count: 3 }),
  () => createChatEvent("that was close lol"),
  () => createGameEvent("win", { score: 12 }),
];

const client = new OllamaClient();
await warmUp(client);

const service = createService({
  port: 0,
  deps: {
    streamerName: values.streamer,
    generate: (prompt, opts) => client.generate(prompt, opts),
  },
});
const { url } = await service.start();

// Client side: one SSE stream, first frame and done frame per event.
const seen = new Map(); // eventId -> {first, done, text, source}
const stream = new AbortController();
const res = await fetch(`${url}/stream`, { signal: stream.signal });
const reading = readSse(res.body, (event, m) => {
  if (event !== "chat_message" || !m.eventId) return;
  const row = seen.get(m.eventId) ?? {};
  row.first ??= Date.now();
  if (m.done) Object.assign(row, { done: Date.now(), text: m.text, source: m.source });
  seen.set(m.eventId, row);
}).catch((err) => {
  if (err.name !== "AbortError") throw err;
});

console.log(`Playing ${rounds} round(s), ${ROUND.length} events each, ${gapMs} ms apart\n`);
const sent = [];
for (let r = 0; r < rounds; r++) {
  for (const make of ROUND) {
    const event = make();
    sent.push(event);
    const answer = await fetch(`${url}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (answer.status !== 202) console.error(`! ${event.id} refused: ${await answer.text()}`);
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}
await service.idle();
await new Promise((resolve) => setTimeout(resolve, 200)); // let the last frames arrive
stream.abort();
await reading;

const rows = sent.map((event) => {
  const row = seen.get(event.id) ?? {};
  const label = event.kind === "chat" ? `chat "${event.text}"` : event.name;
  const kind = event.kind === "chat" ? "chat" : importanceOf(event);
  return { ...row, label, kind, first: row.first - event.ts, done: row.done - event.ts };
});
for (const r of rows) {
  const t = Number.isFinite(r.done)
    ? `${String(r.first).padStart(5)} / ${String(r.done).padStart(5)} ms`
    : "  no reply   ";
  console.log(
    `${t}  ${r.kind.padEnd(5)} ${r.label.padEnd(36)} [${r.source ?? "-"}] ${r.text ?? ""}`,
  );
}

const ms = (s) => (s.n === 0 ? "n=0" : `n=${s.n} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms`);
const answered = rows.filter((r) => Number.isFinite(r.done));
const model = answered.filter((r) => r.kind !== "minor");
console.log("\n--- End to end (client side, event ts -> SSE frame) ---");
console.log(`  model path (major + chat): first text ${ms(summarize(model.map((r) => r.first)))}`);
console.log(`                             completed  ${ms(summarize(model.map((r) => r.done)))}`);
console.log(
  `  everything:                completed  ${ms(summarize(answered.map((r) => r.done)))}`,
);
console.log(`  unanswered events: ${rows.length - answered.length}`);
console.log(`\n${formatStats(service.stats())}`);

await service.close();
