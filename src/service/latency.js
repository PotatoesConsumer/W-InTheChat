/**
 * latency.js
 *
 * Per-event latency for the pipeline, as the proposal's evaluation plan asks: time from
 * the event's `ts` to the first visible reply text, and to the completed reply, reported
 * as p50/p95 (nearest rank, the same method as src/ai/demo.js and the harness report).
 */

/**
 * @param {number[]} sorted - Ascending.
 * @param {number} p - 0-100.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** @param {number[]} values */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted.at(-1) : null,
  };
}

/**
 * Records one row per answered event and summarizes them, overall and by the final
 * reply's source.
 */
export function createLatencyLog() {
  /** @type {{eventId: string, source: string, firstTextMs: number, completionMs: number}[]} */
  const rows = [];
  return {
    record(row) {
      rows.push(Object.freeze({ ...row }));
    },
    rows: () => [...rows],
    summary() {
      const bySource = {};
      for (const source of new Set(rows.map((r) => r.source))) {
        const mine = rows.filter((r) => r.source === source);
        bySource[source] = {
          firstText: summarize(mine.map((r) => r.firstTextMs)),
          completion: summarize(mine.map((r) => r.completionMs)),
        };
      }
      return {
        all: {
          firstText: summarize(rows.map((r) => r.firstTextMs)),
          completion: summarize(rows.map((r) => r.completionMs)),
        },
        bySource,
      };
    },
  };
}
