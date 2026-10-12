/**
 * load.js
 *
 * Node-only file loading for the harness (scenario.js stays browser-safe).
 */

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario } from "./scenario.js";

export const SCENARIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "scenarios");

/**
 * @param {string} nameOrPath - A bundled scenario name ("burst") or a path to a JSON file.
 * @returns {Promise<{scenario: object, path: string, sha256: string}>}
 */
export async function loadScenario(nameOrPath) {
  const isPath = /[\\/]|\.json$/.test(nameOrPath);
  const path = isPath ? resolve(nameOrPath) : join(SCENARIO_DIR, `${nameOrPath}.json`);

  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const known = await listScenarios();
    throw new Error(`No scenario "${nameOrPath}". Bundled scenarios: ${known.join(", ")}`, {
      cause: err,
    });
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${basename(path)} is not valid JSON: ${err.message}`, { cause: err });
  }
  return {
    scenario: parseScenario(json),
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/** Names of the bundled scenarios. */
export async function listScenarios() {
  const files = await readdir(SCENARIO_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}
