import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks, compareRuns, QA_LIMITS, CHECKS } from "../../src/harness/checks.js";
import { runScenario } from "../../src/harness/runner.js";
import { loadScenario } from "../../src/harness/load.js";
import { createFakeGenerator } from "../../src/harness/fakeGenerator.js";
import { PERSONAS } from "../../src/events/chatMessage.js";

// --- Hand-built records: one clean run, then one defect per test. ---

const event = (seq, id, extra) => ({
  seq,
  id,
  t: seq,
  accepted: true,
  event: { v: 1, id, kind: "game", ts: 1_700_000_000_000 + seq, name: "win", data: {} },
  importance: "major",
  ...extra,
});

const update = (seq, fields) => ({
  seq,
  t: seq,
  message: {
    v: 1,
    id: "m1",
    kind: "chat_message",
    ts: 1,
    eventId: "e-win",
    persona: "fan",
    viewer: "hype",
    source: "ai",
    text: "LETS",
    done: true,
    ...fields,
  },
});

function clean() {
  return {
    condition: "ai",
    events: [
      event(0, "e-win"),
      event(1, "e-kill", { importance: "minor" }),
      { seq: 2, id: "e-bad", t: 2, accepted: false, errors: [] },
    ],
    messages: [
      update(3, { text: "LET", done: false }),
      update(4, { text: "LETS GO" }),
      update(5, { id: "m2", eventId: "e-kill", source: "template", text: "nice" }),
    ],
    generatorCalls: [{ index: 0, prompt: '{"event":"won the round","details":{}}' }],
    handlerErrors: [],
  };
}

// The W06 core checks; the W07 edge-case checks are tested in edgeCaseChecks.test.js.
const CORE = CHECKS.filter((c) => !c.group).map((c) => c.name);

function failures(record, limits) {
  return Object.fromEntries(
    runChecks(record, { limits, only: CORE })
      .filter((c) => !c.ok)
      .map((c) => [c.name, c.violations.map((v) => v.message)]),
  );
}

test("a clean record passes every core check", () => {
  assert.deepEqual(failures(clean()), {});
});

test("messages-valid flags invalid updates", () => {
  const r = clean();
  r.messages.push(update(6, { id: "m3", persona: "troll" }), { seq: 7, t: 7, message: "oops" });
  assert.deepEqual(failures(r), {
    "messages-valid": [
      "update #3 (m3): persona: must be one of fan, hater, backseat, lurker",
      "update #4: message: chat message must be a plain object",
    ],
  });
});

test("stream-integrity flags changed fields, shrinking text, updates after done, no done", () => {
  const r = clean();
  r.messages = [
    update(3, { text: "LETS GO", done: false }),
    update(4, { text: "LETS", persona: "hater", done: true }),
    update(5, { text: "LETS more", done: false }),
    update(6, { id: "m9", eventId: "e-win", done: false }),
  ];
  assert.deepEqual(failures(r)["stream-integrity"], [
    "m1: persona changed mid-stream",
    "m1: text must be the full text so far",
    "m1: update sent after done: true",
    "m1: never finished (no done: true update)",
    "m9: never finished (no done: true update)",
  ]);
});

test("replies-link-to-events flags unknown, rejected and premature events", () => {
  const r = clean();
  r.events[0].seq = 10; // the win now happens after its reply
  r.messages.push(
    update(6, { id: "m3", eventId: "nope" }),
    update(7, { id: "m4", eventId: "e-bad" }),
    update(8, { id: "m5", eventId: null, source: "template" }),
  );
  assert.deepEqual(failures(r)["replies-link-to-events"], [
    "m1: sent before event e-win",
    "m3: answers unknown event nope",
    "m4: answers rejected event e-bad",
  ]);
});

test("routing: minor events never get AI or fallback replies", () => {
  const r = clean();
  r.messages.push(update(6, { id: "m3", eventId: "e-kill", source: "fallback" }));
  assert.deepEqual(failures(r).routing, ['m3: minor event e-kill got a "fallback" reply']);
});

test("routing: scripted replies are not allowed in the AI condition", () => {
  const r = clean();
  r.messages.push(update(6, { id: "m3", source: "scripted" }));
  assert.deepEqual(failures(r).routing, ['m3: "scripted" reply in the AI condition']);
});

test("routing: the scripted condition never uses the model", () => {
  const r = clean();
  r.condition = "scripted";
  assert.deepEqual(failures(r).routing, [
    'm1: "ai" reply in the scripted condition',
    "the model was called 1 times in the scripted condition",
  ]);
});

test("response-limits caps messages per event", () => {
  const r = clean();
  for (let i = 0; i < QA_LIMITS.maxMessagesPerEvent; i++) {
    r.messages.push(update(10 + i, { id: `extra-${i}` }));
  }
  assert.deepEqual(failures(r)["response-limits"], [
    `e-win: ${QA_LIMITS.maxMessagesPerEvent + 1} messages (limit ${QA_LIMITS.maxMessagesPerEvent})`,
  ]);
  assert.equal(failures(r, { maxMessagesPerEvent: 10 })["response-limits"], undefined);
});

test("prompt-boundary flags ids, timestamps and envelope fields in prompts", () => {
  const r = clean();
  r.generatorCalls.push(
    { index: 1, prompt: "Event e-win happened" },
    { index: 2, prompt: `at ${1_700_000_000_000}` },
    { index: 3, prompt: '{"kind":"game","eventId":"x"}' },
  );
  assert.deepEqual(failures(r)["prompt-boundary"], [
    "generator call #1 prompt contains e-win",
    "generator call #2 prompt contains 1700000000000",
    'generator call #3 prompt contains eventId, "kind"',
  ]);
});

