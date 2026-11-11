/**
 * sessionLog.js
 *
 * The study's session log: one JSON-lines file per participant and condition, written
 * when the service runs with `--log <dir>` (docs/study/protocol.md). One record a line:
 *
 *   {type: "start",   ts, session, condition, ...about}   about: {version, model}
 *   {type: "event",   ts, event}      every valid event in: game events and player chat
 *   {type: "message", ts, message}    every finished chat line out (done: true)
 *   {type: "reply",   ts, eventId, source, firstTextMs, completionMs, text, failure}
 *   {type: "end",     ts, stats}      the pipeline's counts and p50/p95
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
 */
export function createSessionLog({ dir, now = Date.now, about = {} }) {
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
      write({ type: "start", session: session ?? null, condition, ...about });
      return file;
    },
    write,
    /** Ends the current file with the pipeline's stats. */
    close(stats = {}) {
      write({ type: "end", stats });
      file = null;
    },
    file: () => file,
  };
}
