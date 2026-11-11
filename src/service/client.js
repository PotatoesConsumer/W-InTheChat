/**
 * client.js
 *
 * Browser side of the service transport (docs/service.md). The game sends events with
 * `send()` and gets chat_message updates through `onMessage`, in place of the dev chat feed.
 *
 *   const chat = connectToService({ onMessage: (m) => overlay.apply(m) });
 *   chat.send(createGameEvent("win", { score: 12 }));
 *
 * Browser-safe (EventSource + fetch); both can be injected for tests.
 */

import { validateChatMessage } from "../events/chatMessage.js";

export const DEFAULT_SERVICE_URL = "http://localhost:8787";

/**
 * @param {object} opts
 * @param {(message: object) => void} opts.onMessage - Every valid chat_message update.
 * @param {(status: "connected" | "reconnecting" | "closed") => void} [opts.onStatus]
 * @param {string} [opts.url]
 * @param {typeof EventSource} [opts.EventSourceImpl]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function connectToService({
  onMessage,
  onStatus = () => {},
  url = DEFAULT_SERVICE_URL,
  EventSourceImpl = globalThis.EventSource,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof onMessage !== "function") throw new TypeError("onMessage must be a function");
  const base = url.replace(/\/+$/, "");

  const source = new EventSourceImpl(`${base}/stream`);
  source.addEventListener("open", () => onStatus("connected"));
  // EventSource reconnects on its own; readyState 2 (CLOSED) means it gave up.
  source.addEventListener("error", () =>
    onStatus(source.readyState === 2 ? "closed" : "reconnecting"),
  );
  source.addEventListener("chat_message", (e) => {
    let message;
    try {
      message = JSON.parse(e.data);
    } catch {
      return;
    }
    if (validateChatMessage(message).ok) onMessage(message);
  });

  async function call(path, init) {
    try {
      const res = await fetchImpl(`${base}${path}`, init);
      return await res.json();
    } catch (err) {
      return {
        ok: false,
        errors: [{ path: "", message: `service unreachable: ${err.message}` }],
      };
    }
  }

  const postJson = (path, body) =>
    call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    /**
     * Posts one event. Resolves the service's answer ({ok: true} or {ok: false, errors});
     * never rejects, so a game loop can fire and forget.
     */
    send(event) {
      return postJson("/events", event);
    },

    /** The service's condition: {ok: true, condition, conditions}. Never rejects. */
    getCondition() {
      return call("/condition");
    },

    /**
     * Switches the service to "ai" or "scripted" (the baseline switch). The service
     * restarts its pipeline, so stats and latency start fresh. `session` labels the
     * study session (a participant id) for the service's session log. Never rejects.
     */
    setCondition(condition, session) {
      return postJson("/condition", session ? { condition, session } : { condition });
    },
    close() {
      source.close();
      onStatus("closed");
    },
  };
}
