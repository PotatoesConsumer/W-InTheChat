/**
 * personaTrial.js
 *
 * The persona prompt trial (docs/personas.md, "Trials"): fixed inputs, and word checks
 * that flag each reply for the known persona weaknesses. The checks are a starting
 * point for reading the replies, not a measure of quality: they are simple patterns, so
 * they miss things and flag a few lines that are fine. CLI: scripts/persona-trial.js.
 */

import { createGameEvent, createChatEvent, GAME_EVENTS, IMPORTANCE } from "../events/schema.js";
import { checkReply } from "../service/replyCheck.js";

/** Every major event, a loss with details, a minor hit and four player messages. */
export function trialInputs() {
  return [
    ...Object.keys(GAME_EVENTS)
      .filter((name) => GAME_EVENTS[name].importance === IMPORTANCE.MAJOR)
      .map((name) => createGameEvent(name, {})),
    createGameEvent("loss", { score: 3, enemyType: "boss" }),
    createGameEvent("damage_taken", {}),
    createChatEvent("is this boss hard?"),
    createChatEvent("hi chat, how's everyone doing"),
    createChatEvent("I'm actually cracked at this game"),
    createChatEvent("should I go left or right"),
  ];
}

const words = (line) => line.split(/\s+/).filter(Boolean).length;

/**
 * Checks for every persona. Each gets the parsed reply, the context payload and the
 * streamer name, and returns true when the reply has the problem.
 */
const COMMON_CHECKS = {
  failed: (line) => !checkReply(line).ok,
  heShe: (line) => /\b(he|she|his|her|him)\b/i.test(line),
  nameOpener: (line, _ctx, name) =>
    name !== "the streamer" && line.toLowerCase().startsWith(name.toLowerCase()),
  label: (line) => /^[A-Za-z ]{2,15}:\s/.test(line),
};

/** Checks for one persona's known weaknesses (docs/personas.md). */
const PERSONA_CHECKS = {
  fan: {
    lossAsWin: (line, ctx) =>
      /^lost\b/.test(ctx.facts.event ?? "") &&
      /\b(up big|won|win|victory|crush(ed|ing)? it)\b/i.test(line),
  },
  hater: {
    nameCalling: (line) =>
      /\b(clueless|worthless|stupid|idiot|dumb|moron|loser|pathetic|ugly|trash player|useless|nitwit|noob|bot|suck|clown)\b|f\*|fuck|shit|damn/i.test(
        line,
      ),
    greetsAsStreamer: (line) => /^(hey|hi|hello)\b.*\bchat\b/i.test(line),
  },
  backseat: {
    praiseFirst: (line) =>
      /^(good|great|nice|way to go|congrats|well done|well played|wow|awesome|amazing)\b/i.test(
        line,
      ),
    // Broad on purpose: also counts general words like "aim" and "shot".
    invented: (line) =>
      /\b(cooldowns?|combos?|map|team(mates?)?|all(y|ies)|health items?|waves?|gank|cover|corners?|weak spot|scout|tempo|shots?|aim|special moves?|potions?|weapons?|opponents?)\b/i.test(
        line,
      ),
    assistant: (line) => /\b(assist|help you|how can i)\b/i.test(line),
    over15Words: (line) => words(line) > 15,
  },
  lurker: {
    over4Words: (line) => words(line) > 4,
    oddChars: (line) =>
      /[^a-z0-9 '!?.,:()-]/i.test(line.replace(/\p{Extended_Pictographic}/gu, "")) ||
      /^[^a-z]+$/i.test(line),
  },
};

/** Names of the checks run for `persona`, in report order. */
export function checkNames(persona) {
  return Object.keys({ ...COMMON_CHECKS, ...PERSONA_CHECKS[persona] });
}

/**
 * @param {string} persona
 * @param {string} line - The parsed reply.
 * @param {object} ctx - The context payload it answered.
 * @param {string} [streamerName]
 * @returns {string[]} names of the checks the reply fails
 */
export function flagReply(persona, line, ctx, streamerName = "the streamer") {
  const checks = { ...COMMON_CHECKS, ...PERSONA_CHECKS[persona] };
  return Object.entries(checks)
    .filter(([, check]) => check(line, ctx, streamerName))
    .map(([name]) => name);
}
