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
   * Generate a single completion (non-chat) from a raw prompt.
   * @param {string} prompt
   * @param {object} [opts]
   * @param {string} [opts.model] - Override the default model for this call.
   * @param {boolean} [opts.stream] - Stream tokens (not yet consumed by this wrapper).
   * @returns {Promise<{text: string, evalTokens: number, totalMs: number}>}
   */
  async generate(prompt, { model, stream = false } = {}) {
    const body = {
      model: model || this.model,
      prompt,
      stream,
    };

    const data = await this.#requestWithRetry("/api/generate", body);

    return {
      text: data.response ?? "",
      evalTokens: data.eval_count ?? 0,
      totalMs: data.total_duration ? Math.round(data.total_duration / 1e6) : null,
    };
  }

  /**
   * Vision call: send an image (base64, no data: prefix) alongside a prompt.
   * Intended for the moondream persona-trigger, not the chat models.
   * @param {string} prompt
   * @param {string} imageBase64
   * @param {object} [opts]
   */
  async describeImage(prompt, imageBase64, { model = "moondream" } = {}) {
    const data = await this.#requestWithRetry("/api/generate", {
      model,
      prompt,
      images: [imageBase64],
      stream: false,
    });
    return { text: data.response ?? "" };
  }

  async #requestWithRetry(path, body) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.#fetchWithTimeout(`${this.host}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new OllamaError(`Ollama returned HTTP ${res.status}: ${text}`, {
            status: res.status,
          });
          if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
            lastErr = err;
            await this.#sleep(this.retryDelayMs * (attempt + 1));
            continue;
          }
          throw err;
        }

        return await res.json();
      } catch (err) {
        lastErr = err instanceof OllamaError ? err : new OllamaError(err.message, { cause: err });
        if (attempt < this.maxRetries) {
          await this.#sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }
      }
    }
    throw lastErr;
  }

  async #fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new OllamaError(`Request to ${url} timed out after ${this.timeoutMs}ms`);
      }
      throw new OllamaError(`Could not reach Ollama at ${url}. Is it running?`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
