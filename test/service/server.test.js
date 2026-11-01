import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createService } from "../../src/service/server.js";
import { readSse } from "../../src/service/sse.js";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";

/** A service on a free port with an instant fake model. Closed after `fn`. */
async function withService(fn, deps = {}) {
  const service = createService({
    port: 0,
    deps: {
      generate: async (_prompt, { onText }) => {
        onText?.("what a play chat!!");
        return { text: "what a play chat!!" };
      },
      random: () => 0,
      ...deps,
    },
  });
  const { url } = await service.start();
  try {
    await fn(url, service);
  } finally {
    await service.close();
  }
}

const post = (url, body, headers = {}) =>
  fetch(`${url}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Opens /stream and collects chat_message frames until `until(messages)` is true. */
async function collect(url, until, trigger) {
  const controller = new AbortController();
  const res = await fetch(`${url}/stream`, { signal: controller.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const messages = [];
  const reading = readSse(res.body, (event, data) => {
    if (event !== "chat_message") return;
    messages.push(data);
    if (until(messages)) controller.abort();
  }).catch((err) => {
    if (err.name !== "AbortError") throw err;
  });
  await trigger();
  await reading;
  return messages;
}

test("an event posted to /events comes back as chat_message frames on /stream", async () => {
  await withService(async (url) => {
    const event = createGameEvent("win", { score: 12 });
    const messages = await collect(
      url,
      (ms) => ms.some((m) => m.done),
      async () => assert.equal((await post(url, event)).status, 202),
    );
    const last = messages.at(-1);
    assert.equal(last.eventId, event.id);
    assert.equal(last.source, "ai");
    assert.equal(last.text, "what a play chat!!");
    assert.equal(last.done, true);
  });
});

test("invalid events get 400 with the schema errors; bad JSON and big bodies are refused", async () => {
  await withService(async (url) => {
    const bad = await post(url, { v: 1, id: "x", kind: "game", ts: 0, name: "headshot", data: {} });
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.equal(body.ok, false);
    assert.deepEqual(
      body.errors.map((e) => e.path),
      ["name"],
    );

    const notJson = await post(url, "{nope");
    assert.equal(notJson.status, 400);
    assert.match((await notJson.json()).errors[0].message, /not JSON/);

    const longest = await post(url, createChatEvent("x".repeat(200)));
    assert.equal(longest.status, 202, "the longest valid event fits the body limit");
    const big = await post(url, JSON.stringify({ pad: "x".repeat(10_000) }));
    assert.equal(big.status, 413);
  });
});

test("CORS: localhost pages are allowed, other origins are refused", async () => {
  await withService(async (url) => {
    const local = await fetch(`${url}/health`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(local.status, 200);
    assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const preflight = await fetch(`${url}/events`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers"), /Content-Type/);

    const evil = await post(url, createGameEvent("win"), { Origin: "https://evil.example" });
    assert.equal(evil.status, 403);
  });
});

test("requests with a non-local Host header are refused (DNS rebinding)", async () => {
  await withService(async (url) => {
    const { port } = new URL(url);
    const status = await new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/health", headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

test("/health, /stats and unknown routes", async () => {
  await withService(async (url, service) => {
    assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true, clients: 0 });

    await post(url, createGameEvent("kill"));
    await service.idle();
    const stats = await (await fetch(`${url}/stats`)).json();
    assert.equal(stats.replies.template, 1);
    assert.equal(stats.latency.all.completion.n, 1);

    assert.equal((await fetch(`${url}/nope`)).status, 404);
  });
});

const setCondition = (url, condition) =>
  fetch(`${url}/condition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ condition }),
  });

test("/condition: read it, switch it, and the new pipeline starts fresh", async () => {
  const switched = [];
  const prepared = [];
  const service = createService({
    port: 0,
    deps: { condition: "scripted", generate: async () => ({ text: "what a play chat!!" }) },
    prepare: (c) => prepared.push(c),
    onCondition: (c, previous) => switched.push([c, previous.condition]),
  });
  const { url } = await service.start();
  try {
    assert.deepEqual(await (await fetch(`${url}/condition`)).json(), {
      ok: true,
      condition: "scripted",
      conditions: ["ai", "scripted"],
    });

    await post(url, createGameEvent("win"));
    await service.idle();
    assert.equal(service.stats().replies.scripted, 1);

    const res = await setCondition(url, "ai");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, condition: "ai" });
    assert.deepEqual(prepared, ["ai"]);
    assert.deepEqual(switched, [["ai", "scripted"]]);
    assert.equal(service.condition(), "ai");
    assert.equal(service.stats().replies.scripted, 0, "stats start fresh");

    await post(url, createGameEvent("win", {}, { id: "after", ts: Date.now() }));
    await service.idle();
    assert.equal(service.stats().replies.ai, 1, "only the new pipeline answers");

    assert.equal((await setCondition(url, "ai")).status, 200, "same condition: nothing to do");
    assert.deepEqual(switched.length, 1);
  } finally {
    await service.close();
  }
});

test("/condition refuses bad input, a failed prepare and a pipeline that can't start", async () => {
  const service = createService({
    port: 0,
    deps: { condition: "scripted" }, // no model: ai can't start
    prepare: (c) => {
      if (c === "ai" && service.failPrepare) throw new Error("Ollama not reachable");
    },
  });
  const { url } = await service.start();
  try {
    assert.equal((await setCondition(url, "both")).status, 400);

    service.failPrepare = true;
    const down = await setCondition(url, "ai");
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), {
      ok: false,
      condition: "scripted",
      error: "Ollama not reachable",
    });

    service.failPrepare = false;
    const noModel = await setCondition(url, "ai");
    assert.equal(noModel.status, 409);
    assert.match((await noModel.json()).error, /generate/);

    assert.equal(service.condition(), "scripted", "the old pipeline keeps running");
    assert.equal((await post(url, createGameEvent("win"))).status, 202);
    await service.idle();
    assert.equal(service.stats().replies.scripted, 1);
  } finally {
    await service.close();
  }
});
