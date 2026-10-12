/**
 * Persona registry: what the context builder and pipeline need from each persona.
 * Ids match PERSONAS in src/events/chatMessage.js. Only the Fan exists so far; Hater,
 * Backseat Gamer and Lurker are added here as they land (W05).
 */

import { FAN_SYSTEM_PROMPT, parseFanResponse } from "./fan.js";

export const PERSONA_PROMPTS = Object.freeze({
  fan: Object.freeze({ system: FAN_SYSTEM_PROMPT, parse: parseFanResponse }),
});

/** Persona ids that have a prompt, i.e. can get an AI reply. */
export const AI_PERSONAS = Object.freeze(Object.keys(PERSONA_PROMPTS));
