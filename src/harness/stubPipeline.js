/**
 * stubPipeline.js
 *
 * HARNESS STAND-IN, deliberately naive. It lets the harness run before the real
 * pipeline (Sittipon's W06-W07) exists:
 *   - minor game events: one template reply
 *   - major game events and player chat: one generated reply, or a fallback if the
 *     generator throws
 *
 * It has no coalescing, output filter, timeout or limits, and it sends model output
 * unchecked, so the edge-case scenarios fail against it. That's intended: those
 * failures are what the real pipeline has to fix. Never use it in the game.
 */

import { IMPORTANCE } from "../events/schema.js";
import { toContext } from "../events/context.js";
import { PERSONAS } from "../events/chatMessage.js";

const VIEWERS = {
  fan: "hype_train_99",
  hater: "ratio_enjoyer",
  backseat: "actually_its_A",
  lurker: "quiet_owl",
};

/** Pipeline contract: see docs/harness.md. */
export function startStubPipeline(bus, emit, { generate, random = Math.random }) {
  const pending = new Set();
  let stopped = false;
  let count = 0;

  // Sends raw objects instead of createChatMessage() so that invalid model output
  // reaches the harness record (and fails its checks) instead of throwing here.
  const reply = (event, persona, source, text) => {
    if (stopped) return;
    emit({
      v: 1,
      id: `stub-${count++}`,
      kind: "chat_message",
      ts: Date.now(),
      eventId: event.id,
      persona,
      viewer: VIEWERS[persona],
      source,
      text,
      done: true,
    });
  };

  const off = bus.subscribe("*", (event) => {
    const ctx = toContext(event);
    const persona = PERSONAS[Math.floor(random() * PERSONAS.length)];

    if (ctx.importance === IMPORTANCE.MINOR) {
      reply(event, persona, "template", `streamer just ${ctx.facts.event}`);
      return;
    }

    const task = generate(JSON.stringify(ctx.facts))
      .then(({ text }) => reply(event, persona, "ai", text))
      .catch(() => reply(event, persona, "fallback", "chat is lagging, one sec"))
      .finally(() => pending.delete(task));
    pending.add(task);
  });

  return {
    stop() {
      stopped = true;
      off();
    },
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
