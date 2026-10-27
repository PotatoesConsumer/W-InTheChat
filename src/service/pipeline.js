/**
 * pipeline.js
 *
 * Chat pipeline v1 (W04): bus events in, chat_message updates out. Contract:
 * docs/harness.md ("Pipeline contract"). Behavior and limits: docs/service.md.
 *
 *   minor game event              -> template line (both conditions)
 *   major game event / chat       -> Fan reply from the model              (ai)
 *                                 -> scripted line, model never called     (scripted)
 *   timeout / error / bad output  -> fallback line
 *
 * Every random choice (viewer, line) is drawn when the event arrives, before the model
 * runs, so the same seed and events give the same chat whatever the model returns.
 *
 * Model replies wait in a first-in, first-out queue and run one at a time (one 6 GB GPU).
 * Each has a deadline counted from when its event arrived, so waiting in the queue uses
 * up its time; a reply whose deadline is too close by its turn gets a fallback without
 * calling the model. Never "template if the model is busy": that made the chat depend on
 * timing, so the same events could get different replies (docs/pipeline-contract.md,
 * same-choices). Bursts are handled by coalescing in the router instead (W06).
 *
 * Not yet: persona selection (every reply is the Fan, W06), coalescing (W06),
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
  /**
   * Longest an event waits for its model reply, counted from when it arrived (queue time
   * included). Past it the reply is aborted and a fallback is sent.
   */
  replyTimeoutMs: 5000,
  /** Model replies generating at once. One GPU; Ollama would only queue extras anyway. */
  maxGenerationsInFlight: 1,
  /** Don't start a generation with less time than this left; send the fallback instead. */
  minGenerationMs: 500,
  /** Cap on generated tokens per reply (Ollama num_predict). */
  maxTokens: 48,
  /**
   * Recent chat lines given to the context builder. Off for now: in the first e2e runs
   * qwen2.5:3b copied the lines' "viewer: text" format and phrasing, and invented
   * follow-ups ("4-game streak") from them. Still off with the W05 prompts; revisit with the selector (W06).
   */
  historySize: 0,
  /**
   * Show partial text while the model is still generating. Off: a reply reaches the chat
   * only once it's complete and has passed the reply check, so failed, cut-off or
   * unsafe text is never shown; the game animates the line in instead. A line can't be
   * taken back once shown, so streaming partials can't meet the edge-case contract's
   * fallback and unsafe-output rules (docs/service.md, "Showing replies").
   */
  streamPartials: false,
  /** With streamPartials, a reply is held back until it has this many characters. */
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
  const queue = []; // model replies waiting their turn, oldest first
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

  /**
   * Queues a model reply. The prompt is built now, from the chat as it is when the event
   * arrives, and the deadline starts now too.
   */
  function replyWithModel(ctx, { persona, viewer, fallbackText }) {
    const { system, prompt } = buildPrompt(ctx, { persona, streamerName, history: [...history] });
    queue.push({
      ctx,
      persona,
      viewer,
      fallbackText,
      system,
      prompt,
      deadline: now() + limits.replyTimeoutMs,
    });
    pump();
  }

  /** Starts queued replies while there's a free generation slot. */
  function pump() {
    while (!stopped && queue.length > 0 && active.size < limits.maxGenerationsInFlight) {
      const job = queue.shift();
      const remaining = job.deadline - now();
      if (remaining < limits.minGenerationMs) {
        // Waited too long for a turn: answer now, without the model.
        const { ctx, persona, viewer, fallbackText } = job;
        const sent = send({
          eventId: ctx.eventId,
          persona,
          viewer,
          source: "fallback",
          text: fallbackText,
          done: true,
        });
        if (sent) {
          finished(ctx, {
            source: "fallback",
            text: fallbackText,
            viewer,
            firstAt: sent.ts,
            doneAt: sent.ts,
            failure: "queue_timeout",
          });
        }
        continue;
      }
      runModelReply(job, remaining);
    }
  }

  /** Model reply (streamed if streamPartials); falls back to `fallbackText` if nothing usable was shown. */
  function runModelReply({ ctx, persona, viewer, fallbackText, system, prompt }, remaining) {
    const { parse } = PERSONA_PROMPTS[persona];
    const id = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(`no reply within ${limits.replyTimeoutMs}ms`, "TimeoutError"),
        ),
      remaining,
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
          onText: limits.streamPartials ? onText : undefined,
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
    })().finally(() => {
      active.delete(id);
      pump();
    });

    active.set(id, { controller, task });
  }

  const off = bus.subscribe("*", (event) => {
    if (stopped) return;
    const ctx = toContext(event);

    // Choices first, before the model runs: two draws per event on every path.
    const persona = "fan"; // the selector is W06; no Hater before the safety filter (W07)
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
      queue.length = 0;
      for (const { controller } of active.values()) {
        controller.abort(new DOMException("pipeline stopped", "AbortError"));
      }
    },
    /** Resolves once no model reply is queued or in flight. */
    async idle() {
      while (active.size > 0 || queue.length > 0) {
        await Promise.allSettled([...active.values()].map((a) => a.task));
      }
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
