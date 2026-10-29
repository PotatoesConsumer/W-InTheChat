/**
 * schema.js
 *
 * Event schema: the contract between the game (browser) and the local service.
 * Everything that can make the chat react enters the pipeline as one of these events.
 * Spec and rationale: docs/events.md.
 *
 * Kinds:
 *   - "game": something happened in the mini-game. `name` must be in GAME_EVENTS,
 *     which is also the single source of each event's importance.
 *   - "chat": the player typed a message to chat.
 *
 * Uses nothing beyond globalThis.crypto, so the game and the service import the
 * same file. Events are plain JSON so they survive the browser -> service hop.
 */

export const SCHEMA_VERSION = 1;

export const EVENT_KINDS = Object.freeze(["game", "chat"]);

/** Major events may trigger an AI persona response; minor ones go to templates. */
export const IMPORTANCE = Object.freeze({ MINOR: "minor", MAJOR: "major" });

/**
 * Game event catalog, for the wave shooter (src/game/shooter/game.js, which says when
 * each one fires). The names are kept from the first draft, so the evaluation set and
 * harness scenarios still apply; the phrases describe the shooter: a "win" is a cleared
 * wave, a "close_call" a wave cleared on low HP, "new_best" the furthest wave yet.
 *
 * `phrase` completes "<streamer> just ___" and is what prompts and templates
 * use to describe the event (see buildFanPrompt in src/ai/personas/fan.js).
 */
export const GAME_EVENTS = Object.freeze({
  round_start: { importance: IMPORTANCE.MINOR, phrase: "started a new wave" },
  kill: { importance: IMPORTANCE.MINOR, phrase: "took out an enemy" },
  damage_taken: { importance: IMPORTANCE.MINOR, phrase: "took a hit" },
  item_pickup: { importance: IMPORTANCE.MINOR, phrase: "bought an upgrade in the shop" },
  win: { importance: IMPORTANCE.MAJOR, phrase: "cleared a wave" },
  loss: { importance: IMPORTANCE.MAJOR, phrase: "died and lost the run" },
  streak: { importance: IMPORTANCE.MAJOR, phrase: "went on a kill streak without getting hit" },
  close_call: { importance: IMPORTANCE.MAJOR, phrase: "barely survived a wave on low health" },
  new_best: { importance: IMPORTANCE.MAJOR, phrase: "reached their furthest wave yet" },
});

/**
 * Input limits. Provisional: the proposal sets numeric limits during the laptop
 * pilot. `data` is the only game context the model ever sees, so it stays small and flat.
 */
export const LIMITS = Object.freeze({
  maxIdLength: 64,
  maxChatLength: 200,
  maxDataKeys: 8,
  maxDataStringLength: 80,
});

const FIELDS_BY_KIND = {
  game: new Set(["v", "id", "kind", "ts", "name", "data"]),
  chat: new Set(["v", "id", "kind", "ts", "text"]),
};

const DATA_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

