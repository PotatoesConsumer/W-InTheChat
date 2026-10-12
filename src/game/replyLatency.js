/**
 * replyLatency.js
 *
 * End-to-end reply latency as the player sees it: from the moment the game sends an
 * event to the first chat text for it and to its finished reply, over HTTP + SSE.
 * Same p50/p95 method as the service's own log (src/service/latency.js), which starts
 * the clock when the service receives the event instead.
 */

import { createLatencyLog } from "../service/latency.js";

/** @param {{now?: () => number}} [opts] */
export function createReplyLatency({ now = () => performance.now() } = {}) {
  const log = createLatencyLog();
  /** eventId -> {sentAt, firstTextAt} for events still waiting on a finished reply. */
  const pending = new Map();

  return {
    /** Call right before sending the event. */
    sent(eventId) {
      pending.set(eventId, { sentAt: now(), firstTextAt: null });
    },

    /** Call with every chat_message update. Returns the row when a reply finished. */
    message(message) {
      const entry = pending.get(message.eventId);
      if (!entry) return null;
      const t = now();
      if (entry.firstTextAt === null && message.text) entry.firstTextAt = t;
      if (!message.done) return null;
      pending.delete(message.eventId);
      const row = {
        eventId: message.eventId,
        source: message.source,
        firstTextMs: Math.round((entry.firstTextAt ?? t) - entry.sentAt),
        completionMs: Math.round(t - entry.sentAt),
      };
      log.record(row);
      return row;
    },

    /** Forget an event that the service refused, so it never counts. */
    dropped(eventId) {
      pending.delete(eventId);
    },

    summary: () => log.summary(),
    rows: () => log.rows(),
  };
}
