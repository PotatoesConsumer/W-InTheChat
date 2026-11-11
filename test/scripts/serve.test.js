import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { resolveRequestPath } from "../../scripts/serve.js";

const ROOT = resolve("/repo");

test("serves files inside the repo, with / as index.html", () => {
  assert.equal(resolveRequestPath(ROOT, "/"), join(ROOT, "index.html"));
  assert.equal(resolveRequestPath(ROOT, "/src/game/main.js?v=1"), join(ROOT, "src/game/main.js"));
});

test("never serves dotfiles, node_modules, study logs or paths outside the repo", () => {
  for (const url of [
    "/.env",
    "/.git/config",
    "/node_modules/eslint/package.json",
    "/study-logs/P01-ai-2026-11-11.jsonl",
    "/src%2F..%2F..%2Fsecret.txt",
    "/%E0%A4%A",
  ]) {
    assert.equal(resolveRequestPath(ROOT, url), null, url);
  }
});

test("plain ../ segments are resolved by URL parsing and stay inside the repo", () => {
  for (const url of ["/../secret.txt", "/src/%2e%2e/%2e%2e/secret.txt"]) {
    assert.equal(resolveRequestPath(ROOT, url), join(ROOT, "secret.txt"), url);
  }
});
