/**
 * safetyFilter.js
 *
 * The output safety filter (W07): every model reply passes through it before it can
 * reach the chat (via checkReply in replyCheck.js). The Hater mocks plays, never people,
 * so harsh criticism of a play passes, and in-game violence ("nice kill!") passes; what's
 * aimed at the person does not.
 *
 * Blocks, by category:
 *   slur, profanity     - words in the hashed blocklist (blocklist.js)
 *   threat              - threats against the streamer, swatting, "watch your back"
 *   self_harm           - telling anyone to hurt or kill themselves
 *   privacy             - real names, addresses, doxxing
 *   sexual              - sexual remarks and requests
 *   protected_group     - jokes or attacks about gender, race, nationality, religion, ...
 *   personal_attack     - insults about the person: name-calling, looks, worth, family
 *
 * Tested against eval/safety-cases-v1.json (contract) and test/service/safetyFilter.test.js.
 * Patterns are English only for now: replies in Thai are a known gap (docs/service.md).
 * Node only (node:crypto), like the rest of the service.
 */

import { createHash } from "node:crypto";
import { BLOCKLIST, BLOCKLIST_SALT } from "./blocklist.js";

const BLOCKED_WORDS = new Map(BLOCKLIST);

const YOU = String.raw`(?:you|u)`;
const YOU_ARE = String.raw`(?:you'?re|you are|ur|u r|u are)`;
const FILLER = String.raw`(?:so|such|a|an|really|literally|just|still|truly|total|complete|absolute|actual|the)`;

/** Checked in order; the first match names the category. */
const PATTERNS = Object.freeze([
  [
    "threat",
    new RegExp(
      [
        String.raw`\bi know where ${YOU} live`,
        String.raw`\bwatch (?:your|ur) back\b`,
        String.raw`\b(?:i'?m|i am|we'?re|gonna|going to|i'?ll|i will|we will|imma)\s+(?:come for|find|hunt|hurt|beat|kill|get|stab|shoot|end)\s+${YOU}\b`,
        String.raw`\bfind ${YOU} (?:after|irl|in real life|offline)`,
        String.raw`\bswat(?:s|ted|ting)?\b`,
        String.raw`\b(?:irl|in real life)\b.{0,30}\b(?:kill|hurt|find|beat|stab)\b`,
      ].join("|"),
    ),
  ],
  [
    "self_harm",
    new RegExp(
      [
        String.raw`\bkys\b`,
        String.raw`\b(?:kill|end|hang|hurt|off)\s+(?:your ?self|urself|yo ?self|ur ?self)\b`,
        String.raw`\bunalive\b`,
        String.raw`\b(?:go|just|pls|please)\s+die\b`,
        String.raw`\b${YOU} should (?:just )?die\b`,
        String.raw`\b(?:nobody|no one) would miss ${YOU}\b`,
        String.raw`\bdrink bleach\b`,
      ].join("|"),
    ),
  ],
  [
    "privacy",
    new RegExp(
      [
        String.raw`\b(?:real|full|legal|irl) name\b`,
        String.raw`\b(?:home address|(?:your|ur) address|phone number|ip address)\b`,
        String.raw`\bwhere ${YOU} live\b`,
        String.raw`\bdox+(?:ed|ing)?\b`,
        String.raw`\bleak(?:ed|ing)? (?:your|ur)\b`,
      ].join("|"),
    ),
  ],
  [
    "sexual",
    new RegExp(
      [
        String.raw`\bsend (?:me )?(?:pics|nudes|noods|feet|a pic)\b`,
        String.raw`\b(?:nudes|noods|onlyfans|horny|sexy|boobs|tits|dick ?pic)\b`,
        String.raw`\bshow (?:me )?(?:your |ur )?(?:body|boobs|tits|ass|feet)\b`,
        String.raw`\b(?:wanna|want to) (?:date|sleep with|smash|kiss) ${YOU}\b`,
      ].join("|"),
    ),
  ],
  [
    "protected_group",
    new RegExp(
      [
        String.raw`\blike a (?:girl|woman)\b`,
        String.raw`\b(?:girls|women) (?:can'?t|cannot|shouldn'?t|don'?t) (?:game|play|stream|aim)\b`,
        String.raw`\b(?:people|guys|folks) (?:from|like) (?:your|ur|you)\b`,
        String.raw`\b(?:your|ur) (?:country|race|religion|people|kind|gender|culture|accent|skin)\b`,
        String.raw`\bgo back to (?:your|ur) (?:country|home)\b`,
        String.raw`\bbecause ${YOU_ARE} (?:a )?(?:girl|woman|gay|black|asian|muslim|jewish|trans|disabled|foreign)\b`,
      ].join("|"),
    ),
  ],
  [
    "personal_attack",
    new RegExp(
      [
        String.raw`\bworthless\b`,
        String.raw`\bas a (?:human|person)\b`,
        String.raw`\b(?:nobody|no one) (?:would )?(?:cares?|likes?|loves?) (?:about )?(?:${YOU}\b|if ${YOU}\b)`,
        String.raw`\b(?:your|ur) (?:family|mom|mum|mother|dad|father|parents|wife|girlfriend|kids?) (?:hates?|is ashamed|are ashamed|left)\b`,
        String.raw`\b${YOU_ARE} (?:${FILLER} )*(?:ugly|fat|stupid|dumb|idiot|moron|loser|clown|pathetic|clueless|useless|worthless|braindead|brain dead|trash|garbage|noob|bot|disgusting|waste|joke)\b`,
        String.raw`\b(?:idiot|moron|imbecile|dumbass|braindead|loser|trash player|garbage player)s?\b`,
        String.raw`\b${YOU} (?:must be|look|sound|seem) (?:${FILLER} )*(?:blind|deaf|stupid|dumb|braindead|ugly|fat|pathetic|clueless|useless)\b`,
        String.raw`\b(?:my|you|ur|such a|what a|absolute) bot\b|\bbot moment\b`,
      ].join("|"),
    ),
  ],
]);

