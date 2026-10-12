import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent } from "../../src/events/schema.js";
import { parseScenario, eventForStep, ScenarioError } from "../../src/harness/scenario.js";
import { loadScenario, listScenarios } from "../../src/harness/load.js";

const minimal = (steps) => ({ name: "t", steps });

function problems(input) {
  try {
    parseScenario(input);
  } catch (err) {
    assert.ok(err instanceof ScenarioError, `expected ScenarioError, got ${err}`);
    return err.problems;
  }
  assert.fail("expected the scenario to be rejected");
}

test("parses game, chat and raw steps with fixed ids", () => {
  const scenario = parseScenario({
    name: "demo",
    description: "d",
    steps: [
      { at: 0, game: "win", data: { score: 3 } },
      { at: 10, chat: "  hi chat  ", note: "greeting" },
      { at: 10, raw: { anything: true } },
    ],
  });

  assert.equal(scenario.name, "demo");
  assert.deepEqual(
    scenario.steps.map((s) => [s.id, s.kind, s.at]),
    [
      ["demo-000", "game", 0],
      ["demo-001", "chat", 10],
      ["demo-002", "raw", 10],
    ],
  );
  assert.equal(scenario.steps[1].note, "greeting");
  assert.ok(Object.isFrozen(scenario.steps));
});

test("eventForStep builds valid events with the given ts", () => {
  const scenario = parseScenario(
    minimal([
      { at: 0, game: "kill" },
      { at: 1, chat: " gg " },
    ]),
  );
  const game = eventForStep(scenario.steps[0], 123);
  const chat = eventForStep(scenario.steps[1], 456);

  assert.deepEqual(validateEvent(game), { ok: true });
  assert.deepEqual(game, { v: 1, id: "t-000", kind: "game", name: "kill", data: {}, ts: 123 });
  assert.deepEqual(chat, { v: 1, id: "t-001", kind: "chat", text: "gg", ts: 456 });
});

test("chat steps may be empty: the bus, not the loader, rejects them", () => {
  const scenario = parseScenario(minimal([{ at: 0, chat: "   " }]));
  const event = eventForStep(scenario.steps[0], 1);
  assert.equal(event.text, "");
  assert.equal(validateEvent(event).ok, false);
});

test("raw payloads are copied, not shared", () => {
  const raw = { kind: "game", data: { x: 1 } };
  const scenario = parseScenario(minimal([{ at: 0, raw }]));
  const copy = eventForStep(scenario.steps[0], 1);
  assert.deepEqual(copy, raw);
  assert.notEqual(copy, raw);
});

test("rejects authoring mistakes, listing every one", () => {
  assert.deepEqual(problems(null), ["scenario must be an object"]);
  assert.match(problems({ name: "Bad Name", steps: [{ at: 0, chat: "x" }] })[0], /^name:/);
  assert.match(problems({ name: "t", steps: [] })[0], /^steps:/);
  assert.match(problems({ name: "t", steps: [{ at: 0, chat: "x" }], extra: 1 })[0], /^extra:/);

  const found = problems(
    minimal([
      { at: 5, game: "win" },
      { at: 4, game: "win" },
      { at: 6, game: "win", chat: "x" },
      { at: 7, chat: "x", data: { a: 1 } },
      { at: 8, game: "headshot" },
      { at: 9, chat: 42 },
      { at: -1, raw: 1 },
      { at: 10, raw: 1, typo: true },
      "nope",
    ]),
  );
  assert.deepEqual(
    found.map((p) => p.split(":")[0]),
    [
      "steps[1].at",
      "steps[2]",
      "steps[3].data",
      "steps[4]",
      "steps[5].chat",
      "steps[6].at",
      "steps[7].typo",
      "steps[8]",
    ],
  );
});

test("every bundled scenario loads and its game steps are valid", async () => {
  const names = await listScenarios();
  assert.ok(names.length >= 3);
  for (const name of names) {
    const { scenario, sha256 } = await loadScenario(name);
    assert.equal(scenario.name, name, `${name}.json: "name" must match the file name`);
    assert.match(sha256, /^[0-9a-f]{64}$/);
  }
});

test("loadScenario explains an unknown name", async () => {
  await assert.rejects(loadScenario("nope"), /No scenario "nope"\. Bundled scenarios: /);
});

test("player-chat covers the 200/201 character boundary", async () => {
  const { scenario } = await loadScenario("player-chat");
  const lengths = scenario.steps.map((s) => s.payload.text.length);
  assert.ok(lengths.includes(200));
  assert.ok(lengths.includes(201));
});
