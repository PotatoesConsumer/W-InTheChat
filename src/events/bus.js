/**
 * bus.js
 *
 * In-process event bus: the one entry point for events inside the service (and
 * the mock harness). Spec: docs/events.md ("Event bus").
 *
 * - publish() validates first, so subscribers only ever see valid, frozen events.
 * - Dispatch is synchronous and in subscription order, which keeps tests and
 *   harness runs deterministic. Handlers must not block: start async work
 *   (e.g. generation) and return.
 * - A handler that throws is reported to onError and doesn't stop the others.
 */

import { EVENT_KINDS, parseEvent } from "./schema.js";

const ALL = "*";

/**
 * @param {object} [opts]
 * @param {(err: unknown, event: object) => void} [opts.onError] - Called when a handler throws.
 */
export function createEventBus({
  onError = (err) => console.error("Event handler failed:", err),
} = {}) {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map([ALL, ...EVENT_KINDS].map((kind) => [kind, new Set()]));

  return {
    /**
     * @param {unknown} raw - An event, or raw input that should be one.
     * @returns {{ok: true, event: Readonly<object>} | {ok: false, errors: object[]}}
     */
    publish(raw) {
      const result = parseEvent(raw);
      if (!result.ok) return result;

      for (const handler of [...handlers.get(result.event.kind), ...handlers.get(ALL)]) {
        try {
          handler(result.event);
        } catch (err) {
          onError(err, result.event);
        }
      }
      return result;
    },

    /**
     * @param {"game" | "chat" | "*"} kind
     * @param {(event: Readonly<object>) => void} handler
     * @returns {() => void} unsubscribe
     */
    subscribe(kind, handler) {
      if (!handlers.has(kind)) {
        throw new TypeError(
          `unknown event kind "${kind}"; use one of ${[...EVENT_KINDS, ALL].join(", ")}`,
        );
      }
      if (typeof handler !== "function") throw new TypeError("handler must be a function");
      handlers.get(kind).add(handler);
      return () => handlers.get(kind).delete(handler);
    },
  };
}
