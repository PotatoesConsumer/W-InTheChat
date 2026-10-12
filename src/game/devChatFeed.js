/**
 * devChatFeed.js
 *
 * DEV PLACEHOLDER. Delete once the service and its SSE stream exist (docs/events.md,
 * "Transport"). Until then this fakes the service side in the browser: it answers
 * events on the bus with streamed `template` chat messages, so the overlay and its
 * streaming can be seen and tested by hand. It is not the scripted baseline and not
 * the AI path.
 */

import { GAME_EVENTS } from "../events/schema.js";
import { createChatMessage } from "../events/chatMessage.js";

const VIEWERS = [
  { persona: "fan", viewer: "hype_train_99" },
  { persona: "hater", viewer: "ratio_enjoyer" },
  { persona: "backseat", viewer: "actually_its_A" },
  { persona: "lurker", viewer: "quiet_owl" },
];

const GAME_LINES = {
  fan: (phrase) => `LETS GO, streamer just ${phrase}!`,
  hater: (phrase) => `wow, you ${phrase}. my grandma does that blindfolded`,
  backseat: (phrase) => `ok you ${phrase} but you should've gone left first`,
  lurker: () => `...`,
};

const CHAT_LINES = {
  fan: () => "streamer talking to us!! best stream",
  hater: () => "less talking more playing",
  backseat: () => "focus on the game, I'll handle chat",
  lurker: () => "hi",
};

/**
 * @param {ReturnType<import("../events/bus.js").createEventBus>} bus
 * @param {(message: object) => void} push - e.g. overlay.push
 * @returns {() => void} stop
 */
export function startDevChatFeed(bus, push, { random = Math.random } = {}) {
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  function stream(eventId, { persona, viewer }, text) {
    const id = globalThis.crypto.randomUUID();
    const words = text.split(" ");
    words.forEach((_, i) => {
      later(
        () =>
          push(
            createChatMessage({
              id,
              eventId,
              persona,
              viewer,
              source: "template",
              text: words.slice(0, i + 1).join(" "),
              done: i === words.length - 1,
            }),
          ),
        250 + i * 80,
      );
    });
  }

  const off = bus.subscribe("*", (event) => {
    const who = VIEWERS[Math.floor(random() * VIEWERS.length)];
    const text =
      event.kind === "game"
        ? GAME_LINES[who.persona](GAME_EVENTS[event.name].phrase)
        : CHAT_LINES[who.persona]();
    stream(event.id, who, text);
  });

  return () => {
    off();
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
}
