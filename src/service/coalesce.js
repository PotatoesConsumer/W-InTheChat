/**
 * coalesce.js
 *
 * Coalescing (W06): the same event repeated in quick succession is answered like one
 * event, not once per repeat. A run is a chain of same-key events each less than
 * `windowMs` after the previous one (the rule `repeat-coalescing` checks,
 * docs/pipeline-contract.md). The first event of a run is answered, then every
 * `every`-th repeat, at most `maxPerRun` in all; the rest get no message.
 *
 * Runs are measured with the events' own timestamps (`ts`, set when the event
 * happened), never with the pipeline's state or clock, so the same events are coalesced
 * the same way however fast the model is.
 */

/**
 * @param {{windowMs: number, every: number, maxPerRun: number}} opts
 */
export function createCoalescer({ windowMs, every, maxPerRun }) {
  const runs = new Map(); // key -> { lastTs, count, answered }
  return {
    /**
     * @param {string} key - What counts as "the same event", e.g. `game:kill` or `chat`.
     * @param {number} ts - The event's timestamp (ms).
     * @returns {boolean} whether this event gets a reply
     */
    admit(key, ts) {
      const run = runs.get(key);
      if (!run || ts - run.lastTs >= windowMs) {
        runs.set(key, { lastTs: ts, count: 1, answered: 1 });
        return true;
      }
      run.lastTs = ts;
      run.count++;
      if (run.answered < maxPerRun && run.count % every === 0) {
        run.answered++;
        return true;
      }
      return false;
    },
  };
}
