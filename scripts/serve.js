/**
 * serve.js
 *
 * Dev static server for the game: `npm run dev`, then open http://localhost:5173.
 * Browsers won't load ES modules from file://, so the page needs a server. Uses
 * only Node's built-in http module. Localhost only; dotfiles (.env, .git),
 * node_modules and study-logs (participants' sessions) are never served.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 5173;
const PRIVATE = new Set(["node_modules", "study-logs"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

/** @returns {string|null} absolute path inside ROOT, or null if the URL isn't servable */
export function resolveRequestPath(root, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith(".") || PRIVATE.has(s))) return null;

  const file = normalize(join(root, ...segments));
  return file.startsWith(root + sep) ? file : null;
}

const server = createServer(async (req, res) => {
  const file = resolveRequestPath(ROOT, req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  if (!file) return send(res, 404, "Not found");

  try {
    if (!(await stat(file)).isFile()) return send(res, 404, "Not found");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, "Not found");
  }
});

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => {
    console.log(`W-InTheChat dev server: http://localhost:${PORT}`);
  });
}
