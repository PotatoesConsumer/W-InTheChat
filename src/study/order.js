/**
 * order.js
 *
 * The study's counterbalanced condition order (proposal: every participant tries both
 * conditions, order counterbalanced). Participants get ids in arrival order and the
 * order alternates, so any even number of people is exactly balanced and a stop at an
 * odd number is off by one at most. Protocol: docs/study/protocol.md.
 */

import { CONDITIONS } from "../service/pipeline.js";

const [FIRST, SECOND] = CONDITIONS; // "ai", "scripted"

/** "P01".."P99": the session label the game and the service log use. */
export function participantId(n, prefix = "P") {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("participant numbers start at 1");
  return `${prefix}${String(n).padStart(2, "0")}`;
}

/**
 * @param {number} count - How many participants.
 * @param {object} [opts]
 * @param {number} [opts.start] - First participant number (1; pilots can use their own prefix).
 * @param {string} [opts.prefix] - "P" for the study, e.g. "T" for pilot sessions.
 * @returns {{participant: string, order: string[]}[]}
 */
export function studySchedule(count, { start = 1, prefix = "P" } = {}) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be at least 1");
  return Array.from({ length: count }, (_, i) => {
    const n = start + i;
    return {
      participant: participantId(n, prefix),
      order: n % 2 === 1 ? [FIRST, SECOND] : [SECOND, FIRST],
    };
  });
}

/** The game URL for one half of a session. */
export function sessionUrl(participant, condition, base = "http://localhost:5173/") {
  const url = new URL(base);
  url.searchParams.set("condition", condition);
  url.searchParams.set("session", participant);
  return url.href;
}
