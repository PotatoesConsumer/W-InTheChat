/**
 * contextBuilder.js
 *
 * Context builder v1: context payload (src/events/context.js) -> the prompt for one
 * persona reply. Spec for the payload: docs/events.md ("Context payload").
 *
 * AI boundary (proposal): only `ctx.facts` from the event reaches the model. The
 * service-side fields (eventId, ts, name, importance) never go into the prompt. The
 * builder's own inputs are the persona, the streamer's display name and a few recent
 * chat lines, which docs/events.md allows the context builder to add.
 *
 * Prompts stay short on purpose: prompt length is one of the first things the proposal
 * says to cut if local latency is too high.
 */

import { PERSONA_PROMPTS } from "./personas/index.js";

/** Provisional, like the event limits; revisit after the laptop pilot. */
export const CONTEXT_LIMITS = Object.freeze({
  maxHistory: 5,
  maxHistoryLineLength: 120,
  maxStreamerNameLength: 25,
});

/**
 * A display name the player may set (the profile page): letters (with marks, for Thai),
 * digits, spaces, `_`, `.` and `-`, up to maxStreamerNameLength. The service refuses
 * anything else, so a name can't carry instructions into the prompt.
 */
export const STREAMER_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _.-]{0,24}$/u;

/**
 * @param {ReturnType<import("../events/context.js").toContext>} ctx
 * @param {object} [opts]
 * @param {string} [opts.persona] - Key of PERSONA_PROMPTS.
 * @param {string} [opts.streamerName] - How the streamer is named in the prompt.
 * @param {{viewer: string, text: string}[]} [opts.history] - Recent chat, oldest first.
 *   Only the last CONTEXT_LIMITS.maxHistory lines are used.
 * @returns {Readonly<{persona: string, system: string, prompt: string}>}
 */
export function buildPrompt(
  ctx,
  { persona = "fan", streamerName = "the streamer", history = [] } = {},
) {
  if (!Object.hasOwn(PERSONA_PROMPTS, persona)) {
    throw new TypeError(
      `no prompt for persona "${persona}"; known: ${Object.keys(PERSONA_PROMPTS).join(", ")}`,
    );
  }
  const facts = ctx?.facts;
  if (!facts || typeof facts !== "object") {
    throw new TypeError("ctx must be a context payload from toContext()");
  }
  if (!Array.isArray(history)) throw new TypeError("history must be an array");

  const name = oneLine(streamerName, CONTEXT_LIMITS.maxStreamerNameLength) || "the streamer";
  const lines = [];

  const recent = history
    .slice(-CONTEXT_LIMITS.maxHistory)
    .map((h) => [oneLine(h?.viewer, 25), oneLine(h?.text, CONTEXT_LIMITS.maxHistoryLineLength)])
    .filter(([viewer, text]) => viewer && text);
  if (recent.length > 0) {
    lines.push("Recent chat:", ...recent.map(([viewer, text]) => `${viewer}: ${text}`), "");
  }

  if (typeof facts.playerMessage === "string") {
    const how = facts.spoken === true ? "said on stream" : "typed in chat";
    lines.push(`${name} ${how}: "${oneLine(facts.playerMessage)}"`);
  } else if (typeof facts.event === "string") {
    lines.push(`Event: ${name} just ${facts.event}.`);
    const details = formatDetails(facts.details);
    if (details) lines.push(`Details: ${details}.`);
  } else {
    throw new TypeError("ctx.facts must have an event or a playerMessage");
  }
  lines.push("Write the chat message.");

  return Object.freeze({
    persona,
    system: PERSONA_PROMPTS[persona].system,
    prompt: lines.join("\n"),
  });
}

/** `{score: 12, enemyType: "boss", solo: true}` -> `score 12, enemy type boss, solo yes` */
function formatDetails(details) {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .map(([key, value]) => {
      const label = key
        .replace(/_/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase();
      const shown = typeof value === "boolean" ? (value ? "yes" : "no") : oneLine(String(value));
      return `${label} ${shown}`;
    })
    .join(", ");
}

/** Collapses whitespace (newlines included) and clips to `max` characters. */
function oneLine(value, max = Infinity) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}
