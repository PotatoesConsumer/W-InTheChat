/**
 * checks.js
 *
 * Deterministic checks over a harness run record (runner.js). Each check is a pure
 * function that returns violations; an empty list means the run passed. The same
 * checks run in the contract tests (test/contracts/), in CI, and at the end of every
 * `npm run harness` run. Rules and rationale: docs/pipeline-contract.md.
 *
 * Two kinds:
 *   - CHECKS judge one run.
 *   - COMPARISONS judge two runs of the same scenario (e.g. same seed twice).
 *
 * A check returns null to say "not applicable to this run" (reported as SKIP). The
 * timing checks do that unless the run played at real-time speed, because a sped-up
 * scenario is a burst by construction.
 */

import { validateChatMessage } from "../events/chatMessage.js";
import { isPlainObject } from "../events/schema.js";

/**
 * Limits every run is judged by, set from the laptop pilot (docs/pilot-w08.md): the
 * slowest real reply took 933 ms and the pipeline times out at 3000 ms. Override per run
 * with `limits`.
 */
export const QA_LIMITS = Object.freeze({
  /** Distinct chat messages that may answer one event. */
  maxMessagesPerEvent: 3,
  /** Longest an event may wait for its completed reply, fallback included. */
  replyTimeoutMs: 3_000,
  /**
   * Slack on top of replyTimeoutMs for the fallback to be sent: one second of pacing,
   * since fallbacks that time out together leave at maxMessagesPerSecond.
   */
  timeoutGraceMs: 1_000,
  /** Generations running at once (one 6 GB GPU). */
  maxGenerationsInFlight: 1,
  /** New chat messages in any one-second window. */
  maxMessagesPerSecond: 5,
  /** Same-name game events closer together than this count as one repeated run. */
  coalesceWindowMs: 2_000,
});

/** @typedef {{message: string, eventId?: string, messageId?: string}} Violation */

// Checks without a `group` are the W06 core checks; `group: "edge-case"` marks W07 ones.

