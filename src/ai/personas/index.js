/**
 * Persona registry: what the context builder and pipeline need from each persona.
 * Ids match PERSONAS in src/events/chatMessage.js. Voice and safety rules for each:
 * docs/personas.md. Which persona answers which event is the selector's job (W06).
 */

import { FAN_SYSTEM_PROMPT } from "./fan.js";
import { HATER_SYSTEM_PROMPT } from "./hater.js";
import { BACKSEAT_SYSTEM_PROMPT } from "./backseat.js";
import { LURKER_SYSTEM_PROMPT } from "./lurker.js";
import { parseChatLine } from "./parse.js";

export const PERSONA_PROMPTS = Object.freeze({
  fan: Object.freeze({ system: FAN_SYSTEM_PROMPT, parse: parseChatLine }),
  hater: Object.freeze({ system: HATER_SYSTEM_PROMPT, parse: parseChatLine }),
  backseat: Object.freeze({ system: BACKSEAT_SYSTEM_PROMPT, parse: parseChatLine }),
  lurker: Object.freeze({ system: LURKER_SYSTEM_PROMPT, parse: parseChatLine }),
});

/** Persona ids that have a prompt, i.e. can get an AI reply. */
export const AI_PERSONAS = Object.freeze(Object.keys(PERSONA_PROMPTS));
