/**
 * voice.js
 *
 * The optional voice input's state, with no DOM (tested): which spoken phrases go to
 * chat and when. The browser side is speech.js.
 *
 * - Speech recognition gives a final phrase after each pause. Chat gets at most one
 *   spoken message every VOICE_LIMITS.minGapMs: phrases inside that gap are joined, so
 *   talking a lot doesn't fill the model's queue (it answers one message at a time).
 *   Filler ("uh", "um") and phrases under minChars don't go to chat.
 */

import { LIMITS } from "../events/schema.js";

export const VOICE_LIMITS = Object.freeze({
  /** At most one spoken chat message this often. */
  minGapMs: 4000,
  /** Shorter phrases (after removing filler) don't go to chat. */
  minChars: 3,
});

const FILLER = /\b(?:uh+|um+|erm+|hmm+|ah+|eh+|mm+)\b/gi;

/** A phrase as chat gets it: filler removed, spaces tidied, at most maxChatLength. */
export function cleanPhrase(text) {
  return String(text ?? "")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.maxChatLength)
    .trim();
}

/**
 * Collects final phrases and lets one spoken message out per minGapMs.
 * @param {{minGapMs?: number, minChars?: number}} [opts]
 */
export function createVoiceBuffer({
  minGapMs = VOICE_LIMITS.minGapMs,
  minChars = VOICE_LIMITS.minChars,
} = {}) {
  let pending = "";
  let lastSentAt = -Infinity;
  return {
    /** A final phrase from the recognizer. */
    push(text) {
      const phrase = cleanPhrase(text);
      if (phrase.length < minChars) return;
      pending = cleanPhrase(pending ? `${pending} ${phrase}` : phrase);
    },
    /**
     * The message to send now, or null (nothing waiting, or too soon after the last).
     * @param {number} now - ms
     */
    take(now) {
      if (!pending || now - lastSentAt < minGapMs) return null;
      const text = pending;
      pending = "";
      lastSentAt = now;
      return text;
    },
    /** Drops what's waiting (mic turned off, stream ended). */
    clear() {
      pending = "";
    },
    get pending() {
      return pending;
    },
  };
}
