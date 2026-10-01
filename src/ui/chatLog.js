/**
 * chatLog.js
 *
 * The chat overlay's state, with no DOM, so it can be unit tested. It applies
 * `chat_message` updates from the service (contract: src/events/chatMessage.js,
 * docs/events.md "Chat messages"):
 *
 * - A new `id` is appended as a new line.
 * - A known `id` replaces that line's message (updates carry the full text so far),
 *   keeping its position in the chat.
 * - Updates after the `done: true` one, older updates arriving late, and invalid
 *   messages are ignored.
 * - The oldest lines are dropped past `maxMessages`.
 *
 * The player's own messages are added with addPlayerMessage(). They come from the
 * player's chat event, not from the service, so they are UI-only entries with
 * `kind: "player"` rather than chat_messages.
 */

import { validateChatMessage } from "../events/chatMessage.js";
import { validateEvent } from "../events/schema.js";

/** Display name for the player until there's login / a name setting. */
export const PLAYER_NAME = "Player";

/**
 * @param {{maxMessages?: number}} [opts]
 */
export function createChatLog({ maxMessages = 150 } = {}) {
  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new RangeError("maxMessages must be a positive integer");
  }

  /** Insertion order is display order; Map.set on an existing key keeps its place. */
  const byId = new Map();

  function add(message) {
    byId.set(message.id, message);
    const removed = [];
    for (const id of byId.keys()) {
      if (byId.size <= maxMessages) break;
      byId.delete(id);
      removed.push(id);
    }
    return { type: "added", message, removed };
  }

  return {
    /**
     * @param {unknown} message - A chat_message, e.g. parsed from the stream.
     * @returns {{type: "added" | "updated", message: object, removed: string[]}
     *   | {type: "ignored", reason: string}}
     *   `removed` lists ids trimmed off the top, so the view can drop them.
     */
    apply(message) {
      const result = validateChatMessage(message);
      if (!result.ok) return { type: "ignored", reason: "invalid" };

      const existing = byId.get(message.id);
      if (existing) {
        if (existing.done) return { type: "ignored", reason: "already done" };
        if (message.ts < existing.ts) return { type: "ignored", reason: "stale" };
        byId.set(message.id, message);
        return { type: "updated", message, removed: [] };
      }

      return add(message);
    },

    /**
     * @param {unknown} event - The player's chat event (from createChatEvent).
     * @returns the same shape as apply(); the message has `kind: "player"`.
     */
    addPlayerMessage(event) {
      if (event?.kind !== "chat" || !validateEvent(event).ok) {
        return { type: "ignored", reason: "invalid" };
      }
      if (byId.has(event.id)) return { type: "ignored", reason: "duplicate" };
      return add(
        Object.freeze({
          id: event.id,
          kind: "player",
          ts: event.ts,
          viewer: PLAYER_NAME,
          text: event.text,
          done: true,
        }),
      );
    },

    /** @returns {object[]} messages, oldest first */
    messages() {
      return [...byId.values()];
    },

    get size() {
      return byId.size;
    },
  };
}
