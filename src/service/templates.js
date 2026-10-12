/**
 * templates.js
 *
 * Fixed chat lines the pipeline uses without the model:
 *   - template: minor game events (the proposal routes them to templates), and major
 *     events or player messages that arrive while the model is busy
 *   - scripted: the scripted-baseline condition, for every event
 *   - fallback: a safe line when a reply times out, fails or is rejected
 *
 * Every GAME_EVENTS name needs lines here; a test enforces it, so changing the draft
 * catalog fails loudly instead of silently falling back to generic lines.
 */

import { GAME_EVENTS } from "../events/schema.js";

/** Display names per persona. Max 25 chars (MESSAGE_LIMITS.maxViewerLength). */
export const VIEWERS = Object.freeze({
  fan: Object.freeze(["hype_train_99", "gg_goblin", "clutch_or_kick", "pog_patrol", "w_spammer"]),
  hater: Object.freeze(["ratio_enjoyer", "skill_issue_42", "mid_detector"]),
  backseat: Object.freeze(["actually_its_A", "go_left_bro", "coach_from_couch"]),
  lurker: Object.freeze(["quiet_owl", "just_watching", "afk_andy"]),
});

export const EVENT_LINES = Object.freeze({
  round_start: Object.freeze(["here we go", "lock in", "new round lets gooo"]),
  kill: Object.freeze(["clean", "EZ", "got him"]),
  damage_taken: Object.freeze(["ouch", "careful!!", "that hurt to watch"]),
  item_pickup: Object.freeze(["ooh loot", "what did you get?", "nice pickup"]),
  win: Object.freeze(["GG!!", "WWWW", "lets gooo"]),
  loss: Object.freeze(["unlucky", "next one is yours", "so close"]),
  streak: Object.freeze(["on fire 🔥", "cant miss", "who is stopping this"]),
  close_call: Object.freeze(["HOW are you alive", "1 hp gamer", "my heart"]),
  new_best: Object.freeze(["NEW PB!!", "record broken", "history made"]),
});

/** Answers to a typed player message when no model reply is used. */
export const CHAT_LINES = Object.freeze(["real", "true true", "chat agrees", "👀", "lol"]);

/** Safe lines for a reply that timed out, failed or was rejected. */
export const FALLBACK_LINES = Object.freeze([
  "chat is lagging, one sec",
  "my stream froze lol",
  "buffering...",
  "wait what happened",
]);

/**
 * @param {readonly string[]} list
 * @param {() => number} random - Seeded random in [0, 1).
 */
export function pick(list, random) {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * The fixed line for an event: its EVENT_LINES for a game event, CHAT_LINES for chat.
 * @param {{kind: "game" | "chat", name: string | null}} ctx - A context payload.
 * @param {() => number} random
 */
export function lineFor(ctx, random) {
  if (ctx.kind === "chat") return pick(CHAT_LINES, random);
  if (!Object.hasOwn(EVENT_LINES, ctx.name)) {
    throw new TypeError(`no template lines for game event "${ctx.name}"`);
  }
  return pick(EVENT_LINES[ctx.name], random);
}

/** Catalog entries without template lines (should always be empty). */
export function missingEventLines() {
  return Object.keys(GAME_EVENTS).filter((name) => !Object.hasOwn(EVENT_LINES, name));
}
