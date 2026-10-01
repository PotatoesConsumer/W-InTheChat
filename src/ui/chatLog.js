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
 */

import { validateChatMessage } from "../events/chatMessage.js";

/**
 * @param {{maxMessages?: number}} [opts]
 */
export function createChatLog({ maxMessages = 150 } = {}) {
  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new RangeError("maxMessages must be a positive integer");
  }

  /** Insertion order is display order; Map.set on an existing key keeps its place. */
  const byId = new Map();

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

      byId.set(message.id, message);
      const removed = [];
      for (const id of byId.keys()) {
        if (byId.size <= maxMessages) break;
        byId.delete(id);
        removed.push(id);
      }
      return { type: "added", message, removed };
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
