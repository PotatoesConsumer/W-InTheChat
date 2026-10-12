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
 *
 * Localhost only: it binds 127.0.0.1, refuses other Host headers (DNS rebinding) and
 * only answers cross-origin requests from localhost pages, such as the game dev server.
 */

import { createServer } from "node:http";
import { createEventBus } from "../events/bus.js";
import startPipeline from "./pipeline.js";
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
 * @param {(msg: string, detail?: unknown) => void} [opts.log]
 */
export function createService({
  pipeline = startPipeline,
  deps = {},
  host = SERVICE_DEFAULTS.host,
  port = SERVICE_DEFAULTS.port,
  maxBodyBytes = SERVICE_DEFAULTS.maxBodyBytes,
  heartbeatMs = SERVICE_DEFAULTS.heartbeatMs,
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
    return json(res, 404, { ok: false, error: `no route for ${req.method} ${pathname}` });
  }

  async function postEvent(req, res) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        return json(res, 413, { ok: false, error: `body over ${maxBodyBytes} bytes` });
      }
      chunks.push(chunk);
    }
    let raw;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json(res, 400, { ok: false, errors: [{ path: "", message: "body is not JSON" }] });
    }
    const result = bus.publish(raw);
    return result.ok ? json(res, 202, { ok: true }) : json(res, 400, result);
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
