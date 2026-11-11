/**
 * voice.js
 *
 * The optional voice input's state, with no DOM (tested): which spoken phrases go to
 * chat and when, and what the subtitles show. The browser side is speech.js.
 *
 * - Speech recognition gives a final phrase after each pause. Chat gets at most one
 *   spoken message every VOICE_LIMITS.minGapMs: phrases inside that gap are joined, so
 *   talking a lot doesn't fill the model's queue (it answers one message at a time).
 *   Filler ("uh", "um") and phrases under minChars don't go to chat.
 * - Subtitles show the last phrases and the one being heard, and clear after holdMs of
 *   silence.
 */

import { LIMITS } from "../events/schema.js";

export const VOICE_LIMITS = Object.freeze({
  /** At most one spoken chat message this often. */
  minGapMs: 4000,
  /** Shorter phrases (after removing filler) stay on the subtitles only. */
  minChars: 3,
  /** Subtitles clear after this long with nothing new heard. */
  holdMs: 4000,
  /** Final phrases kept on the subtitles. */
  subtitleLines: 2,
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

/**
 * What the subtitles show.
 * @param {{holdMs?: number, lines?: number}} [opts]
 */
export function createSubtitles({
  holdMs = VOICE_LIMITS.holdMs,
  lines = VOICE_LIMITS.subtitleLines,
} = {}) {
  let finals = [];
  let interim = "";
  let heardAt = -Infinity;
  return {
    /** The phrase being heard, still changing. */
    interim(text, now) {
      interim = String(text ?? "").trim();
      if (interim) heardAt = now;
    },
    /** A finished phrase. */
    final(text, now) {
      const phrase = String(text ?? "").trim();
      interim = "";
      if (!phrase) return;
      finals = [...finals, phrase].slice(-lines);
      heardAt = now;
    },
    /**
     * @param {number} now
     * @returns {{lines: string[], interim: string} | null} null when there's nothing to show
     */
    current(now) {
      if (now - heardAt > holdMs) {
        finals = [];
        interim = "";
        return null;
      }
      if (finals.length === 0 && !interim) return null;
      return { lines: finals, interim };
    },
    clear() {
      finals = [];
      interim = "";
      heardAt = -Infinity;
    },
  };
}
