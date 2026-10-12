/**
 * report.js
 *
 * Summaries and a readable timeline for a harness run record (see runner.js).
 * Latency is measured from when the runner published the event, as the proposal asks:
 * event to first visible text, and event to completed reply, reported as p50/p95.
 */

/**
 * Nearest-rank percentile, the same method as src/ai/demo.js.
 * @param {number[]} sorted - Ascending.
 * @param {number} p - 0-100.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Per-event latencies for accepted events that got at least one reply.
 * @returns {{firstText: number[], completion: number[]}} unsorted, in ms
 */
export function latencies(record) {
  const firstText = [];
  const completion = [];
  for (const entry of record.events) {
    if (!entry.accepted) continue;
    const replies = record.messages.filter((m) => m.message?.eventId === entry.id);
    if (replies.length === 0) continue;
    firstText.push(round(replies[0].t - entry.t));
    const done = replies.find((m) => m.message.done === true);
    if (done) completion.push(round(done.t - entry.t));
  }
  return { firstText, completion };
}

/** Final messages only: the last update of each message id. */
export function finalMessages(record) {
  const byId = new Map();
  for (const entry of record.messages) byId.set(entry.message?.id, entry);
  return [...byId.values()];
}

export function summarize(record) {
  const finals = finalMessages(record).map((m) => m.message);
  const { firstText, completion } = latencies(record);
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
  };
  return {
    events: {
      published: record.events.length,
      accepted: record.events.filter((e) => e.accepted).length,
      rejected: record.events.filter((e) => !e.accepted).length,
    },
    messages: {
      final: finals.length,
      updates: record.messages.length,
      bySource: countBy(finals, (m) => m?.source),
      byPersona: countBy(finals, (m) => m?.persona),
      late: record.lateMessages,
    },
    generator: {
      calls: record.generatorCalls.length,
      byOutcome: countBy(record.generatorCalls, (c) => c.outcome ?? "pending"),
    },
    latency: { firstText: stats(firstText), completion: stats(completion) },
    handlerErrors: record.handlerErrors.length,
  };
}

/**
 * Human-readable report: timeline of events and final replies, then the summary.
 * @param {object} record
 * @param {{checks?: {name: string, ok: boolean, violations: {message: string}[]}[]}} [extra]
 */
export function formatRun(record, { checks } = {}) {
  const lines = [
    `Scenario: ${record.scenario.name} (condition: ${record.condition}, seed ${record.seed})`,
  ];
  if (record.scenario.description) lines.push(record.scenario.description);
  lines.push("");

  const timeline = [
    ...record.events.map((e) => ({ seq: e.seq, t: e.t, text: describeEvent(e) })),
    ...finalMessages(record).map(({ seq, t, message }) => ({
      seq,
      t,
      text: describeMessage(message),
    })),
  ].sort((a, b) => a.seq - b.seq);
  for (const row of timeline) lines.push(`${`+${Math.round(row.t)}ms`.padStart(9)}  ${row.text}`);

  const s = summarize(record);
  const fmt = (o) =>
    Object.entries(o)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "none";
  const ms = (x) => (x.n === 0 ? "n=0" : `n=${x.n} p50=${x.p50}ms p95=${x.p95}ms`);
  lines.push(
    "",
    "--- Summary ---",
    `  events:    ${s.events.published} published, ${s.events.accepted} accepted, ${s.events.rejected} rejected`,
    `  messages:  ${s.messages.final} final (${s.messages.updates} updates, ${s.messages.late} after the run ended)`,
    `  by source: ${fmt(s.messages.bySource)}`,
    `  persona:   ${fmt(s.messages.byPersona)}`,
    `  generator: ${s.generator.calls} calls (${fmt(s.generator.byOutcome)})`,
    `  latency:   first text ${ms(s.latency.firstText)}; completed ${ms(s.latency.completion)}`,
    `  handler errors: ${s.handlerErrors}`,
  );

  if (checks) {
    const failed = checks.filter((c) => !c.ok);
    lines.push("", `--- Checks: ${checks.length - failed.length}/${checks.length} passed ---`);
    for (const check of checks) {
      lines.push(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
      for (const v of check.violations.slice(0, 5)) lines.push(`          - ${v.message}`);
      if (check.violations.length > 5)
        lines.push(`          ... ${check.violations.length - 5} more`);
    }
  }
  return lines.join("\n");
}

function describeEvent(entry) {
  if (!entry.accepted) {
    const why = entry.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
    return `✗ ${entry.id} rejected (${why.join("; ")})`;
  }
  const { event } = entry;
  if (event.kind === "chat") return `▶ player: ${JSON.stringify(event.text)}`;
  const data = Object.keys(event.data).length ? ` ${JSON.stringify(event.data)}` : "";
  return `▶ ${event.name} [${entry.importance}]${data}`;
}

function describeMessage(m) {
  if (!m || typeof m !== "object") return `  ← (not a message: ${JSON.stringify(m)})`;
  const text = typeof m.text === "string" ? JSON.stringify(m.text) : String(m.text);
  return `  ← [${m.persona}/${m.source}] ${m.viewer}: ${text}`;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const k = String(key(item));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function round(ms) {
  return Math.round(ms * 10) / 10;
}
