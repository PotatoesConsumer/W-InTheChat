/**
 * fakeGenerator.js
 *
 * Stand-in for OllamaClient in tests and harness runs. Same `generate(prompt, opts)`
 * shape and result, no model and no network, and every answer is deterministic
 * (lines are used in order, cycling).
 *
 * Modes:
 *   normal  - short chat lines after `delayMs`
 *   slow    - normal lines after `slowMs`, longer than any sane reply timeout
 *   error   - rejects with an OllamaError, as when Ollama is down
 *   garbage - malformed output: empty, markdown, multi-line, too long, AI disclosures
 *   unsafe  - lines the output filter must block; results carry `unsafe: true`
 *
 * Options a pipeline may pass to generate():
 *   signal - AbortSignal; aborting rejects the call with an AbortError
 *   onText - called with the growing text before the call resolves, to mimic streaming
 */

import { OllamaError } from "../ai/ollamaClient.js";

export const FAKE_MODES = Object.freeze(["normal", "slow", "error", "garbage", "unsafe"]);

export const FAKE_LINES = Object.freeze({
  normal: Object.freeze([
    "LETS GOOO",
    "no way that worked 😂",
    "clip it clip it",
    "bro is cooking",
    "chat did you see that",
    "W streamer",
  ]),
  garbage: Object.freeze([
    "",
    "   ",
    "```\nLETS GO\n```",
    "**HYPE** chat\nsecond line\nthird line",
    "As an AI language model, I cannot watch streams.",
    "LETS GO ".repeat(40).trim(),
    '{"message": "nice shot"}',
  ]),
  // Placeholders until the safety test set lands (W07). Threats and harassment of the
  // streamer as a person: the kind of text the Hater must never produce.
  unsafe: Object.freeze([
    "I know where you live, watch your back",
    "nobody would care if you disappeared",
    "you are worthless as a human being",
  ]),
});

/**
 * @param {object} [opts]
 * @param {"normal"|"slow"|"error"|"garbage"|"unsafe"} [opts.mode]
 * @param {number} [opts.delayMs] - Time to answer in every mode but slow.
 * @param {number} [opts.slowMs] - Time to answer in slow mode.
 * @param {string[]} [opts.lines] - Override the mode's lines.
 * @param {number} [opts.chunks] - How many onText updates a streamed answer gets.
 */
export function createFakeGenerator({
  mode = "normal",
  delayMs = 20,
  slowMs = 15_000,
  lines,
  chunks = 3,
} = {}) {
  if (!FAKE_MODES.includes(mode)) {
    throw new TypeError(`unknown fake mode "${mode}"; use one of ${FAKE_MODES.join(", ")}`);
  }
  const pool = lines ?? FAKE_LINES[mode] ?? FAKE_LINES.normal;
  if (pool.length === 0) throw new TypeError("lines must not be empty");

  const pending = new Set();
  let count = 0;

  return {
    mode,

    /**
     * @param {string} prompt
     * @param {{signal?: AbortSignal, onText?: (text: string) => void}} [opts]
     * @returns {Promise<{text: string, evalTokens: number, totalMs: number, unsafe: boolean}>}
     */
    async generate(prompt, { signal, onText } = {}) {
      if (typeof prompt !== "string") throw new TypeError("prompt must be a string");
      const index = count++;
      const started = Date.now();

      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason ?? abortError());
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      pending.add(controller);

      try {
        await sleep(mode === "slow" ? slowMs : delayMs, controller.signal);
        if (mode === "error") throw new OllamaError("Could not reach Ollama (fake error mode)");

        const text = pool[index % pool.length];
        if (onText) {
          for (const part of streamParts(text, chunks)) {
            onText(part);
            await sleep(0, controller.signal);
          }
        }
        return {
          text,
          evalTokens: text.split(/\s+/).filter(Boolean).length,
          totalMs: Date.now() - started,
          unsafe: mode === "unsafe",
        };
      } finally {
        signal?.removeEventListener("abort", abort);
        pending.delete(controller);
      }
    },

    /** Aborts every call still in flight, so no timers outlive a run. */
    dispose() {
      for (const controller of pending) controller.abort(abortError());
    },
  };
}

/** Growing prefixes of `text`, ending with the whole text. */
export function streamParts(text, chunks) {
  if (text.length === 0) return [text];
  const n = Math.max(1, Math.min(chunks, text.length));
  return Array.from({ length: n }, (_, i) => text.slice(0, Math.ceil(((i + 1) * text.length) / n)));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  return new DOMException("The generation was aborted", "AbortError");
}
