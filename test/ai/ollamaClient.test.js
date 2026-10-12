import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OllamaClient, OllamaError } from "../../src/ai/ollamaClient.js";

// Tests must not need Ollama, so fetch is replaced for each test.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Installs a fake fetch that answers each call with the next item of `responses`. */
function fakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(init) : next;
  };
  return calls;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** An NDJSON body delivered in the given raw chunks (split anywhere, even mid-line). */
const ndjson = (chunks) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
  );

const client = (opts) => new OllamaClient({ host: "http://ollama.test", retryDelayMs: 1, ...opts });

test("generate sends model, system and token cap, and returns text and timing", async () => {
  const calls = fakeFetch([
    json({ response: "LETS GO", eval_count: 3, total_duration: 165_400_000, done: true }),
  ]);
  const result = await client({ model: "qwen2.5:3b" }).generate("Event: win", {
    system: "You are a fan",
    maxTokens: 48,
  });

  assert.deepEqual(result, { text: "LETS GO", evalTokens: 3, totalMs: 165 });
  assert.equal(calls[0].url, "http://ollama.test/api/generate");
  assert.deepEqual(calls[0].body, {
    model: "qwen2.5:3b",
    prompt: "Event: win",
    stream: false,
    system: "You are a fan",
    options: { num_predict: 48 },
  });
});

test("streams: onText gets the growing text, even when chunks split lines", async () => {
  const lines = [
    { response: "LETS", done: false },
    { response: " GO", done: false },
    { response: "!!", done: false },
    { response: "", done: true, eval_count: 4, total_duration: 90_000_000 },
  ].map((l) => JSON.stringify(l) + "\n");
  const raw = lines.join("");
  const calls = fakeFetch([ndjson([raw.slice(0, 10), raw.slice(10, 47), raw.slice(47)])]);

  const seen = [];
  const result = await client().generate("p", { onText: (t) => seen.push(t) });

  assert.equal(calls[0].body.stream, true);
  assert.deepEqual(seen, ["LETS", "LETS GO", "LETS GO!!"]);
  assert.deepEqual(result, { text: "LETS GO!!", evalTokens: 4, totalMs: 90 });
});

test("an error line in the stream rejects with OllamaError", async () => {
  fakeFetch([ndjson(['{"response":"hi"}\n{"error":"model crashed"}\n'])]);
  await assert.rejects(client().generate("p", { onText: () => {} }), (err) => {
    assert.ok(err instanceof OllamaError);
    assert.match(err.message, /model crashed/);
    return true;
  });
});

test("retries transient failures, then succeeds", async () => {
  const calls = fakeFetch([
    new TypeError("fetch failed"),
    json({ error: "busy" }, 503),
    json({ response: "ok", done: true }),
  ]);
  const result = await client({ maxRetries: 2 }).generate("p");
  assert.equal(result.text, "ok");
  assert.equal(calls.length, 3);
});

test("does not retry a status that retrying won't fix", async () => {
  const calls = fakeFetch([json({ error: "model not found" }, 404)]);
  await assert.rejects(client({ maxRetries: 2 }).generate("p"), (err) => {
    assert.ok(err instanceof OllamaError);
    assert.equal(err.status, 404);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("gives up after maxRetries with the last error", async () => {
  const calls = fakeFetch([new TypeError("fetch failed")]);
  await assert.rejects(client({ maxRetries: 1 }).generate("p"), /Could not reach Ollama/);
  assert.equal(calls.length, 2);
});

test("an aborted signal rejects with its reason and is never retried", async () => {
  const controller = new AbortController();
  const reason = new DOMException("reply timed out", "TimeoutError");
  const calls = fakeFetch([
    (init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
        controller.abort(reason);
      }),
  ]);
  await assert.rejects(client({ maxRetries: 3 }).generate("p", { signal: controller.signal }), {
    name: "TimeoutError",
  });
  assert.equal(calls.length, 1);
});

test("aborting mid-stream stops reading and rejects with the reason", async () => {
  const controller = new AbortController();
  let push;
  fakeFetch([
    (init) =>
      new Response(
        new ReadableStream({
          start(c) {
            push = (s) => c.enqueue(new TextEncoder().encode(s));
            init.signal.addEventListener("abort", () => c.error(init.signal.reason));
          },
        }),
      ),
  ]);
  const seen = [];
  const pending = client().generate("p", {
    signal: controller.signal,
    onText: (t) => {
      seen.push(t);
      controller.abort(new DOMException("stop", "AbortError"));
    },
  });
  await new Promise((r) => setTimeout(r, 5));
  push('{"response":"half"}\n');
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(seen, ["half"]);
});

test("health reports models without throwing", async () => {
  fakeFetch([json({ models: [{ name: "qwen2.5:3b" }] })]);
  assert.deepEqual(await client().health(), {
    ok: true,
    models: ["qwen2.5:3b"],
    hasDefaultModel: true,
  });

  fakeFetch([new TypeError("fetch failed")]);
  const down = await client().health();
  assert.equal(down.ok, false);
  assert.match(down.reason, /Is it running/);
});
