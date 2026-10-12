/**
 * scenario.js
 *
 * Scenario format for the mock-event harness: a named, timed list of steps that the
 * runner publishes onto the event bus. The fixed evaluation event set uses the same
 * format. Spec: docs/harness.md.
 *
 *   {
 *     "name": "basic-session",
 *     "description": "A short round with a win.",
 *     "steps": [
 *       { "at": 0, "game": "round_start" },
 *       { "at": 1200, "game": "kill", "data": { "combo": 2 } },
 *       { "at": 3000, "chat": "did you see that?" },
 *       { "at": 4000, "raw": { "kind": "game", "name": "headshot" } }
 *     ]
 *   }
 *
 * - `at`: ms from the start of the run, never decreasing.
 * - Exactly one of `game` (+ optional `data`), `chat` or `raw` per step.
 *   - `game` steps are checked against the catalog at load time, so a typo fails loudly.
 *   - `chat` steps are published as the UI would send them (trimmed, not validated),
 *     so empty or oversized player input reaches the bus and gets rejected there.
 *   - `raw` steps are published as-is, for malformed-input scenarios.
 * - `note`: optional, for people reading the scenario (and raters, for the evaluation set).
 *
 * Every step gets a fixed id, `<name>-<index>`, so replies can be matched across runs.
 * `ts` is set when the step is published.
 */

import {
  SCHEMA_VERSION,
  EventValidationError,
  createGameEvent,
  isPlainObject,
} from "../events/schema.js";

const STEP_KEYS = new Set(["at", "game", "data", "chat", "raw", "note"]);
const SOURCES = ["game", "chat", "raw"];
const NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const MAX_NAME_LENGTH = 40;
const MAX_NOTE_LENGTH = 200;

export class ScenarioError extends Error {
  constructor(problems) {
    super(`Invalid scenario: ${problems.join("; ")}`);
    this.name = "ScenarioError";
    this.problems = problems;
  }
}

/**
 * @param {unknown} input - Parsed scenario JSON.
 * @returns {Readonly<{name: string, description: string, steps: ReadonlyArray<Step>}>}
 * @throws {ScenarioError} listing every problem found
 *
 * @typedef {Readonly<{
 *   index: number, id: string, at: number, kind: "game" | "chat" | "raw",
 *   note: string | null, payload: unknown
 * }>} Step
 */
export function parseScenario(input) {
  if (!isPlainObject(input)) throw new ScenarioError(["scenario must be an object"]);

  const problems = [];
  const { name, description = "", steps } = input;

  for (const key of Object.keys(input)) {
    if (!["name", "description", "steps"].includes(key)) problems.push(`${key}: unknown field`);
  }
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    problems.push(`name: must be lowercase kebab-case, at most ${MAX_NAME_LENGTH} characters`);
  }
  if (typeof description !== "string") problems.push("description: must be a string");
  if (!Array.isArray(steps) || steps.length === 0) {
    problems.push("steps: must be a non-empty array");
    throw new ScenarioError(problems);
  }

  const parsed = [];
  let previousAt = 0;
  steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    if (!isPlainObject(step)) {
      problems.push(`${path}: must be an object`);
      return;
    }
    for (const key of Object.keys(step)) {
      if (!STEP_KEYS.has(key)) problems.push(`${path}.${key}: unknown field`);
    }

    if (!Number.isSafeInteger(step.at) || step.at < 0) {
      problems.push(`${path}.at: must be a non-negative integer (ms)`);
    } else if (step.at < previousAt) {
      problems.push(`${path}.at: must not be earlier than the previous step (${previousAt})`);
    } else {
      previousAt = step.at;
    }

    if (step.note !== undefined) {
      if (typeof step.note !== "string" || step.note.length > MAX_NOTE_LENGTH) {
        problems.push(`${path}.note: must be a string of at most ${MAX_NOTE_LENGTH} characters`);
      }
    }

    const sources = SOURCES.filter((key) => key in step);
    if (sources.length !== 1) {
      problems.push(`${path}: needs exactly one of ${SOURCES.join(", ")}`);
      return;
    }
    const [kind] = sources;
    if ("data" in step && kind !== "game")
      problems.push(`${path}.data: only allowed on game steps`);

    const id = `${name}-${String(index).padStart(3, "0")}`;
    const payload = buildPayload(kind, step, id, path, problems);
    parsed.push(Object.freeze({ index, id, at: step.at, kind, note: step.note ?? null, payload }));
  });

  if (problems.length > 0) throw new ScenarioError(problems);
  return Object.freeze({ name, description, steps: Object.freeze(parsed) });
}

/**
 * The object to publish for a step. Game and chat payloads get a fresh `ts`; raw
 * payloads are copied untouched.
 * @param {Step} step
 * @param {number} ts
 */
export function eventForStep(step, ts) {
  if (step.kind === "raw") return structuredClone(step.payload);
  return { ...step.payload, ts };
}

function buildPayload(kind, step, id, path, problems) {
  if (kind === "raw") return step.raw;

  if (kind === "chat") {
    if (typeof step.chat !== "string") {
      problems.push(`${path}.chat: must be a string (it may be empty)`);
      return null;
    }
    return Object.freeze({ v: SCHEMA_VERSION, id, kind: "chat", text: step.chat.trim() });
  }

  try {
    const { ts: _ts, ...event } = createGameEvent(step.game, step.data ?? {}, { id, ts: 0 });
    return Object.freeze(event);
  } catch (err) {
    if (!(err instanceof EventValidationError)) throw err;
    for (const e of err.errors) problems.push(`${path}: ${e.path}: ${e.message}`);
    return null;
  }
}
