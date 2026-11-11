/**
 * context.js
 *
 * Event -> context payload: what the context builder receives for each event.
 * Spec: docs/events.md ("Context payload").
 *
 * `facts` is the only part of the payload that may go into a prompt (proposal:
 * the model gets only the event or typed-message context it needs). The other
 * fields are for the service: routing, linking replies back to the event, and latency.
 */

import { GAME_EVENTS, EventValidationError, validateEvent } from "./schema.js";

/**
 * @param {object} event - A valid event (from createGameEvent/createChatEvent/parseEvent).
 * @returns {Readonly<{
 *   eventId: string,
 *   ts: number,
 *   kind: "game" | "chat",
 *   name: string | null,
 *   importance: "minor" | "major" | null,
 *   facts: Readonly<{event: string, details: object} | {playerMessage: string}>
 * }>}
 * @throws {EventValidationError} if the event is invalid
 */
export function toContext(event) {
  const result = validateEvent(event);
  if (!result.ok) throw new EventValidationError(result.errors);

  const base = { eventId: event.id, ts: event.ts, kind: event.kind };

  if (event.kind === "game") {
    const { importance, phrase } = GAME_EVENTS[event.name];
    return Object.freeze({
      ...base,
      name: event.name,
      importance,
      facts: Object.freeze({ event: phrase, details: Object.freeze({ ...event.data }) }),
    });
  }

  return Object.freeze({
    ...base,
    name: null,
    importance: null,
    facts: Object.freeze({
      playerMessage: event.text,
      ...(event.spoken && { spoken: true }),
      ...(event.scene && { scene: event.scene }),
    }),
  });
}