export class EventValidationError extends Error {
  constructor(errors, what = "event") {
    super(`Invalid ${what}: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
    this.name = "EventValidationError";
    this.errors = errors;
  }
}

/**
 * @param {string} name - Key of GAME_EVENTS.
 * @param {Record<string, string|number|boolean>} [data] - Flat event details.
 * @param {{id?: string, ts?: number}} [opts] - Fixed id/ts for reproducible event sets.
 * @returns {Readonly<object>} a frozen, validated game event
 * @throws {EventValidationError}
 */
export function createGameEvent(name, data = {}, { id = newId(), ts = Date.now() } = {}) {
  return finalize({ v: SCHEMA_VERSION, id, kind: "game", ts, name, data });
}

/**
 * @param {string} text - What the player typed. Surrounding whitespace is trimmed.
 * @param {{id?: string, ts?: number}} [opts]
 * @returns {Readonly<object>} a frozen, validated chat event
 * @throws {EventValidationError}
 */
export function createChatEvent(text, { id = newId(), ts = Date.now() } = {}) {
  const trimmed = typeof text === "string" ? text.trim() : text;
  return finalize({ v: SCHEMA_VERSION, id, kind: "chat", ts, text: trimmed });
}

/**
 * Checks an event's shape. Use on anything that crossed a boundary (e.g. parsed
 * from a request). Never throws.
 * @param {unknown} event
 * @returns {{ok: true} | {ok: false, errors: {path: string, message: string}[]}}
 */
export function validateEvent(event) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });

  if (!isPlainObject(event)) {
    fail("", "event must be a plain object");
    return { ok: false, errors };
  }

  if (event.v !== SCHEMA_VERSION) fail("v", `unsupported schema version ${event.v}`);

  if (typeof event.id !== "string" || event.id.length === 0) {
    fail("id", "must be a non-empty string");
  } else if (event.id.length > LIMITS.maxIdLength) {
    fail("id", `must be at most ${LIMITS.maxIdLength} characters`);
  }

  if (!Number.isSafeInteger(event.ts) || event.ts < 0) {
    fail("ts", "must be a non-negative integer (ms since epoch)");
  }

  if (!EVENT_KINDS.includes(event.kind)) {
    fail("kind", `must be one of ${EVENT_KINDS.join(", ")}`);
    return { ok: false, errors };
  }

  for (const key of Object.keys(event)) {
    if (!FIELDS_BY_KIND[event.kind].has(key)) fail(key, `unknown field for kind "${event.kind}"`);
  }

  if (event.kind === "game") validateGameFields(event, fail);
  else validateChatFields(event, fail);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Validates raw input (e.g. JSON from the browser) and returns a frozen copy,
 * so nothing downstream can change the caller's object or the event. Never throws.
 * @param {unknown} raw
 * @returns {{ok: true, event: Readonly<object>} | {ok: false, errors: {path: string, message: string}[]}}
 */
export function parseEvent(raw) {
  const result = validateEvent(raw);
  if (!result.ok) return result;
  const event = { ...raw };
  if (event.data) event.data = Object.freeze({ ...event.data });
  return { ok: true, event: Object.freeze(event) };
}

/**
 * @param {{kind: "game", name: string}} event - A valid game event.
 * @returns {"minor" | "major"}
 */
export function importanceOf(event) {
  if (event?.kind !== "game") {
    throw new TypeError("importanceOf only applies to game events; chat has no importance");
  }
  const entry = Object.hasOwn(GAME_EVENTS, event.name) ? GAME_EVENTS[event.name] : null;
  if (!entry) throw new TypeError(`unknown game event "${event.name}"`);
  return entry.importance;
}

function validateGameFields(event, fail) {
  if (typeof event.name !== "string" || !Object.hasOwn(GAME_EVENTS, event.name)) {
    fail("name", `unknown game event "${event.name}"; add it to GAME_EVENTS first`);
  }

  if (!isPlainObject(event.data)) {
    fail("data", "must be a plain object");
    return;
  }

  const entries = Object.entries(event.data);
  if (entries.length > LIMITS.maxDataKeys) {
    fail("data", `must have at most ${LIMITS.maxDataKeys} keys`);
  }
  for (const [key, value] of entries) {
    const path = `data.${key}`;
    if (!DATA_KEY_PATTERN.test(key)) fail(path, "key must match /^[a-z][a-zA-Z0-9_]*$/");

    if (typeof value === "string") {
      if (value.length > LIMITS.maxDataStringLength) {
        fail(path, `string must be at most ${LIMITS.maxDataStringLength} characters`);
      }
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) fail(path, "number must be finite");
    } else if (typeof value !== "boolean") {
      fail(path, "must be a string, number or boolean (no nesting)");
    }
  }
}

function validateChatFields(event, fail) {
  if (typeof event.text !== "string") {
    fail("text", "must be a string");
  } else if (event.text.trim().length === 0) {
    fail("text", "must not be empty");
  } else if (event.text.length > LIMITS.maxChatLength) {
    fail("text", `must be at most ${LIMITS.maxChatLength} characters`);
  }
}

function finalize(event) {
  const result = parseEvent(event);
  if (!result.ok) throw new EventValidationError(result.errors);
  return result.event;
}

/** True for `{}`-style objects (including parsed JSON), false for arrays, null, Dates, etc. */
export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function newId() {
  return globalThis.crypto.randomUUID();
}
