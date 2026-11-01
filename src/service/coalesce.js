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
 * What counts as "the same event": game events by name, player messages by their text
 * (case and spacing ignored). Different messages are never repeats of each other, so a
 * quick follow-up question still gets an answer; the same line spammed is coalesced.
 * @param {{kind: string, name?: string, facts?: {playerMessage?: string}}} ctx
 */
export function coalesceKey(ctx) {
  if (ctx.kind !== "chat") return `game:${ctx.name}`;
  const text = ctx.facts.playerMessage.toLowerCase().replace(/\s+/g, " ").trim();
  return `chat:${text}`;
}

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