export const CHECKS = Object.freeze([
  {
    name: "messages-valid",
    description: "every update is a valid chat_message",
    run(record) {
      const out = [];
      record.messages.forEach(({ message }, i) => {
        const result = validateChatMessage(message);
        if (result.ok) return;
        const id = isPlainObject(message) ? message.id : undefined;
        for (const e of result.errors) {
          out.push({
            message: `update #${i}${id ? ` (${id})` : ""}: ${e.path || "message"}: ${e.message}`,
            messageId: id,
          });
        }
      });
      return out;
    },
  },
  {
    name: "stream-integrity",
    description: "a streamed message keeps its fields, only grows, and ends with done: true",
    run(record) {
      const out = [];
      for (const [id, updates] of groupUpdates(record)) {
        const first = updates[0].message;
        for (let i = 1; i < updates.length; i++) {
          const prev = updates[i - 1].message;
          const cur = updates[i].message;
          for (const field of ["eventId", "persona", "viewer", "source"]) {
            if (cur[field] !== first[field]) {
              out.push({ messageId: id, message: `${id}: ${field} changed mid-stream` });
            }
          }
          if (prev.done === true) {
            out.push({ messageId: id, message: `${id}: update sent after done: true` });
          }
          if (typeof cur.text === "string" && typeof prev.text === "string") {
            if (!cur.text.startsWith(prev.text)) {
              out.push({ messageId: id, message: `${id}: text must be the full text so far` });
            }
          }
        }
        if (updates.at(-1).message.done !== true) {
          out.push({ messageId: id, message: `${id}: never finished (no done: true update)` });
        }
      }
      return out;
    },
  },
  {
    name: "replies-link-to-events",
    description: "every reply answers an accepted event from this run, after it happened",
    run(record) {
      const out = [];
      const events = new Map(record.events.map((e) => [e.id, e]));
      for (const [id, updates] of groupUpdates(record)) {
        const { eventId } = updates[0].message;
        if (eventId === null || eventId === undefined) continue;
        const entry = events.get(eventId);
        if (!entry)
          out.push({ messageId: id, eventId, message: `${id}: answers unknown event ${eventId}` });
        else if (!entry.accepted) {
          out.push({ messageId: id, eventId, message: `${id}: answers rejected event ${eventId}` });
        } else if (updates[0].seq < entry.seq) {
          out.push({ messageId: id, eventId, message: `${id}: sent before event ${eventId}` });
        }
      }
      return out;
    },
  },
  {
    name: "routing",
    description:
      "minor events get templates, never AI; the scripted condition never uses the model",
    run(record) {
      const out = [];
      const events = new Map(record.events.map((e) => [e.id, e]));
      const generated = new Set(["ai", "fallback"]);

      for (const [id, updates] of groupUpdates(record)) {
        const { eventId, source } = updates[0].message;
        const entry = events.get(eventId);
        if (entry?.importance === "minor" && generated.has(source)) {
          out.push({
            messageId: id,
            eventId,
            message: `${id}: minor event ${eventId} got a "${source}" reply`,
          });
        }
        if (record.condition === "ai" && source === "scripted") {
          out.push({
            messageId: id,
            eventId,
            message: `${id}: "scripted" reply in the AI condition`,
          });
        }
        if (record.condition === "scripted" && generated.has(source)) {
          out.push({
            messageId: id,
            eventId,
            message: `${id}: "${source}" reply in the scripted condition`,
          });
        }
      }
      if (record.condition === "scripted" && record.generatorCalls.length > 0) {
        out.push({
          message: `the model was called ${record.generatorCalls.length} times in the scripted condition`,
        });
      }
      return out;
    },
  },
  {
    name: "response-limits",
    description: "no event gets more than maxMessagesPerEvent messages",
    run(record, limits) {
      const perEvent = new Map();
      for (const [, updates] of groupUpdates(record)) {
        const { eventId } = updates[0].message;
        if (eventId != null) perEvent.set(eventId, (perEvent.get(eventId) ?? 0) + 1);
      }
      return [...perEvent]
        .filter(([, n]) => n > limits.maxMessagesPerEvent)
        .map(([eventId, n]) => ({
          eventId,
          message: `${eventId}: ${n} messages (limit ${limits.maxMessagesPerEvent})`,
        }));
    },
  },
  {
    name: "prompt-boundary",
    description: "prompts carry event facts only: no event ids, timestamps or envelope fields",
    run(record) {
      const out = [];
      const ids = record.events.map((e) => e.id);
      const stamps = record.events.filter((e) => e.accepted).map((e) => String(e.event.ts));
      for (const call of record.generatorCalls) {
        const leaks = [
          ...ids.filter((id) => call.prompt.includes(id)),
          ...stamps.filter((ts) => call.prompt.includes(ts)),
          ...["eventId", '"ts"', '"kind"', '"v"'].filter((key) => call.prompt.includes(key)),
        ];
        if (leaks.length > 0) {
          out.push({
            message: `generator call #${call.index} prompt contains ${leaks.join(", ")}`,
          });
        }
      }
      return out;
    },
  },
  {
    name: "no-handler-errors",
    description: "no pipeline or stats handler threw",
    run(record) {
      return record.handlerErrors.map((e) => ({
        eventId: e.eventId,
        message: `${e.eventId}: ${e.error}`,
      }));
    },
  },
  {
    name: "stats-valid",
    description: "stats are finite, non-negative numbers after every event (skipped if no stats)",
    run(record) {
      const out = [];
      for (const { eventId, state } of record.stats ?? []) {
        if (!isPlainObject(state)) {
          out.push({ eventId, message: `after ${eventId}: stats must be an object` });
          continue;
        }
        for (const [key, value] of Object.entries(state)) {
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            out.push({ eventId, message: `after ${eventId}: ${key} is ${JSON.stringify(value)}` });
          }
        }
      }
      return out;
    },
  },

  // --- W07: edge cases ---
  {
    name: "reply-timeout",
    group: "edge-case",
    description: "every reply, fallback included, completes within replyTimeoutMs of its event",
    run(record, limits) {
      const out = [];
      const events = new Map(record.events.map((e) => [e.id, e]));
      const budget = limits.replyTimeoutMs + limits.timeoutGraceMs;
      for (const [id, updates] of groupUpdates(record)) {
        const entry = events.get(updates[0].message.eventId);
        const done = updates.find((u) => u.message.done === true);
        if (!entry || !done) continue;
        const took = Math.round(done.t - entry.t);
        if (took > budget) {
          out.push({
            messageId: id,
            eventId: entry.id,
            message: `${id}: completed ${took} ms after ${entry.id} (limit ${budget})`,
          });
        }
      }
      return out;
    },
  },
  {
    name: "fallback-on-failure",
    group: "edge-case",
    description: "when generation fails, is too slow or unsafe, chat shows a fallback instead",
    run(record, limits) {
      const failed = record.generatorCalls.filter(
        (c) =>
          c.outcome !== "ok" ||
          c.unsafe ||
          (c.end ?? record.durationMs) - c.start > limits.replyTimeoutMs,
      );
      if (failed.length === 0) return [];
      const fallbacks = [...groupUpdates(record).values()].filter(
        (updates) => updates[0].message.source === "fallback",
      );
      if (fallbacks.length > 0) return [];
      return [
        {
          message: `${failed.length} generations failed, timed out or were unsafe, but no fallback was sent`,
        },
      ];
    },
  },
  {
    name: "ai-text-from-model",
    group: "edge-case",
    description: 'every "ai" reply is text from a generation that succeeded and wasn\'t unsafe',
    run(record) {
      const good = record.generatorCalls
        .filter((c) => c.outcome === "ok" && !c.unsafe)
        .map((c) => normalize(c.text));
      const out = [];
      for (const [id, updates] of groupUpdates(record)) {
        const m = updates.at(-1).message;
        if (m.source !== "ai" || typeof m.text !== "string") continue;
        const text = normalize(m.text);
        if (text && !good.some((g) => g.includes(text) || text.includes(g))) {
          out.push({
            messageId: id,
            message: `${id}: "ai" text matches no successful, safe generation`,
          });
        }
      }
      return out;
    },
  },
  {
    name: "unsafe-blocked",
    group: "edge-case",
    description: "text from an unsafe generation never reaches chat",
    run(record) {
      const unsafe = record.generatorCalls.filter((c) => c.unsafe).map((c) => normalize(c.text));
      const out = [];
      for (const [id, updates] of groupUpdates(record)) {
        for (const { message } of updates) {
          const text = normalize(message.text);
          const hit = unsafe.find((u) => u && text.includes(u));
          if (hit) {
            out.push({ messageId: id, message: `${id}: shows unsafe output "${hit}"` });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    name: "plain-text",
    group: "edge-case",
    description: "chat text is one plain line: no newlines, markdown, JSON or AI disclosures",
    run(record) {
      const out = [];
      for (const [id, updates] of groupUpdates(record)) {
        const { text } = updates.at(-1).message;
        if (typeof text !== "string") continue;
        const problems = [
          /\n/.test(text) && "a newline",
          /```|\*\*|^#+\s/.test(text) && "markdown",
          /^\s*[[{]/.test(text) && "JSON",
          /\bas an ai\b|language model/i.test(text) && "an AI disclosure",
        ].filter(Boolean);
        if (problems.length > 0) {
          out.push({ messageId: id, message: `${id}: text contains ${problems.join(", ")}` });
        }
      }
      return out;
    },
  },
  {
    name: "generation-concurrency",
    group: "edge-case",
    description: "no more than maxGenerationsInFlight generations run at once",
    run(record, limits) {
      const edges = record.generatorCalls.flatMap((c) => [
        [c.start, 1],
        [c.end ?? record.durationMs, -1],
      ]);
      // At equal times, ends come before starts: back-to-back calls don't overlap.
      edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let running = 0;
      let peak = { n: 0, t: 0 };
      for (const [t, delta] of edges) {
        running += delta;
        if (running > peak.n) peak = { n: running, t };
      }
      if (peak.n <= limits.maxGenerationsInFlight) return [];
      return [
        {
          message: `${peak.n} generations in flight at +${Math.round(peak.t)} ms (limit ${limits.maxGenerationsInFlight})`,
        },
      ];
    },
  },
  {
    name: "burst-rate",
    group: "edge-case",
    description: "at most maxMessagesPerSecond new messages in any second (real-time runs only)",
    run(record, limits) {
      if (record.speed !== 1) return null;
      const starts = [...groupUpdates(record).values()].map((u) => u[0].t).sort((a, b) => a - b);
      let peak = { n: 0, t: 0 };
      for (let i = 0, j = 0; j < starts.length; j++) {
        while (starts[j] - starts[i] >= 1_000) i++;
        if (j - i + 1 > peak.n) peak = { n: j - i + 1, t: starts[i] };
      }
      if (peak.n <= limits.maxMessagesPerSecond) return [];
      return [
        {
          message: `${peak.n} new messages within 1 s from +${Math.round(peak.t)} ms (limit ${limits.maxMessagesPerSecond})`,
        },
      ];
    },
  },
  {
    name: "repeat-coalescing",
    group: "edge-case",
    description: "the same event repeated quickly is answered like one event (real-time runs only)",
    run(record, limits) {
      if (record.speed !== 1) return null;
      const replies = new Map();
      for (const [, updates] of groupUpdates(record)) {
        const { eventId } = updates[0].message;
        replies.set(eventId, (replies.get(eventId) ?? 0) + 1);
      }

      const byName = new Map();
      for (const e of record.events) {
        if (!e.accepted || e.event.kind !== "game") continue;
        byName.set(e.event.name, [...(byName.get(e.event.name) ?? []), e]);
      }

      const out = [];
      for (const [name, events] of byName) {
        const runs = [[events[0]]];
        for (const e of events.slice(1)) {
          const run = runs.at(-1);
          if (e.t - run.at(-1).t < limits.coalesceWindowMs) run.push(e);
          else runs.push([e]);
        }
        for (const run of runs) {
          const n = run.reduce((sum, e) => sum + (replies.get(e.id) ?? 0), 0);
          if (run.length > 1 && n > limits.maxMessagesPerEvent) {
            out.push({
              message: `${run.length} "${name}" events in quick succession got ${n} messages (limit ${limits.maxMessagesPerEvent})`,
            });
          }
        }
      }
      return out;
    },
  },
]);

export const COMPARISONS = Object.freeze([
  {
    name: "same-choices",
    description: "same scenario, seed and model output give the same chat",
    run(a, b) {
      return firstDifference(choices(a), choices(b), "reply");
    },
  },
  {
    name: "persona-independent-of-model",
    description: "the persona answering an event doesn't depend on what the model returns",
    run(a, b) {
      const pa = personasByEvent(a);
      const pb = personasByEvent(b);
      const out = [];
      for (const [eventId, personas] of pa) {
        if (!pb.has(eventId)) continue;
        if (personas !== pb.get(eventId)) {
          out.push({
            eventId,
            message: `${eventId}: answered by ${personas} vs ${pb.get(eventId)}`,
          });
        }
      }
      return out;
    },
  },
  {
    name: "same-stats",
    description: "the same events give the same stats, whatever the model said",
    run(a, b) {
      const sa = (a.stats ?? []).map((s) => `${s.eventId} ${JSON.stringify(s.state)}`);
      const sb = (b.stats ?? []).map((s) => `${s.eventId} ${JSON.stringify(s.state)}`);
      return firstDifference(sa, sb, "stats snapshot");
    },
  },
]);

/**
 * @param {object} record - A harness run record.
 * @param {{limits?: Partial<typeof QA_LIMITS>, only?: string[]}} [opts]
 * @returns {{name: string, description: string, ok: boolean, violations: Violation[]}[]}
 */
export function runChecks(record, { limits = {}, only } = {}) {
  return evaluate(CHECKS, only, (check) => check.run(record, { ...QA_LIMITS, ...limits }));
}

/**
 * @param {object} a - First run record.
 * @param {object} b - Second run record of the same scenario.
 * @param {{only?: string[]}} [opts]
 */
export function compareRuns(a, b, { only } = {}) {
  return evaluate(COMPARISONS, only, (comparison) => comparison.run(a, b));
}

function evaluate(list, only, run) {
  if (only) {
    const unknown = only.filter((name) => !list.some((c) => c.name === name));
    if (unknown.length > 0) throw new RangeError(`unknown check: ${unknown.join(", ")}`);
  }
  return list
    .filter((c) => !only || only.includes(c.name))
    .map((c) => {
      const violations = run(c);
      if (violations === null) {
        return {
          name: c.name,
          description: c.description,
          ok: true,
          skipped: true,
          violations: [],
        };
      }
      return { name: c.name, description: c.description, ok: violations.length === 0, violations };
    });
}

/** Lowercase letters and digits separated by single spaces, for loose text matching. */
function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Updates grouped by message id, in emission order. Non-objects are left to messages-valid. */
function groupUpdates(record) {
  const groups = new Map();
  for (const entry of record.messages) {
    if (!isPlainObject(entry.message)) continue;
    const id = entry.message.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return groups;
}

/**
 * Final replies in event order (then first-seen order within an event). Replies to
 * different events can finish in either order when they overlap, which depends on
 * timers (coarse on Windows), so that order isn't a choice and isn't compared.
 */
function choices(record) {
  const eventOrder = new Map(record.events.map((e, i) => [e.id, i]));
  const rank = (m) => eventOrder.get(m.eventId) ?? Infinity;
  return [...groupUpdates(record).values()]
    .map((updates, seen) => ({ m: updates.at(-1).message, seen }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.seen - b.seen)
    .map(({ m }) => `${m.eventId} ${m.persona}/${m.source}: ${JSON.stringify(m.text)}`);
}

function personasByEvent(record) {
  const byEvent = new Map();
  for (const [, updates] of groupUpdates(record)) {
    const { eventId, persona } = updates[0].message;
    if (eventId == null) continue;
    byEvent.set(eventId, [...(byEvent.get(eventId) ?? []), persona]);
  }
  return new Map([...byEvent].map(([id, personas]) => [id, personas.sort().join("+")]));
}

function firstDifference(left, right, what) {
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    if (left[i] !== right[i]) {
      return [
        {
          message: `${what} #${i} differs: ${left[i] ?? "(missing)"} vs ${right[i] ?? "(missing)"}`,
        },
      ];
    }
  }
  return [];
}
