/**
 * replyCheck.js
 *
 * Checks a parsed model reply before it reaches the chat. v1 catches malformed output:
 * empty, too long, the model talking as an AI, or structured data instead of a chat
 * line. Anything rejected is replaced by a safe fallback line (docs/service.md).
 *
 * NOT a safety filter yet. Blocking abusive or unsafe text (Hater safety rules, the
 * safety test set) is W07 and goes here, as another reason in checkReply.
 */

import { MESSAGE_LIMITS } from "../events/chatMessage.js";

const AI_DISCLOSURE =
  /\b(as an ai|i am an ai|i'm an ai|ai (language )?model|language model|i cannot|i can't (help|assist|watch|see))\b/i;
const STRUCTURED = /^[{[<]/;

/**
 * @param {string} text - A parsed reply (persona parser already applied).
 * @returns {{ok: true, text: string} | {ok: false, reason: "empty" | "too_long" | "ai_disclosure" | "structured"}}
 */
export function checkReply(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (t === "") return { ok: false, reason: "empty" };
  if (t.length > MESSAGE_LIMITS.maxTextLength) return { ok: false, reason: "too_long" };
  if (AI_DISCLOSURE.test(t)) return { ok: false, reason: "ai_disclosure" };
  if (STRUCTURED.test(t)) return { ok: false, reason: "structured" };
  return { ok: true, text: t };
}

/**
 * Whether a partial streamed reply may be shown yet. Holds the start back until it has
 * `minChars`, so a reply that turns out to begin with "As an AI" is never shown.
 * @param {string} text - Parsed partial text.
 * @param {number} minChars
 */
export function canShowPartial(text, minChars) {
  return text.length >= minChars && checkReply(text).ok;
}
