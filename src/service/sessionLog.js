/**
 * sessionLog.js
 *
 * The study's session log: one JSON-lines file per participant and condition, written
 * when the service runs with `--log <dir>` (docs/study/protocol.md). One record a line:
 *
 *   {type: "start",   ts, session, condition, ...about}   about: {version, model}
 *   {type: "event",   ts, event}      every valid event in: game events and player chat
 *   {type: "message", ts, message}    every finished chat line out (done: true)
 *   {type: "reply",   ts, eventId, source, persona, firstTextMs, completionMs, text,
 *                     failure, rejected?}   rejected: the model's text the check turned
 *                     down ({text, category}), never shown, kept for review
 *   {type: "end",     ts, stats, gpu?}     the pipeline's counts and p50/p95; gpu: the
 *                     peak GPU memory during this half ({peakMiB, totalMiB})
 *
 * It holds what participants typed, so it stays on the study laptop: the consent form
 * covers it, `study-logs/` is git-ignored, and only aggregates go in the report.
 * Lines are appended synchronously, so a crash loses nothing already written.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Participant / session labels: safe in a file name, no names or emails. */
export const SESSION_LABEL = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * @param {object} opts
 * @param {string} opts.dir - Created if missing.
 * @param {() => number} [opts.now]
 * @param {object} [opts.about] - Goes on every start record: the code version (git
 *   commit, which pins the prompts) and the model, which the report has to name.
 * @param {{reset: () => void, peak: () => object|null}} [opts.gpu] - Peak GPU memory;
 *   reset when a file opens, read when it ends (scripts/lib/gpu.js).
 */
export function createSessionLog({ dir, now = Date.now, about = {}, gpu = null }) {
  let file = null;

  function write(record) {
    if (file) appendFileSync(file, `${JSON.stringify({ ts: now(), ...record })}\n`);
  }

  return {
    /**
     * Starts a new file; call close() on the old one first.
     * @param {{session: string|null, condition: string}} start
     * @returns {string} the file's path
     */
    open({ session, condition }) {
      mkdirSync(dir, { recursive: true });
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
      file = join(dir, `${session ?? "session"}-${condition}-${stamp}.jsonl`);
      gpu?.reset();
      write({ type: "start", session: session ?? null, condition, ...about });
      return file;
    },
    write,
    /** Ends the current file with the pipeline's stats and the GPU's peak memory. */
    close(stats = {}) {
      const peak = gpu?.peak() ?? null;
      write({ type: "end", stats, ...(peak && { gpu: peak }) });
      file = null;
    },
    file: () => file,
  };
}
