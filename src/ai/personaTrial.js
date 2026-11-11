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
import { PERSONA_PROMPTS } from "./personas/index.js";

/** The details the wave shooter sends with each major event (src/game/shooter/game.js). */
const SHOOTER_DATA = {
  win: { wave: 2, hp: 4, maxHp: 5 },
  loss: { wave: 3, kills: 14 },
  streak: { kills: 10 },
  close_call: { wave: 4, hp: 1, maxHp: 5 },
  new_best: { wave: 6, previousBest: 5 },
};

/**
 * Every major event with the shooter's details, a loss without any, a minor hit and
 * four player messages.
 */
export function trialInputs() {
  return [
    ...Object.keys(GAME_EVENTS)
      .filter((name) => GAME_EVENTS[name].importance === IMPORTANCE.MAJOR)
      .map((name) => createGameEvent(name, SHOOTER_DATA[name] ?? {})),
    createGameEvent("loss", {}),
    createGameEvent("damage_taken", { hp: 3, maxHp: 5 }),
    createChatEvent("is this boss hard?"),
    createChatEvent("hi chat, how's everyone doing"),
    createChatEvent("I'm actually cracked at this game"),
    createChatEvent("should I go left or right"),
  ];
}

const words = (line) => line.split(/\s+/).filter(Boolean).length;
const normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Quoted examples of three words or more in a persona's system prompt. */
export function promptExamples(persona) {
  const system = PERSONA_PROMPTS[persona]?.system ?? "";
  return [...system.matchAll(/"([^"]+)"/g)]
    .map((m) => normalizeText(m[1]))
    .filter((example) => example.split(" ").length >= 3);
}

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
  // The 3B model copies quoted examples from its prompt word for word ("nah not hard,
  // you got this!" on every event); flags a reply holding one of them.
  copiesPrompt: (line, _ctx, _name, persona) =>
    promptExamples(persona).some((example) => normalizeText(line).includes(example)),
  // A number the event's details don't have, like a made-up score (#18's Fan finding).
  // Numbers the player typed count as given.
  inventedNumber: (line, ctx) => {
    const given = new Set(
      [...Object.values(ctx.facts.details ?? {}), ctx.facts.playerMessage ?? ""]
        .join(" ")
        .match(/\d+/g) ?? [],
    );
    return (line.match(/\d+/g) ?? []).some((n) => !given.has(n));
  },
};

/** Checks for one persona's known weaknesses (docs/personas.md). */
const PERSONA_CHECKS = {
  fan: {
    lossAsWin: (line, ctx) =>
      ctx.name === "loss" && /\b(up big|won|win|victory|crush(ed|ing)? it)\b/i.test(line),
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
    // Things the wave shooter doesn't have. Waves, shots, aim, the shop and its items,
    // slimes, bats and brutes are real now (src/ai/personas/game.js).
    invented: (line) =>
      /\b(cooldowns?|combos?|map|team(mates?)?|all(y|ies)|gank|cover|corners?|weak spot|scout|tempo|special moves?|potions?|weapons?|opponents?|reload|ammo|abilit(y|ies)|ult(imate)?|jump)\b/i.test(
        line,
      ),
    assistant: (line) => /\b(assist|help you|how can i)\b/i.test(line),
    over15Words: (line) => words(line) > 15,
  },
  lurker: {
    over4Words: (line) => words(line) > 4,
    // #18: the Lurker answered a 5-kill streak with "hi".
    hiOnEvent: (line, ctx) => ctx.kind === "game" && /^(hi|hey|hello|yo)\b/i.test(line),
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
    .filter(([, check]) => check(line, ctx, streamerName, persona))
    .map(([name]) => name);
}
