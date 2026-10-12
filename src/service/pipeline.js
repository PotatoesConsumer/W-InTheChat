/**
 * pipeline.js
 *
 * Chat pipeline v1 (W04): bus events in, chat_message updates out. Contract:
 * docs/harness.md ("Pipeline contract"). Behavior and limits: docs/service.md.
 *
 *   minor game event              -> template line (both conditions)
 *   major game event / chat       -> Fan reply from the model, streamed     (ai)
 *                                 -> scripted line, model never called     (scripted)
 *   timeout / error / bad output  -> fallback line
 *
 * Every random choice (viewer, line) is drawn when the event arrives, before the model
 * runs, so the same seed and events give the same chat whatever the model returns.
 *
 * Every major event and player message goes to the model, even while another reply is
 * generating: Ollama queues them, and the reply timeout turns a long wait into a fallback.
 * Deciding by "is the model busy right now" would make the chat depend on timing, so the
 * same events could get different replies (docs/pipeline-contract.md, same-choices).
 * Bursts are handled by coalescing in the router instead (W06).
 *
 * Not yet: persona selection (only the Fan has a prompt, W05-W06), coalescing (W06),
 * the safety filter (W07, see replyCheck.js) and the full scripted baseline (W07).
 */

import { IMPORTANCE } from "../events/schema.js";
import { toContext } from "../events/context.js";
import { createChatMessage } from "../events/chatMessage.js";
import { buildPrompt } from "../ai/contextBuilder.js";
import { PERSONA_PROMPTS } from "../ai/personas/index.js";
import { checkReply, canShowPartial } from "./replyCheck.js";
import { VIEWERS, FALLBACK_LINES, lineFor, pick } from "./templates.js";
import { createLatencyLog } from "./latency.js";

/** Provisional; the laptop pilot (W08) sets the real numbers. */
export const PIPELINE_DEFAULTS = Object.freeze({
  /** Abort a model reply after this long and send a fallback instead. */
  replyTimeoutMs: 5000,
  /** Cap on generated tokens per reply (Ollama num_predict). */
  maxTokens: 48,
  /**
   * Recent chat lines given to the context builder. Off for now: in the first e2e runs
   * qwen2.5:3b copied the lines' "viewer: text" format and phrasing, and invented
   * follow-ups ("4-game streak") from them. Revisit with the persona voice rules (W05).
   */
  historySize: 0,
  /** A streamed reply is held back until it has this many characters. */
  minStreamChars: 12,
});

export const CONDITIONS = Object.freeze(["ai", "scripted"]);

/**
 * @param {ReturnType<import("../events/bus.js").createEventBus>} bus
 * @param {(message: Readonly<object>) => void} emit - Receives every chat_message update.
 * @param {object} deps
 * @param {(prompt: string, opts: object) => Promise<{text: string}>} [deps.generate] -
 *   OllamaClient.generate or a fake. Required in the ai condition.
 * @param {"ai" | "scripted"} [deps.condition]
 * @param {() => number} [deps.random] - Seeded in the harness; Math.random otherwise.
 * @param {string} [deps.streamerName]
 * @param {() => number} [deps.now] - Clock for message ts and latency.
 * @param {(row: object) => void} [deps.onReply] - Called once per finished reply (logging).
 *   Any PIPELINE_DEFAULTS key may also be overridden through deps.
 */
