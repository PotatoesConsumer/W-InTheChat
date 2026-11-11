/**
 * templates.js
 *
 * Fixed chat lines the pipeline uses without the model:
 *   - template: minor game events (the proposal routes them to templates), and major
 *     events or player messages that arrive while the model is busy
 *   - scripted: the scripted-baseline condition, for major events and player messages,
 *     one set per persona (SCRIPTED_LINES) so both conditions show the same persona labels
 *   - fallback: a safe line when a reply times out, fails or is rejected
 *
 * Every GAME_EVENTS name needs lines here, and every major one needs scripted lines for
 * every persona; tests enforce both, so changing the draft catalog fails loudly instead
 * of silently falling back to generic lines.
 */

import { GAME_EVENTS, IMPORTANCE } from "../events/schema.js";

/** Display names per persona. Max 25 chars (MESSAGE_LIMITS.maxViewerLength). */
export const VIEWERS = Object.freeze({
  fan: Object.freeze(["hype_train_99", "gg_goblin", "clutch_or_kick", "pog_patrol", "w_spammer"]),
  hater: Object.freeze(["ratio_enjoyer", "skill_issue_42", "mid_detector"]),
  backseat: Object.freeze(["actually_its_A", "go_left_bro", "coach_from_couch"]),
  lurker: Object.freeze(["quiet_owl", "just_watching", "afk_andy"]),
});

export const EVENT_LINES = Object.freeze({
  round_start: Object.freeze(["here we go", "lock in", "new wave lets gooo"]),
  kill: Object.freeze(["clean", "EZ", "got him"]),
  damage_taken: Object.freeze(["ouch", "careful!!", "that hurt to watch"]),
  item_pickup: Object.freeze(["ooh upgrade", "good buy", "nice pickup"]),
  coin_purchase: Object.freeze(["spending our money already?", "big spender 💰", "coins acquired"]),
  expression: Object.freeze(["the reaction 👀", "facecam is gold today", "we saw that 😂"]),
  win: Object.freeze(["GG!!", "WWWW", "lets gooo"]),
  loss: Object.freeze(["unlucky", "next one is yours", "so close"]),
  streak: Object.freeze(["on fire 🔥", "cant miss", "who is stopping this"]),
  close_call: Object.freeze(["HOW are you alive", "1 hp gamer", "my heart"]),
  new_best: Object.freeze(["NEW PB!!", "record broken", "history made"]),
});

/** Answers to a typed player message when no model reply is used. */
export const CHAT_LINES = Object.freeze(["real", "true true", "chat agrees", "👀", "lol"]);

/**
 * The scripted baseline: fixed lines per persona for each major event and for player
 * messages (`chat`). Written to the voice and safety rules in docs/personas.md, so a
 * blind rater sees the same four personas in both conditions; the Hater mocks the play,
 * never the person.
 */