const LEET = { 0: "o", 1: "i", "!": "i", 3: "e", 4: "a", "@": "a", 5: "s", $: "s", 7: "t" };

/** @param {string} word - Lowercase. */
export function hashWord(word) {
  return createHash("sha256")
    .update(BLOCKLIST_SALT + word)
    .digest("hex");
}

/** Lowercase, curly quotes straightened, invisible characters removed. */
function plain(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'");
}

/** Undoes leetspeak next to letters ("n00b", "k!ll"), leaving "1 hp" and "gg!!" alone. */
function unleet(text) {
  return text.replace(/(?<=[a-z])[013457!@$]+|[013457!@$]+(?=[a-z])/g, (run) =>
    [...run].map((c) => LEET[c]).join(""),
  );
}

/** Joins spaced-out letters: "k y s" -> "kys", "f.u.c.k" -> "fuck". */
function joinSpaced(text) {
  return text.replace(/\b(?:[a-z][\s.*_-]){2,}[a-z]\b/g, (m) => m.replace(/[^a-z]/g, ""));
}

/** The forms of a line the checks look at: as written, without leetspeak, letters joined. */
function forms(text) {
  const t = plain(String(text ?? ""));
  const u = unleet(t);
  return [...new Set([t, u, joinSpaced(u)])];
}

function variants(word) {
  const squeezed = word.replace(/(.)\1{2,}/g, "$1");
  const out = new Set([word, squeezed, word.replace(/(.)\1+/g, "$1")]);
  for (const w of [...out]) {
    if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
    if (w.length > 4 && w.endsWith("es")) out.add(w.slice(0, -2));
  }
  return out;
}

/**
 * @param {string} text - A parsed model reply.
 * @param {Map<string, string>} [blocked] - hash -> category; the blocklist by default.
 * @returns {{ok: true} | {ok: false, reason: string}} reason is the category
 */
export function checkSafety(text, blocked = BLOCKED_WORDS) {
  const lines = forms(text);
  for (const line of lines) {
    for (const word of line.split(/[^a-z]+/).filter(Boolean)) {
      for (const v of variants(word)) {
        const category = blocked.get(hashWord(v));
        if (category) return { ok: false, reason: category };
      }
    }
  }
  for (const [category, pattern] of PATTERNS) {
    if (lines.some((line) => pattern.test(line))) return { ok: false, reason: category };
  }
  return { ok: true };
}