test("no-handler-errors reports every handler that threw", () => {
  const r = clean();
  r.handlerErrors.push({ eventId: "e-win", error: "Error: boom" });
  assert.deepEqual(failures(r)["no-handler-errors"], ["e-win: Error: boom"]);
});

test("stats-valid is skipped without stats and flags bad values with them", () => {
  const r = clean();
  r.stats = [
    { eventId: "e-win", state: { followers: 10, hype: 0.5 } },
    { eventId: "e-kill", state: { followers: -1, hype: NaN, donations: "5" } },
    { eventId: "e-x", state: null },
  ];
  assert.deepEqual(failures(r)["stats-valid"], [
    "after e-kill: followers is -1",
    "after e-kill: hype is null",
    'after e-kill: donations is "5"',
    "after e-x: stats must be an object",
  ]);
});

test("runChecks can run a subset and rejects unknown names", () => {
  assert.deepEqual(
    runChecks(clean(), { only: ["routing"] }).map((c) => c.name),
    ["routing"],
  );
  assert.throws(() => runChecks(clean(), { only: ["nope"] }), RangeError);
  assert.ok(CHECKS.every((c) => c.description.length > 0));
});

// --- Comparisons and real runs. ---

const fast = { speed: Infinity, settleMs: 2_000 };
const { scenario: session } = await loadScenario("basic-session");

test("the stub passes every core check in the AI condition", async () => {
  const record = await runScenario(session, fast);
  assert.deepEqual(failures(record), {});
});

test("the stub fails only routing in the scripted condition", async () => {
  const record = await runScenario(session, { ...fast, condition: "scripted" });
  assert.deepEqual(Object.keys(failures(record)), ["routing"]);
});

test("same-choices: same seed matches, a different seed doesn't", async () => {
  const a = await runScenario(session, { ...fast, seed: 3 });
  const b = await runScenario(session, { ...fast, seed: 3 });
  const c = await runScenario(session, { ...fast, seed: 4 });
  assert.deepEqual(compareRuns(a, b, { only: ["same-choices"] })[0].violations, []);
  assert.match(compareRuns(a, c, { only: ["same-choices"] })[0].violations[0].message, /differs/);
});

test("same-choices ignores the order replies to different events finished in", () => {
  const reply = (id, eventId, text) => ({
    message: {
      v: 1,
      id,
      kind: "chat_message",
      ts: 1,
      eventId,
      persona: "fan",
      viewer: "v",
      source: "ai",
      text,
      done: true,
    },
  });
  const events = [{ id: "e1" }, { id: "e2" }];
  const a = { events, messages: [reply("m1", "e1", "first"), reply("m2", "e2", "second")] };
  const b = { events, messages: [reply("m2", "e2", "second"), reply("m1", "e1", "first")] };
  const c = { events, messages: [reply("m2", "e2", "second"), reply("m1", "e1", "other")] };
  assert.deepEqual(compareRuns(a, b, { only: ["same-choices"] })[0].violations, []);
  assert.match(compareRuns(a, c, { only: ["same-choices"] })[0].violations[0].message, /differs/);
});

test("persona-independent-of-model passes for the stub, fails if persona follows the text", async () => {
  const normal = { ...fast, generator: createFakeGenerator({ delayMs: 0 }) };
  const garbage = { ...fast, generator: createFakeGenerator({ mode: "garbage", delayMs: 0 }) };
  const check = { only: ["persona-independent-of-model"] };

  const stubA = await runScenario(session, normal);
  const stubB = await runScenario(session, garbage);
  assert.deepEqual(compareRuns(stubA, stubB, check)[0].violations, []);

  // Picks the persona after generation, from the model's text: the defect to catch.
  const textPersona = (bus, emit, { generate }) =>
    bus.subscribe("game", async (e) => {
      const { text } = await generate("p").catch(() => ({ text: "" }));
      const persona = PERSONAS[text.length % PERSONAS.length];
      const fields = { v: 1, id: `${e.id}-r`, kind: "chat_message", ts: 1, viewer: "v" };
      emit({ ...fields, eventId: e.id, persona, source: "fallback", text: "x", done: true });
    });
  const badA = await runScenario(session, { ...normal, pipeline: textPersona, settleMs: 300 });
  const badB = await runScenario(session, { ...garbage, pipeline: textPersona, settleMs: 300 });
  assert.ok(compareRuns(badA, badB, check)[0].violations.length > 0);
});

test("stats: the runner records the model's state after every accepted event", async () => {
  const stats = {
    initial: () => ({ followers: 0, hype: 0 }),
    reduce: (s, e) =>
      e.kind === "game" && e.name === "win"
        ? { followers: s.followers + 10, hype: Math.min(100, s.hype + 30) }
        : s,
  };
  const a = await runScenario(session, { ...fast, stats });
  const b = await runScenario(session, {
    ...fast,
    stats,
    generator: createFakeGenerator({ mode: "unsafe", delayMs: 0 }),
  });
  assert.equal(a.stats.length, session.steps.length);
  assert.deepEqual(a.stats.at(-1).state, { followers: 10, hype: 30 });
  assert.deepEqual(failures(a), {});
  assert.deepEqual(compareRuns(a, b, { only: ["same-stats"] })[0].violations, []);
});

test("a stats model that throws is reported as a handler error", async () => {
  const stats = {
    initial: () => ({}),
    reduce: () => {
      throw new Error("bad reducer");
    },
  };
  const record = await runScenario(session, { ...fast, stats, pipeline: () => () => {} });
  assert.match(failures(record)["no-handler-errors"][0], /stats: Error: bad reducer/);
});