export const SCRIPTED_LINES = Object.freeze({
  fan: Object.freeze({
    win: Object.freeze(["GG!! you earned that one", "LETS GOOO 🔥", "that was so clean"]),
    loss: Object.freeze(["you'll get the next one!", "unlucky, still a great run", "so close!!"]),
    streak: Object.freeze(["you are unstoppable rn", "streak goes on!! 🔥", "keep it going!!"]),
    close_call: Object.freeze(["HOW did you survive that", "my heart cant take this", "CLUTCH"]),
    new_best: Object.freeze(["NEW PERSONAL BEST!!", "history made today 🏆", "PB PB PB"]),
    chat: Object.freeze(["love this stream", "hi!! having a great time", "you got this"]),
  }),
  hater: Object.freeze({
    win: Object.freeze(["that wave was on easy mode", "lucky win tbh", "wow, the bare minimum"]),
    loss: Object.freeze(["that was rough to watch", "saw that coming", "classic throw"]),
    streak: Object.freeze([
      "it wont last",
      "rng is carrying this streak",
      "wake me up when it ends",
    ]),
    close_call: Object.freeze(["that was pure luck", "almost threw it again", "barely, as usual"]),
    new_best: Object.freeze(["the old best was low anyway", "a new best? low bar", "fluke PB"]),
    chat: Object.freeze(["less talking, more winning", "sure, sure", "says the one who just lost"]),
  }),
  backseat: Object.freeze({
    win: Object.freeze([
      "you still took too long",
      "should've finished it sooner",
      "sloppy start though",
    ]),
    loss: Object.freeze([
      "you should have played safer",
      "slow down next time",
      "you panicked, dont",
    ]),
    streak: Object.freeze([
      "dont get greedy now",
      "stay patient, dont rush",
      "keep your timing tight",
    ]),
    close_call: Object.freeze([
      "play safer, seriously",
      "you waited way too long",
      "dont take that risk",
    ]),
    new_best: Object.freeze(["could've been higher", "now do it faster", "you wasted time early"]),
    chat: Object.freeze(["focus on the game", "obviously go left", "less chat, watch your timing"]),
  }),
  lurker: Object.freeze({
    win: Object.freeze(["gg", "clean", "ez"]),
    loss: Object.freeze(["oof", "rip", "unlucky"]),
    streak: Object.freeze(["nice", "on a roll", "👀"]),
    close_call: Object.freeze(["yikes", "close one", "phew"]),
    new_best: Object.freeze(["pb", "nice pb", "gg"]),
    chat: Object.freeze(["hi", "just lurking", "no idea"]),
  }),
});

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
 * @param {string} [previous] - The line chat just got for the same thing: if the draw
 *   lands on it, the next line is used, so chat never says it twice in a row. Still
 *   deterministic: it depends only on the draws and the earlier choices.
 */
export function pick(list, random, previous) {
  const i = Math.min(list.length - 1, Math.floor(random() * list.length));
  return list.length > 1 && list[i] === previous ? list[(i + 1) % list.length] : list[i];
}

/**
 * The fixed line for an event: its EVENT_LINES for a game event, CHAT_LINES for chat.
 * @param {{kind: "game" | "chat", name: string | null}} ctx - A context payload.
 * @param {() => number} random
 */
export function lineFor(ctx, random, previous) {
  if (ctx.kind === "chat") return pick(CHAT_LINES, random, previous);
  if (!Object.hasOwn(EVENT_LINES, ctx.name)) {
    throw new TypeError(`no template lines for game event "${ctx.name}"`);
  }
  return pick(EVENT_LINES[ctx.name], random, previous);
}

/**
 * The scripted baseline's line for an event: the persona's line for the major event, or
 * its `chat` line for a player message.
 * @param {{kind: "game" | "chat", name: string | null}} ctx - A context payload.
 * @param {string} persona - Key of SCRIPTED_LINES.
 * @param {() => number} random
 * @param {string} [previous] - This persona's last line for the same thing (see pick).
 */
export function scriptedLineFor(ctx, persona, random, previous) {
  const lines = Object.hasOwn(SCRIPTED_LINES, persona) ? SCRIPTED_LINES[persona] : null;
  if (!lines) throw new TypeError(`no scripted lines for persona "${persona}"`);
  const key = ctx.kind === "chat" ? "chat" : ctx.name;
  if (!Object.hasOwn(lines, key)) {
    throw new TypeError(`no scripted ${persona} lines for "${key}"`);
  }
  return pick(lines[key], random, previous);
}

/** `persona:event` pairs the scripted baseline has no lines for (should always be empty). */
export function missingScriptedLines() {
  const keys = [
    ...Object.keys(GAME_EVENTS).filter((n) => GAME_EVENTS[n].importance === IMPORTANCE.MAJOR),
    "chat",
  ];
  return Object.entries(SCRIPTED_LINES).flatMap(([persona, lines]) =>
    keys.filter((k) => !Object.hasOwn(lines, k)).map((k) => `${persona}:${k}`),
  );
}

/** Catalog entries without template lines (should always be empty). */
export function missingEventLines() {
  return Object.keys(GAME_EVENTS).filter((name) => !Object.hasOwn(EVENT_LINES, name));
}
