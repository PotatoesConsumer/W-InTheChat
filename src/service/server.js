/**
 * server.js
 *
 * The local chat service: the transport docs/events.md proposed (POST in, SSE out),
 * built on node:http only. Spec: docs/service.md.
 *
 *   POST /events  one event as JSON -> 202 {ok: true} | 400 {ok: false, errors} | 413
 *   GET  /stream  SSE: `event: chat_message`, one frame per update
 *   GET  /health  {ok: true, clients}
 *   GET  /stats   the pipeline's counts and p50/p95 latency
 *   GET  /condition  {ok: true, condition, conditions}
 *   POST /condition  {condition: "ai" | "scripted"}: restarts the pipeline in that
 *                    condition, with fresh stats and latency. The game's baseline switch.
 *
 * Localhost only: it binds 127.0.0.1, refuses other Host headers (DNS rebinding) and
 * only answers cross-origin requests from localhost pages, such as the game dev server.
 */

import { createServer } from "node:http";
import { createEventBus } from "../events/bus.js";
import startPipeline, { CONDITIONS } from "./pipeline.js";
import { formatSse } from "./sse.js";

export const SERVICE_DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  maxBodyBytes: 8 * 1024,
  heartbeatMs: 15_000,
});

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * @param {object} [opts]
 * @param {Function} [opts.pipeline] - `start(bus, emit, deps)`; the real pipeline by default.
 * @param {object} [opts.deps] - Passed to the pipeline (generate, condition, ...).
 * @param {string} [opts.host]
 * @param {number} [opts.port] - 0 picks a free port.
 * @param {number} [opts.maxBodyBytes]
 * @param {number} [opts.heartbeatMs] - SSE comment interval that keeps idle streams open.
 * @param {(condition: string) => unknown} [opts.prepare] - Awaited before switching to a
 *   condition (e.g. load the model for ai). If it throws, the switch is refused (503).
 * @param {(condition: string, previousStats: object) => void} [opts.onCondition] - After
 *   a switch, with the stats of the pipeline it replaced.
 * @param {(msg: string, detail?: unknown) => void} [opts.log]
 */
export function createService({
  pipeline = startPipeline,
  deps = {},
  host = SERVICE_DEFAULTS.host,
  port = SERVICE_DEFAULTS.port,
  maxBodyBytes = SERVICE_DEFAULTS.maxBodyBytes,
  heartbeatMs = SERVICE_DEFAULTS.heartbeatMs,
  prepare = () => {},
  onCondition = () => {},
  log = () => {},
} = {}) {
  const clients = new Set();
  const bus = createEventBus({
    onError: (err, event) => log(`pipeline handler failed on ${event.id}`, err),
  });
  const emit = (message) => {
    const frame = formatSse("chat_message", message);
    for (const res of clients) res.write(frame);
  };
  let handle = null;
  let condition = deps.condition ?? "ai";
  let switching = Promise.resolve();

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      log("request failed", err);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal error" });
      else res.end();
    });
  });

  async function route(req, res) {
    if (!LOCAL_HOST.test(req.headers.host ?? "")) {
      return json(res, 403, { ok: false, error: "the chat service only answers on localhost" });
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!LOCAL_ORIGIN.test(origin)) {
        return json(res, 403, { ok: false, error: `origin ${origin} is not allowed` });
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }
    if (pathname === "/events" && req.method === "POST") return postEvent(req, res);
    if (pathname === "/stream" && req.method === "GET") return openStream(req, res);
    if (pathname === "/health" && req.method === "GET") {
      return json(res, 200, { ok: true, clients: clients.size });
    }
    if (pathname === "/stats" && req.method === "GET") {
      return json(res, 200, handle?.stats?.() ?? {});
    }
    if (pathname === "/condition" && req.method === "GET") {
      return json(res, 200, { ok: true, condition, conditions: CONDITIONS });
    }
    if (pathname === "/condition" && req.method === "POST") return postCondition(req, res);
    return json(res, 404, { ok: false, error: `no route for ${req.method} ${pathname}` });
  }

  async function postEvent(req, res) {
    const body = await readJson(req, res);
    if (body === undefined) return;
    const result = bus.publish(body);
    return result.ok ? json(res, 202, { ok: true }) : json(res, 400, result);
  }

  async function postCondition(req, res) {
    const body = await readJson(req, res);
    if (body === undefined) return;
    const wanted = body?.condition;
    if (!CONDITIONS.includes(wanted)) {
      return json(res, 400, {
        ok: false,
        errors: [{ path: "condition", message: `must be one of ${CONDITIONS.join(", ")}` }],
      });
    }
    // One switch at a time, in the order they arrive.
    const result = switching.then(() => switchTo(wanted));
    switching = result.catch(() => {});
    const { status, answer } = await result;
    return json(res, status, answer);
  }

  async function switchTo(wanted) {
    if (wanted === condition) return { status: 200, answer: { ok: true, condition } };
    const refuse = (status, err) => ({
      status,
      answer: { ok: false, condition, error: err?.message ?? String(err) },
    });
    try {
      await prepare(wanted);
    } catch (err) {
      log(`could not switch to ${wanted}`, err);
      return refuse(503, err);
    }
    let next;
    try {
      // Start the new pipeline before stopping the old one, so a bad config keeps the old.
      next = normalize(pipeline(bus, emit, { ...deps, condition: wanted }));
    } catch (err) {
      return refuse(409, err);
    }
    const previous = handle;
    previous?.stop();
    handle = next;
    condition = wanted;
    onCondition(condition, previous?.stats?.() ?? {});
    return { status: 200, answer: { ok: true, condition } };
  }

  /** The request body parsed as JSON, or undefined once a 413/400 has been sent. */
  async function readJson(req, res) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        json(res, 413, { ok: false, error: `body over ${maxBodyBytes} bytes` });
        return undefined;
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      json(res, 400, { ok: false, errors: [{ path: "", message: "body is not JSON" }] });
      return undefined;
    }
  }

  function openStream(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    clients.add(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  }

  return {
    bus,
    /** @returns {Promise<{url: string}>} */
    start() {
      handle = normalize(pipeline(bus, emit, deps));
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve({ url: `http://${host}:${server.address().port}` });
        });
      });
    },
    stats: () => handle?.stats?.() ?? {},
    condition: () => condition,
    idle: () => handle?.idle?.() ?? Promise.resolve(),
    async close() {
      handle?.stop();
      for (const res of clients) res.end();
      clients.clear();
      const closed = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

function normalize(started) {
  return typeof started === "function" ? { stop: started } : started;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
