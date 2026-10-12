/**
 * Guards for the fixed evaluation event set (docs/evaluation.md). These encode what
 * the set has to cover for the study to be meaningful, and stop a frozen set from
 * being edited after evaluation runs have used it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GAME_EVENTS, IMPORTANCE, validateEvent } from "../../src/events/schema.js";
import { eventForStep } from "../../src/harness/scenario.js";
import { loadScenario } from "../../src/harness/load.js";
import { runScenario } from "../../src/harness/runner.js";

const EVAL_DIR = new URL("../../eval/", import.meta.url);
const SET = "eval/event-set-v1.json";

/** Categories a player message's note must start with ("question: about the game"). */
const CHAT_CATEGORIES = Object.freeze([
  "greeting",
  "question",
  "advice-request",
  "reaction",
  "thanks",
  "banter",
  "irrelevant",
  "minimal",
]);

/** Major events closer than this could be coalesced, which would drop study data. */
const MIN_MAJOR_GAP_MS = 3_000;

const { scenario } = await loadScenario(SET);
const game = scenario.steps.filter((s) => s.kind === "game");
const chat = scenario.steps.filter((s) => s.kind === "chat");
const isMajor = (s) => GAME_EVENTS[s.payload.name].importance === IMPORTANCE.MAJOR;

test("every step is a valid game or chat event (no raw or rejected input)", () => {
  assert.deepEqual(
    scenario.steps.filter((s) => s.kind === "raw").map((s) => s.id),
    [],
  );
  for (const step of scenario.steps) {
    assert.deepEqual(validateEvent(eventForStep(step, 0)), { ok: true }, step.id);
  }
});

test("covers every event in the catalog", () => {
  const used = new Set(game.map((s) => s.payload.name));
  const missing = Object.keys(GAME_EVENTS).filter((name) => !used.has(name));
  assert.deepEqual(missing, [], "add these events to the set (or a new version of it)");
});

test("has enough major events, chat messages and minor events to sample from", () => {
  assert.ok(game.filter(isMajor).length >= 8, "at least 8 major events");
  assert.ok(game.filter((s) => !isMajor(s)).length >= 12, "at least 12 minor events");
  assert.ok(chat.length >= 12, "at least 12 player messages");
});

test("every player message has a category, and every category is used", () => {
  const categories = chat.map((s) => s.note?.split(":")[0]);
  for (const [i, category] of categories.entries()) {
    assert.ok(CHAT_CATEGORIES.includes(category), `${chat[i].id}: note must start with a category`);
  }
  const unused = CHAT_CATEGORIES.filter((c) => !categories.includes(c));
  assert.deepEqual(unused, []);
});

test(`major events are at least ${MIN_MAJOR_GAP_MS} ms apart`, () => {
  const majors = game.filter(isMajor);
  for (let i = 1; i < majors.length; i++) {
    const gap = majors[i].at - majors[i - 1].at;
    assert.ok(gap >= MIN_MAJOR_GAP_MS, `${majors[i - 1].id} -> ${majors[i].id}: ${gap} ms`);
  }
});

test("lasts between 2 and 5 minutes, about one study session", () => {
  const duration = scenario.steps.at(-1).at;
  assert.ok(duration >= 120_000 && duration <= 300_000, `${duration} ms`);
});

test("plays through the harness with every step accepted", async () => {
  const record = await runScenario(scenario, { speed: Infinity, settleMs: 2_000 });
  assert.equal(record.events.length, scenario.steps.length);
  assert.ok(record.events.every((e) => e.accepted));
});

test("frozen sets in the manifest still match their recorded hash", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", EVAL_DIR), "utf8"));
  const files = (await readdir(EVAL_DIR)).filter((f) => f !== "manifest.json");
  assert.deepEqual(Object.keys(manifest).sort(), files.sort(), "every set needs a manifest entry");

  for (const [file, entry] of Object.entries(manifest)) {
    assert.ok(
      ["draft", "frozen"].includes(entry.status),
      `${file}: status must be draft or frozen`,
    );
    if (entry.status !== "frozen") continue;
    const sha = createHash("sha256")
      .update(await readFile(new URL(file, EVAL_DIR)))
      .digest("hex");
    assert.equal(sha, entry.sha256, `${file} is frozen: don't edit it, make a new version`);
  }
});
