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
 */

import { validateChatMessage } from "../events/chatMessage.js";
import { isPlainObject } from "../events/schema.js";

/**
 * PROVISIONAL limits. The proposal sets the real numbers during the laptop pilot
 * (Sittipon's W08); update them here when it does. Override per run with `limits`.
 */
export const QA_LIMITS = Object.freeze({
  /** Distinct chat messages that may answer one event. */
  maxMessagesPerEvent: 3,
});

/** @typedef {{message: string, eventId?: string, messageId?: string}} Violation */

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
      return { name: c.name, description: c.description, ok: violations.length === 0, violations };
    });
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

function choices(record) {
  return [...groupUpdates(record).values()].map((updates) => {
    const m = updates.at(-1).message;
    return `${m.eventId} ${m.persona}/${m.source}: ${JSON.stringify(m.text)}`;
  });
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
