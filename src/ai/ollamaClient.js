/**
 * ollamaClient.js
 *
 * Thin wrapper around the local Ollama REST API (http://localhost:11434).
 * Owns: connecting, retrying on transient failures, and model selection.
 *
 * Model choice (per the proposal):
 *   - qwen2.5:3b — the one and only primary generation path for personas.
 *     Preliminary testing on the RTX 4050 6GB laptop showed this is faster
 *     than Qwen3 4B Instruct (which also carries a reasoning/thinking step
 *     that blows the latency budget), so Qwen3 is not used in this project.
 *     Model weights are NOT bundled with the repo (Qwen Research License) —
 *     each dev must `ollama pull qwen2.5:3b` locally.
 *   - A hosted LLM API is the documented contingency fallback if local
 *     latency is unacceptable after tuning, but it is NOT implemented yet
 *     (out of scope for the MVP) and must stay opt-in/disclosed when it is.
 */

const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class OllamaError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message);
    this.name = "OllamaError";
    this.status = status;
    if (cause) this.cause = cause;
  }
}

export class OllamaClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.host] - Base URL of the Ollama server.
   * @param {string} [opts.model] - Default model tag to use.
   * @param {number} [opts.maxRetries] - Retries for transient failures.
   * @param {number} [opts.retryDelayMs] - Base delay between retries (backs off linearly).
   * @param {number} [opts.timeoutMs] - Per-request timeout.
   */
  constructor({
    host = DEFAULT_HOST,
    model = DEFAULT_MODEL,
    maxRetries = 2,
    retryDelayMs = 400,
    timeoutMs = 15000,
  } = {}) {
    this.host = host.replace(/\/+$/, "");
    this.model = model;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.timeoutMs = timeoutMs;
  }

  /** Quick reachability + model-loaded check. Does not throw; returns a status object. */
  async health() {
    try {
      const res = await this.#fetchWithTimeout(`${this.host}/api/tags`);
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name);
      return { ok: true, models, hasDefaultModel: models.includes(this.model) };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Generate one completion from a prompt.
   *
   * Pass `onText` to stream: it is called with the full text so far as tokens arrive,
   * and the call still resolves with the complete result. `timeoutMs` only bounds the
   * wait for the response to start; pass `signal` to bound a whole streamed reply.
   *
   * @param {string} prompt
   * @param {object} [opts]
   * @param {string} [opts.model] - Override the default model for this call.
   * @param {string} [opts.system] - System prompt. Replaces the model's built-in one.
   * @param {number} [opts.maxTokens] - Cap on generated tokens (Ollama `num_predict`).
   * @param {AbortSignal} [opts.signal] - Aborts the call. It then rejects with
   *   `signal.reason` and is never retried.
   * @param {(text: string) => void} [opts.onText] - Streaming callback, full text so far.
   * @returns {Promise<{text: string, evalTokens: number, totalMs: number | null}>}
   */
  async generate(prompt, { model, system, maxTokens, signal, onText } = {}) {
    const stream = typeof onText === "function";
    const body = { model: model || this.model, prompt, stream };
    if (system) body.system = system;
    if (maxTokens) body.options = { num_predict: maxTokens };

    const res = await this.#postWithRetry("/api/generate", body, signal);
    const data = stream
      ? await this.#readStream(res, onText, signal)
      : await this.#readJson(res, signal);

    return {
      text: data.response ?? "",
      evalTokens: data.eval_count ?? 0,
      totalMs: data.total_duration ? Math.round(data.total_duration / 1e6) : null,
    };
  }

  /**
   * Vision call: send an image (base64, no data: prefix) alongside a prompt.
   * Left from the original plan; the proposal drops the vision model, so nothing calls it.
   * @param {string} prompt
   * @param {string} imageBase64
   * @param {object} [opts]
   */
  async describeImage(prompt, imageBase64, { model = "moondream" } = {}) {
    const res = await this.#postWithRetry("/api/generate", {
      model,
      prompt,
      images: [imageBase64],
      stream: false,
    });
    const data = await this.#readJson(res);
    return { text: data.response ?? "" };
  }

  /** POST with retries on network errors and RETRYABLE_STATUS. Resolves the ok Response. */
  async #postWithRetry(path, body, signal) {
    const url = `${this.host}${path}`;
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };

    for (let attempt = 0; ; attempt++) {
      let err;
      try {
        const res = await this.#fetchWithTimeout(url, init, signal);
        if (res.ok) return res;
        const detail = await res.text().catch(() => "");
        err = new OllamaError(`Ollama returned HTTP ${res.status}: ${detail}`, {
          status: res.status,
        });
        if (!RETRYABLE_STATUS.has(res.status)) throw err;
      } catch (caught) {
        if (signal?.aborted) throw signal.reason;
        if (caught === err) throw caught; // a status that retrying won't fix
        err = caught;
      }
      if (attempt >= this.maxRetries) throw err;
      await this.#sleep(this.retryDelayMs * (attempt + 1), signal);
    }
  }

  async #fetchWithTimeout(url, options = {}, signal) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const combined = signal ? AbortSignal.any([timeout.signal, signal]) : timeout.signal;
    try {
      return await fetch(url, { ...options, signal: combined });
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.signal.aborted) {
        throw new OllamaError(`Request to ${url} timed out after ${this.timeoutMs}ms`);
      }
      throw new OllamaError(`Could not reach Ollama at ${url}. Is it running?`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  async #readJson(res, signal) {
    try {
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      throw new OllamaError(`Bad response from Ollama: ${err.message}`, { cause: err });
    }
  }

  /**
   * Reads Ollama's NDJSON stream: one JSON object per line, each with the next `response`
   * piece, and a last one with `done: true` and the timing fields.
   */
  async #readStream(res, onText, signal) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let last = {};

    const handleLine = (line) => {
      if (line.trim() === "") return;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch (err) {
        throw new OllamaError(`Bad line in Ollama stream: ${line.slice(0, 80)}`, { cause: err });
      }
      if (chunk.error) throw new OllamaError(`Ollama error: ${chunk.error}`);
      if (chunk.response) {
        text += chunk.response;
        onText(text);
      }
      if (chunk.done) last = chunk;
    };

    try {
      for (;;) {
        let read;
        try {
          read = await reader.read();
        } catch (err) {
          if (signal?.aborted) throw signal.reason;
          throw new OllamaError(`Ollama stream broke: ${err.message}`, { cause: err });
        }
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      }
      handleLine(buffer + decoder.decode());
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }
    return { ...last, response: text };
  }

  #sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