export default function startPipeline(bus, emit, deps = {}) {
  const {
    generate,
    condition = "ai",
    random = Math.random,
    streamerName = "the streamer",
    now = Date.now,
    onReply,
  } = deps;
  if (!CONDITIONS.includes(condition)) {
    throw new TypeError(`condition must be one of ${CONDITIONS.join(", ")}`);
  }
  if (condition === "ai" && typeof generate !== "function") {
    throw new TypeError("deps.generate is required in the ai condition");
  }
  const limits = Object.fromEntries(
    Object.entries(PIPELINE_DEFAULTS).map(([key, value]) => [key, deps[key] ?? value]),
  );

  const latency = createLatencyLog();
  const counts = { template: 0, scripted: 0, ai: 0, fallback: 0 };
  const failures = {};
  const history = [];
  const active = new Map(); // message id -> { controller, task }
  let stopped = false;

  function remember(viewer, text) {
    history.push({ viewer, text });
    while (history.length > limits.historySize) history.shift();
  }

  function send(fields) {
    if (stopped) return null;
    const message = createChatMessage({ ...fields, ts: now() });
    emit(message);
    return message;
  }

  function finished(ctx, { source, text, viewer, firstAt, doneAt, failure }) {
    counts[source]++;
    if (failure) failures[failure] = (failures[failure] ?? 0) + 1;
    remember(viewer, text);
    const row = {
      eventId: ctx.eventId,
      source,
      firstTextMs: firstAt - ctx.ts,
      completionMs: doneAt - ctx.ts,
    };
    latency.record(row);
    onReply?.({ ...row, text, failure: failure ?? null });
  }

  /** One-update reply from a fixed line (template, scripted). */
  function replyWithLine(ctx, { persona, viewer, source, text }) {
    const sent = send({ eventId: ctx.eventId, persona, viewer, source, text, done: true });
    if (sent) finished(ctx, { source, text, viewer, firstAt: sent.ts, doneAt: sent.ts });
  }

  /** Streamed model reply; falls back to `fallbackText` if nothing usable was shown. */
  function replyWithModel(ctx, { persona, viewer, fallbackText }) {
    const { system, prompt } = buildPrompt(ctx, { persona, streamerName, history: [...history] });
    const { parse } = PERSONA_PROMPTS[persona];
    const id = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(`no reply within ${limits.replyTimeoutMs}ms`, "TimeoutError"),
        ),
      limits.replyTimeoutMs,
    );
    let shown = ""; // text of the last update sent
    let firstAt = null;
    let done = false;

    const update = (text, isDone, source) => {
      const sent = send({ id, eventId: ctx.eventId, persona, viewer, source, text, done: isDone });
      if (sent) {
        shown = text;
        firstAt ??= sent.ts;
      }
      return sent;
    };

    // Streaming: show a partial only if it passes the checks and extends what's shown,
    // so a message's text only ever grows (docs/events.md, "Streaming").
    const onText = (raw) => {
      if (done || stopped || controller.signal.aborted) return;
      const text = parse(raw);
      if (text === shown || !text.startsWith(shown)) return;
      if (!canShowPartial(text, limits.minStreamChars)) return;
      update(text, false, "ai");
    };

    const task = (async () => {
      let reply = null;
      let failure = null;
      try {
        const result = await generate(prompt, {
          system,
          maxTokens: limits.maxTokens,
          signal: controller.signal,
          onText,
        });
        const check = checkReply(parse(String(result?.text ?? "")));
        if (check.ok) reply = check.text;
        else failure = check.reason;
      } catch (err) {
        failure = err?.name === "TimeoutError" ? "timeout" : "error";
      } finally {
        clearTimeout(timer);
        done = true;
      }
      if (stopped) return;

      let source = "ai";
      let text;
      if (shown) {
        // Already on screen: finish the line. A message never changes source or shrinks,
        // so a bad ending stops at the part already shown.
        text = reply !== null && reply.startsWith(shown) ? reply : shown;
      } else if (reply !== null) {
        text = reply;
      } else {
        source = "fallback";
        text = fallbackText;
      }
      const sent = update(text, true, source);
      if (sent) finished(ctx, { source, text, viewer, firstAt, doneAt: sent.ts, failure });
    })().finally(() => active.delete(id));

    active.set(id, { controller, task });
  }

  const off = bus.subscribe("*", (event) => {
    if (stopped) return;
    const ctx = toContext(event);

    // Choices first, before the model runs: two draws per event on every path.
    const persona = "fan"; // the only persona with a prompt; the selector is W06
    const viewer = pick(VIEWERS[persona], random);
    const roll = random();

    if (ctx.importance === IMPORTANCE.MINOR) {
      replyWithLine(ctx, { persona, viewer, source: "template", text: lineFor(ctx, () => roll) });
    } else if (condition === "scripted") {
      replyWithLine(ctx, { persona, viewer, source: "scripted", text: lineFor(ctx, () => roll) });
    } else {
      replyWithModel(ctx, { persona, viewer, fallbackText: pick(FALLBACK_LINES, () => roll) });
    }

    if (ctx.kind === "chat") remember(streamerName, ctx.facts.playerMessage);
  });

  return {
    stop() {
      stopped = true;
      off();
      for (const { controller } of active.values()) {
        controller.abort(new DOMException("pipeline stopped", "AbortError"));
      }
    },
    /** Resolves once no model reply is in flight. */
    async idle() {
      while (active.size > 0) await Promise.allSettled([...active.values()].map((a) => a.task));
    },
    /** Counts by final source, failure reasons, and p50/p95 latency so far. */
    stats() {
      return {
        condition,
        replies: { ...counts },
        failures: { ...failures },
        latency: latency.summary(),
      };
    },
  };
}
