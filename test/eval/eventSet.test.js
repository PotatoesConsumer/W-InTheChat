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
import { playShooter } from "../../src/harness/shooterBot.js";
import { ENEMY_TYPES } from "../../src/game/shooter/waves.js";
import { SHOP_ITEMS, COIN_PACKS } from "../../src/game/shooter/shop.js";
import { LOW_HP_FRACTION } from "../../src/game/shooter/game.js";

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
  // Optional extensions (the camera) are off in the study, so the set leaves them out.
  const missing = Object.keys(GAME_EVENTS).filter(
    (name) => !used.has(name) && !GAME_EVENTS[name].optional,
  );
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

test("game events carry the data the wave shooter sends", () => {
  // What the real game sends, from bot-played runs: a sloppy bot gets close calls, a sharp
  // one new bests. The bot never buys coin packs.
  const sent = { coin_purchase: new Set(["coins,dollars,pack"]) };
  const runs = [1, 2, 3].flatMap((seed) => [0.3, 0.9].map((skill) => ({ seed, skill })));
  for (const { seed, skill } of runs) {
    for (const step of playShooter({ seed, skill, durationMs: 300_000, chatEveryMs: 0 }).steps) {
      (sent[step.game] ??= new Set()).add(
        Object.keys(step.data ?? {})
          .sort()
          .join(","),
      );
    }
  }
  const items = SHOP_ITEMS.map((i) => i.name);
  for (const { id, payload } of game) {
    const { name, data = {} } = payload;
    if (GAME_EVENTS[name].optional) continue;
    const keys = Object.keys(data).sort().join(",");
    assert.ok(
      sent[name]?.has(keys),
      `${id}: ${name} {${keys}}, the game sends {${[...(sent[name] ?? [])]}}`,
    );
    if (name === "kill") assert.ok(data.enemy in ENEMY_TYPES, `${id}: unknown enemy ${data.enemy}`);
    if (name === "item_pickup")
      assert.ok(items.includes(data.item), `${id}: unknown item ${data.item}`);
    if (name === "coin_purchase") {
      assert.ok(
        COIN_PACKS.some(
          (p) => p.name === data.pack && p.dollars === data.dollars && p.coins === data.coins,
        ),
        `${id}: no such coin pack`,
      );
    }
    const low = data.hp <= data.maxHp * LOW_HP_FRACTION;
    if (name === "close_call") assert.ok(low, `${id}: close_call needs low HP`);
    if (name === "win") assert.ok(!low, `${id}: a win on low HP is a close_call`);
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
