/**
 * runner.js
 *
 * Plays a scenario into a pipeline, headless, and records everything that happened.
 * The record is plain JSON-safe data: report.js summarizes it, and checks judge it.
 * Spec (pipeline contract, record shape): docs/harness.md.
 *
 * A pipeline is started as `start(bus, emit, deps)` and returns a stop function or
 * `{ stop, idle }`, where `idle()` resolves once no reply is in flight. Without
 * `idle`, the runner waits the full `settleMs` after the last step.
 */

import { createEventBus } from "../events/bus.js";
import { importanceOf } from "../events/schema.js";
import { eventForStep } from "./scenario.js";
import { createFakeGenerator } from "./fakeGenerator.js";
import { seededRandom } from "./seededRandom.js";
import { startStubPipeline } from "./stubPipeline.js";

/**
 * @param {ReturnType<import("./scenario.js").parseScenario>} scenario
 * @param {object} [opts]
 * @param {Function} [opts.pipeline] - `start(bus, emit, deps)`. Defaults to the naive stub.
 * @param {{generate: Function, dispose?: Function}} [opts.generator] - Fake or OllamaClient.
 * @param {"ai" | "scripted"} [opts.condition] - Passed to the pipeline as `deps.condition`.
 * @param {number} [opts.seed] - Seeds `deps.random`.
 * @param {number} [opts.speed] - Playback speed; Infinity publishes every step at once.
 * @param {number} [opts.settleMs] - Longest wait for in-flight replies after the last step.
 * @param {{initial: () => object, reduce: (state: object, event: object) => object}} [opts.stats]
 *   Stats model: the runner applies it to every accepted event and records each state.
 * @returns {Promise<object>} the run record
 */
export async function runScenario(
  scenario,
  {
    pipeline = startStubPipeline,
    generator = createFakeGenerator(),
    condition = "ai",
    seed = 1,
    speed = 1,
    settleMs = 10_500,
    stats,
  } = {},
) {
  if (!(speed > 0)) throw new RangeError("speed must be greater than 0");

  const start = performance.now();
  const t = () => Math.round((performance.now() - start) * 10) / 10;
  // One counter across events and messages: the true order, even within a millisecond
  // (replies sent synchronously during publish come right after their event).
  let seq = 0;
  let open = true;

  const record = {
    scenario: { name: scenario.name, description: scenario.description },
    condition,
    seed,
    speed: speed === Infinity ? "max" : speed,
    events: [],
    messages: [],
    generatorCalls: [],
    handlerErrors: [],
    lateMessages: 0,
    durationMs: 0,
  };
  if (stats) record.stats = [];

  const bus = createEventBus({
    onError: (err, event) =>
      record.handlerErrors.push({ t: t(), eventId: event.id, error: describe(err) }),
  });

  const emit = (message) => {
    if (!open) {
      record.lateMessages++;
      return;
    }
    record.messages.push({ seq: seq++, t: t(), message: toPlain(message) });
  };

  const generate = async (prompt, opts) => {
    const call = { index: record.generatorCalls.length, start: t(), end: null, prompt };
    record.generatorCalls.push(call);
    try {
      const result = await generator.generate(prompt, opts);
      Object.assign(call, { end: t(), outcome: "ok", text: result.text });
      if (result.unsafe) call.unsafe = true;
      return result;
    } catch (err) {
      const outcome =
        err?.name === "AbortError" || err?.name === "TimeoutError" ? "aborted" : "error";
      Object.assign(call, { end: t(), outcome, error: describe(err) });
      throw err;
    }
  };

  if (stats) {
    let state = stats.initial();
    bus.subscribe("*", (event) => {
      try {
        state = stats.reduce(state, event);
      } catch (err) {
        throw new Error(`stats: ${describe(err)}`, { cause: err });
      }
      record.stats.push({ eventId: event.id, state: toPlain(state) });
    });
  }

  const started = pipeline(bus, emit, {
    generate,
    condition,
    random: seededRandom(seed),
  });
  const handle = typeof started === "function" ? { stop: started } : started;
  if (typeof handle?.stop !== "function") {
    throw new TypeError("pipeline must return a stop function or { stop, idle }");
  }

  try {
    for (const step of scenario.steps) {
      const wait = start + step.at / speed - performance.now();
      if (wait > 0) await delay(wait);

      const entry = { seq: seq++, step: step.index, id: step.id, kind: step.kind, t: t() };
      const result = bus.publish(eventForStep(step, Date.now()));
      if (step.note) entry.note = step.note;
      if (result.ok) {
        entry.accepted = true;
        entry.event = toPlain(result.event);
        if (result.event.kind === "game") entry.importance = importanceOf(result.event);
      } else {
        entry.accepted = false;
        entry.errors = result.errors;
      }
      record.events.push(entry);
    }

    const timeout = new AbortController();
    const settle = delay(settleMs, timeout.signal).catch(() => {});
    await (handle.idle ? Promise.race([handle.idle(), settle]) : settle);
    timeout.abort();
  } finally {
    open = false;
    record.durationMs = t();
    handle.stop();
    generator.dispose?.();
  }

  return record;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

/** JSON-safe copy. Anything that can't be serialized is recorded as a string. */
function toPlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function describe(err) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
