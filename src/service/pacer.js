/**
 * pacer.js
 *
 * Chat rate limit (W06): at most `maxPerSecond` new messages start in any one-second
 * window. Over the limit, messages wait their turn in order; nothing is dropped and no
 * text changes, so pacing only shifts when a line appears, never which lines appear
 * (the same seed and events still give the same chat). Later updates of a message that
 * has started don't count, but keep their place in line.
 */

/**
 * @param {object} opts
 * @param {number} opts.maxPerSecond
 * @param {() => number} [opts.now]
 * @param {(err: unknown) => void} [opts.onError] - For a delivery that throws after waiting.
 */
export function createPacer({ maxPerSecond, now = Date.now, onError = console.error }) {
  const waiting = []; // { isNew, deliver }, in arrival order
  const starts = []; // when recent new messages went out, oldest first
  const idlers = [];
  let timer = null;
  let flushing = false;

  function flush(late) {
    timer = null;
    flushing = true;
    try {
      while (waiting.length > 0) {
        const head = waiting[0];
        if (head.isNew) {
          const t = now();
          while (starts.length > 0 && t - starts[0] >= 1_000) starts.shift();
          if (starts.length >= maxPerSecond) {
            timer = setTimeout(() => flush(true), Math.max(1, starts[0] + 1_000 - t));
            return;
          }
          starts.push(t);
        }
        waiting.shift();
        if (!late) {
          head.deliver();
          continue;
        }
        try {
          head.deliver();
        } catch (err) {
          onError(err);
        }
      }
    } finally {
      flushing = false;
    }
    for (const resolve of idlers.splice(0)) resolve();
  }

  return {
    /**
     * @param {boolean} isNew - The first update of a message (counts toward the limit).
     * @param {() => void} deliver - Sends it; called at once when under the limit.
     */
    push(isNew, deliver) {
      waiting.push({ isNew, deliver });
      if (timer === null && !flushing) flush(false);
    },
    /** Resolves once nothing is waiting. */
    idle() {
      return waiting.length === 0 ? Promise.resolve() : new Promise((r) => idlers.push(r));
    },
    stop() {
      clearTimeout(timer);
      timer = null;
      waiting.length = 0;
      for (const resolve of idlers.splice(0)) resolve();
    },
  };
}
