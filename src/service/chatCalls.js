/**
 * chatCalls.js
 *
 * Chat calls: the streamer asks chat to spam something ("W in the chat", "F in chat",
 * "drop a W", "press 1", "spam 🔥"), and chat does, from a few viewers at once. That's
 * how a real stream chat answers, and no single persona reply captures it.
 *
 * A call is answered with fixed lines, the same in both conditions (like the minor-event
 * templates), so it never changes the AI vs scripted comparison and never waits on the
 * model. At most CHAT_CALL_LINES lines, inside the harness's per-event limit. The lines
 * vary by a roll drawn at event arrival, so the same seed and events give the same chat.
 */

import { checkReply } from "./replyCheck.js";
import { seededRandom } from "../game/random.js";

/** Lines a call gets, from different viewers (QA_LIMITS.maxMessagesPerEvent is 3). */
export const CHAT_CALL_LINES = 3;

/** Longest token chat will spam: "W", "GG", "F", "1", "pog", an emoji. */
const MAX_TOKEN = 8;

/**
 * Patterns for a call, each capturing the token. Anchored at the start (after an
 * optional "chat," or "yo"), so "everyone in the chat is great" isn't a call.
 */
const CALLS = [
  // "W in the chat", "drop a W in the chat", "Ws in chat", "put some 🔥 in chat"
  /^(?:(?:chat|yo|ok|okay)[,!]?\s+)?(?:(?:drop|put|spam|send|throw)\s+(?:a|an|some|your|those)?\s*)?(\S{1,4})\s+in\s+(?:the\s+)?chat\b/iu,
  // "press F", "spam W", "type 1 if you're ready", "chat drop a W"
  /^(?:(?:chat|yo|ok|okay)[,!]?\s+)?(?:press|spam|type|drop|send)\s+(?:a\s+|an\s+)?(\S{1,8})(?:\s|$|[!.,])/iu,
];

/** Words that look like a token in those patterns but aren't one ("type something"). */
const NOT_TOKENS = new Set([
  "it",
  "me",
  "us",
  "you",
  "your",
  "that",
  "this",
  "something",
  "anything",
  "here",
  "there",
  "the",
  "if",
  "in",
  "to",
]);

/**
 * The token a message asks chat to spam, or null if it isn't a chat call.
 * @param {string} text - What the streamer typed.
 */
export function chatCall(text) {
  const message = String(text ?? "").trim();
  for (const pattern of CALLS) {
    const match = message.match(pattern);
    if (!match) continue;
    let token = match[1].replace(/^["'`]+|["'`!.,?]+$/g, "");
    if (/^[a-z]s$/i.test(token)) token = token[0]; // "Ws in the chat" -> W
    if (!token || [...token].length > MAX_TOKEN || NOT_TOKENS.has(token.toLowerCase())) continue;
    if (/[/:@]/.test(token)) continue; // no links or mentions
    if (/^[a-z]$/i.test(token) || /^(gg|ez|pog|lol|lmao)$/i.test(token))
      token = token.toUpperCase();
    // Chat only spams what it could say anyway: the same check every chat line gets.
    if (!checkReply(token).ok) return null;
    return token;
  }
  return null;
}

/**
 * The lines chat sends for a call, one per viewer.
 * @param {string} token - From chatCall().
 * @param {string[]} personas - Who answers, in order (CHAT_CALL_LINES of them).
 * @param {number} roll - A random draw in [0, 1), taken at event arrival.
 * @returns {{persona: string, text: string}[]}
 */
export function chatCallLines(token, personas, roll) {
  const random = seededRandom(Math.floor(roll * 2 ** 32));
  const single = [...token].length <= 2 && /^[\p{L}\p{N}]+$/u.test(token);
  const shapes = [
    (t) => t,
    (t) => (single ? t.repeat(3 + Math.floor(random() * 3)) : `${t} ${t}`),
    (t) => `${t} ${t} ${t}`,
    (t) => `${t}!!`,
    (t) => (single ? `${t}${t} ${t}${t}` : `${t} ${t} ${t} ${t}`),
  ];
  return personas.slice(0, CHAT_CALL_LINES).map((persona) => {
    // The Hater answers a W with an L: teasing the play, as always.
    if (persona === "hater" && token === "W")
      return { persona, text: random() < 0.5 ? "L" : "L + ratio" };
    if (persona === "lurker") return { persona, text: token };
    const shape = shapes[Math.floor(random() * shapes.length)];
    return { persona, text: shape(token) };
  });
}
