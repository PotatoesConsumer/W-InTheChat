/**
 * chatOverlay.js
 *
 * The chat panel: message list with persona avatar tags, auto-scroll, and the box
 * the player types into. State lives in chatLog.js; this file only renders it.
 *
 * - All text is set with textContent, never innerHTML: chat text comes from a model.
 * - Auto-scroll follows new messages while the list is scrolled to the bottom. If
 *   the player scrolls up to read, it stops following and shows a "New messages"
 *   button instead of yanking them back down.
 */

import { createChatLog } from "./chatLog.js";
import { LIMITS } from "../events/schema.js";

export const PERSONA_LABELS = Object.freeze({
  fan: "Fan",
  hater: "Hater",
  backseat: "Backseat Gamer",
  lurker: "Lurker",
});

/** How close to the bottom (px) still counts as "at the bottom". */
const STICK_THRESHOLD = 24;

/**
 * @param {HTMLElement} root - Empty container; the overlay builds its own markup inside.
 * @param {object} [opts]
 * @param {ReturnType<typeof createChatLog>} [opts.log]
 * @param {(text: string) => void} [opts.onSend] - Called with the trimmed text the player typed.
 */
export function createChatOverlay(root, { log = createChatLog(), onSend = () => {} } = {}) {
  const doc = root.ownerDocument;
  const el = (tag, className) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  root.classList.add("chat");

  const list = el("ol", "chat-list");
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");

  const jump = el("button", "chat-jump");
  jump.type = "button";
  jump.textContent = "New messages ↓";
  jump.hidden = true;

  const form = el("form", "chat-form");
  const input = el("input", "chat-input");
  input.type = "text";
  input.placeholder = "Send a message";
  input.maxLength = LIMITS.maxChatLength;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Send a message to chat");
  const send = el("button", "chat-send");
  send.type = "submit";
  send.textContent = "Chat";
  form.append(input, send);

  root.append(list, jump, form);

  /** @type {Map<string, {line: HTMLElement, text: HTMLElement}>} */
  const nodes = new Map();

  const isAtBottom = () =>
    list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_THRESHOLD;

  function scrollToBottom() {
    list.scrollTop = list.scrollHeight;
    jump.hidden = true;
  }

  function renderLine(message) {
    const isPlayer = message.kind === "player";
    const line = el("li", "chat-line");
    const avatar = el("span", "chat-avatar");
    const name = el("span", "chat-viewer");
    const text = el("span", "chat-text");
    const label = isPlayer ? message.viewer : PERSONA_LABELS[message.persona];
    avatar.textContent = label[0];
    avatar.title = label;
    avatar.setAttribute("aria-label", label);
    name.textContent = message.viewer;
    line.append(avatar);
    if (isPlayer) {
      const badge = el("span", "chat-badge");
      badge.textContent = "ADMIN";
      line.append(badge);
    }
    line.append(name, text);
    return { line, text };
  }

  function fill({ line, text }, message) {
    if (message.kind === "player") {
      line.className = "chat-line player";
    } else {
      line.className = `chat-line persona-${message.persona}`;
      line.classList.toggle("streaming", !message.done);
      // For the evaluation logs and debugging only; never shown to the player.
      line.dataset.source = message.source;
    }
    text.textContent = message.text;
  }

  function show(result, { stick }) {
    if (result.type === "ignored") return result;

    for (const id of result.removed) {
      nodes.get(id)?.line.remove();
      nodes.delete(id);
    }

    const { message } = result;
    let entry = nodes.get(message.id);
    if (!entry) {
      entry = renderLine(message);
      nodes.set(message.id, entry);
      list.append(entry.line);
    }
    fill(entry, message);

    if (stick) scrollToBottom();
    else if (result.type === "added") jump.hidden = false;
    return result;
  }

  list.addEventListener("scroll", () => {
    if (isAtBottom()) jump.hidden = true;
  });
  jump.addEventListener("click", scrollToBottom);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    onSend(text);
  });

  return {
    /**
     * Shows a chat_message (or a streamed update of one).
     * @returns the chatLog result, so callers can log ignored messages.
     */
    push(message) {
      const stick = isAtBottom();
      return show(log.apply(message), { stick });
    },

    /**
     * Shows the player's own message, from the chat event that was published.
     * Always scrolls down: you want to see what you just sent.
     */
    pushPlayer(chatEvent) {
      return show(log.addPlayerMessage(chatEvent), { stick: true });
    },

    focusInput() {
      input.focus();
    },
  };
}
