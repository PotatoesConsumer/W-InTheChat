/**
 * voice-trial.js
 *
 * `npm run ai:voice`: what each persona says to things the streamer says out loud
 * (voice input), with the real model. Checks by eye that chat plays along with jokes in
 * each persona's voice, and that every line passes the reply check (safety filter
 * included). Needs Ollama with qwen2.5:3b.
 *
 *   npm run ai:voice                  in a run (scene "playing")
 *   npm run ai:voice -- --scene menu  in the game menu: nothing should react to plays
 */

import { parseArgs } from "node:util";

import { OllamaClient } from "../src/ai/ollamaClient.js";
import { buildPrompt } from "../src/ai/contextBuilder.js";
import { PERSONA_PROMPTS, AI_PERSONAS } from "../src/ai/personas/index.js";
import { createChatEvent, SCENES } from "../src/events/schema.js";
import { toContext } from "../src/events/context.js";
import { checkReply } from "../src/service/replyCheck.js";

/** Things a streamer says out loud: jokes and bits first, then plain talk. */
const SPOKEN_LINES = Object.freeze([
  "these slimes are my emotional support enemies",
  "I'm not dying, I'm just testing the respawn",
  "if I clear this wave I'm buying myself a medkit as a treat",
  "chat I think the brute has a crush on me",
  "okay that was a skill issue, but whose skill",
  "what should I buy next",
  "hi chat how is everyone doing",
  "okay chat which game should I play",
]);

const { values } = parseArgs({ options: { scene: { type: "string", default: "playing" } } });
if (!SCENES.includes(values.scene)) {
  console.error(`--scene must be one of ${SCENES.join(", ")}`);
  process.exit(1);
}

const client = new OllamaClient();
const health = await client.health();
if (!health.ok || !health.hasDefaultModel) {
  console.error(`Ollama or ${client.model} isn't available. Start Ollama and pull the model.`);
  process.exit(1);
}
await client.generate("hi", { maxTokens: 1 }); // warm the model

let rejected = 0;
for (const line of SPOKEN_LINES) {
  console.log(`\nStreamer said: "${line}"`);
  const ctx = toContext(createChatEvent(line, { spoken: true, scene: values.scene }));
  for (const persona of AI_PERSONAS) {
    const { system, prompt } = buildPrompt(ctx, { persona });
    const start = Date.now();
    const { text } = await client.generate(prompt, { system, maxTokens: 60 });
    const reply = PERSONA_PROMPTS[persona].parse(text);
    const check = checkReply(reply);
    if (!check.ok) rejected++;
    const flag = check.ok ? "" : `  [rejected: ${check.reason}]`;
    console.log(
      `  ${persona.padEnd(8)} ${String(Date.now() - start).padStart(5)} ms  ${reply}${flag}`,
    );
  }
}
console.log(`\n${rejected} rejected of ${SPOKEN_LINES.length * AI_PERSONAS.length}`);
