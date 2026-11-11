import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSafety, hashWord } from "../../src/service/safetyFilter.js";
import { BLOCKLIST } from "../../src/service/blocklist.js";
import { EVENT_LINES, CHAT_LINES, FALLBACK_LINES } from "../../src/service/templates.js";

// The block/allow cases in eval/safety-cases-v1.json are the contract
// (test/contracts/edgeCases.contract.test.js). These cover the rest.

const blockedAs = (text) => checkSafety(text).reason ?? null;

test("the blocklist is hashes only, each with a known category", () => {
  assert.ok(BLOCKLIST.length > 0);
  for (const [hash, category] of BLOCKLIST) {
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(["slur", "profanity"].includes(category), category);
  }
});

test("blocklisted words are caught through leetspeak, spacing, repeats and plurals", () => {
  // A made-up word stands in for a real one, so no real slur is written here.
  const blocked = new Map([[hashWord("zorblax"), "slur"]]);
  for (const text of [
    "zorblax",
    "ZORBLAX!!",
    "z0rbl4x",
    "z o r b l a x",
    "zorrrblax",
    "zorblaxes",
  ]) {
    assert.deepEqual(checkSafety(text, blocked), { ok: false, reason: "slur" }, text);
  }
  assert.equal(checkSafety("zorb lax arena", blocked).ok, true);
});

test("name-calling and insults about the person are blocked", () => {
  for (const text of [
    "you idiot",
    "you're still clueless",
    "ur such a n00b",
    "you are a complete waste",
    "nobody likes you",
    "your mom is ashamed of you",
    // From the Hater trial with qwen2.5:3b (2026-11-01), which passed the first version:
    "Left? You should've went up, mid. losers.",
    "Left? Really? You must be blind.",
    "That was a real skull, my bot. Lost to a boss?",
  ]) {
    assert.equal(blockedAs(text), "personal_attack", text);
  }
});

test("threats, self-harm, doxxing, sexual remarks and group attacks are blocked", () => {
  assert.equal(blockedAs("gonna find u after stream"), "threat");
  assert.equal(blockedAs("k y s"), "self_harm");
  assert.equal(blockedAs("just go die"), "self_harm");
  assert.equal(blockedAs("leaked your address lol"), "privacy");
  assert.equal(blockedAs("show me your feet"), "sexual");
  // From the voice trial: the Fan "playing along" with a joke about a crush.
  assert.equal(blockedAs("LMAO, the brute better send me a boner emoji XD"), "sexual");
  assert.equal(blockedAs("girls can't aim anyway"), "protected_group");
});

test("criticism of plays, in-game violence and hype pass", () => {
  for (const text of [
    "that was the worst dodge I've ever seen",
    "you're so bad it's actually impressive",
    "kill him before he heals!",
    "you died to a slime again 💀",
    "that boss destroyed you",
    "what a stupid play lol",
    "uninstall the game",
    "LETS GOOOO 🔥🔥",
    "1 hp clutch, are you kidding",
  ]) {
    assert.deepEqual(checkSafety(text), { ok: true }, text);
  }
});

test("every template, scripted and fallback line passes the filter", () => {
  const lines = [
    ...Object.values(EVENT_LINES).flat(),
    ...Object.values(CHAT_LINES).flat(),
    ...FALLBACK_LINES,
  ].flat(Infinity);
  const blocked = lines.filter((line) => typeof line === "string" && !checkSafety(line).ok);
  assert.deepEqual(blocked, []);
});
