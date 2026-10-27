import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { toContext } from "../../src/events/context.js";
import { PERSONAS } from "../../src/events/chatMessage.js";
import { buildPrompt } from "../../src/ai/contextBuilder.js";
import { PERSONA_PROMPTS, AI_PERSONAS } from "../../src/ai/personas/index.js";
import { parseChatLine } from "../../src/ai/personas/parse.js";
import { parseFanResponse } from "../../src/ai/personas/fan.js";
import { HATER_SYSTEM_PROMPT } from "../../src/ai/personas/hater.js";

const FIXED = { id: "evt-1", ts: 1_700_000_000_000 };

test("every chat persona has a prompt, in the same order", () => {
  assert.deepEqual(AI_PERSONAS, PERSONAS);
});

test("each persona has its own system prompt and the shared parser", () => {
  const systems = AI_PERSONAS.map((p) => PERSONA_PROMPTS[p].system);
  assert.equal(new Set(systems).size, systems.length);
  for (const persona of AI_PERSONAS) {
    const { system, parse } = PERSONA_PROMPTS[persona];
    assert.ok(system.includes("You ARE the viewer"), `${persona}: viewer rule`);
    assert.ok(system.includes("Plain text only"), `${persona}: plain text rule`);
    assert.equal(parse, parseChatLine);
  }
  assert.equal(parseFanResponse, parseChatLine);
});

test("the persona only changes the system prompt, not the event prompt", () => {
  for (const event of [
    createGameEvent("loss", { score: 3 }, FIXED),
    createChatEvent("hi", FIXED),
  ]) {
    const ctx = toContext(event);
    const prompts = AI_PERSONAS.map((persona) => buildPrompt(ctx, { persona }));
    for (const built of prompts) {
      assert.equal(built.system, PERSONA_PROMPTS[built.persona].system);
      assert.equal(built.prompt, prompts[0].prompt);
    }
  }
});

test("the parser drops a copied speaker label but keeps other colons", () => {
  assert.equal(parseChatLine('Player: "Hi there! Slow down."'), "Hi there! Slow down.");
  assert.equal(parseChatLine("chat back: go left"), "go left");
  assert.equal(parseChatLine("Pro tip: wait for it"), "Pro tip: wait for it");
  assert.equal(parseChatLine("gg: ez"), "gg: ez");
});

test("the Hater prompt keeps its safety rules (docs/personas.md)", () => {
  for (const rule of [
    "Mock the play, never the person",
    "calling the streamer names",
    "slurs",
    "threats",
    "hurt themselves",
    "gender, race, nationality",
    "anything sexual",
    "personal info",
  ]) {
    assert.ok(HATER_SYSTEM_PROMPT.includes(rule), `missing: ${rule}`);
  }
});
