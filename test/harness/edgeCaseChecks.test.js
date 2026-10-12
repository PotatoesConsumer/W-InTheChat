import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks, CHECKS, QA_LIMITS } from "../../src/harness/checks.js";
import { runScenario } from "../../src/harness/runner.js";
import { loadScenario } from "../../src/harness/load.js";
import { createFakeGenerator } from "../../src/harness/fakeGenerator.js";

const EDGE = CHECKS.filter((c) => c.group === "edge-case").map((c) => c.name);

// --- Hand-built records ---

const event = (seq, id, t, name = "win") => ({
  seq,
  id,
  t,
  accepted: true,
  importance: name === "kill" ? "minor" : "major",
  event: { v: 1, id, kind: "game", ts: 1, name, data: {} },
});

let n = 0;
const reply = (t, eventId, fields = {}) => ({
  seq: 1000 + n,
  t,
  message: {
    v: 1,
    id: `m${n++}`,
    kind: "chat_message",
    ts: 1,
    eventId,
    persona: "fan",
    viewer: "v",
    source: "ai",
    text: "LETS GOOO",
    done: true,
    ...fields,
  },
});

const call = (start, end, fields = {}) => ({
  index: 0,
  prompt: "p",
  start,
  end,
  outcome: "ok",
  text: "LETS GOOO",
  ...fields,
});

function record(fields) {
  return {
    condition: "ai",
    speed: 1,
    durationMs: 20_000,
    events: [event(0, "e1", 0)],
    messages: [reply(500, "e1")],
    generatorCalls: [call(10, 400)],
    handlerErrors: [],
    ...fields,
  };
}

function edgeFailures(r, limits) {
  return Object.fromEntries(
    runChecks(r, { only: EDGE, limits })
      .filter((c) => !c.ok)
      .map((c) => [c.name, c.violations.map((v) => v.message)]),
  );
}

test("a clean record passes every edge-case check", () => {
  assert.deepEqual(edgeFailures(record()), {});
});

test("reply-timeout flags replies completed after the limit", () => {
  const late = QA_LIMITS.replyTimeoutMs + QA_LIMITS.timeoutGraceMs + 1;
  const r = record({ messages: [reply(late, "e1", { source: "fallback" })] });
  assert.match(edgeFailures(r)["reply-timeout"][0], /completed \d+ ms after e1/);
  assert.deepEqual(edgeFailures(r, { replyTimeoutMs: 60_000 }), {});
});

test("fallback-on-failure: errors, aborts, slow and unsafe generations need a fallback", () => {
  const cases = [
    call(0, 50, { outcome: "error" }),
    call(0, 50, { outcome: "aborted" }),
    call(0, QA_LIMITS.replyTimeoutMs + 1),
    call(0, null),
    call(0, 50, { unsafe: true }),
  ];
  for (const c of cases) {
    const r = record({
      generatorCalls: [c],
      messages: [],
      durationMs: QA_LIMITS.replyTimeoutMs * 2,
    });
    assert.ok(edgeFailures(r)["fallback-on-failure"], JSON.stringify(c));
    r.messages = [reply(100, "e1", { source: "fallback", text: "chat is lagging" })];
    assert.equal(edgeFailures(r)["fallback-on-failure"], undefined, JSON.stringify(c));
  }
});

test("ai-text-from-model: ai text must come from a good generation (cleanup allowed)", () => {
  const ok = record({ messages: [reply(500, "e1", { text: '"LETS GOOO"' })] });
  assert.equal(edgeFailures(ok)["ai-text-from-model"], undefined, "quotes stripped is fine");

  const invented = record({ messages: [reply(500, "e1", { text: "something else" })] });
  assert.ok(edgeFailures(invented)["ai-text-from-model"]);

  const fromUnsafe = record({
    generatorCalls: [call(0, 50, { text: "bad words", unsafe: true })],
    messages: [reply(500, "e1", { text: "bad words" })],
  });
  assert.ok(edgeFailures(fromUnsafe)["ai-text-from-model"]);
});

test("unsafe-blocked catches unsafe text in any update, even reworded with punctuation", () => {
  const r = record({
    generatorCalls: [call(0, 50, { text: "just kys already", unsafe: true })],
    messages: [
      reply(100, "e1", { id: "s", text: "lol JUST KYS", done: false, source: "fallback" }),
      reply(200, "e1", { id: "s", text: "lol JUST KYS, already!", source: "fallback" }),
    ],
  });
  assert.deepEqual(edgeFailures(r)["unsafe-blocked"], [
    's: shows unsafe output "just kys already"',
  ]);
});

test("plain-text flags newlines, markdown, JSON and AI disclosures", () => {
  const texts = ["two\nlines", "**bold**", "```code```", '{"a":1}', "As an AI, I can't"];
  const r = record({
    messages: texts.map((text) => reply(500, "e1", { text, source: "template" })),
  });
  assert.deepEqual(
    edgeFailures(r)["plain-text"].map((m) => m.split(": text contains ")[1]),
    ["a newline", "markdown", "markdown", "JSON", "an AI disclosure"],
  );
});

test("generation-concurrency: overlapping calls fail, back-to-back calls don't", () => {
  const overlap = record({ generatorCalls: [call(0, 100), call(50, 150)] });
  assert.match(
    edgeFailures(overlap)["generation-concurrency"][0],
    /2 generations in flight at \+50 ms/,
  );

  const backToBack = record({ generatorCalls: [call(0, 100), call(100, 200)] });
  assert.equal(edgeFailures(backToBack)["generation-concurrency"], undefined);

  const unfinished = record({ generatorCalls: [call(0, null), call(500, 600)] });
  assert.ok(
    edgeFailures(unfinished)["generation-concurrency"],
    "an unfinished call stays in flight",
  );
});

test("burst-rate counts new messages per second, not streamed updates", () => {
  const max = QA_LIMITS.maxMessagesPerSecond;
  const many = Array.from({ length: max + 1 }, (_, i) => reply(i * 100, "e1"));
  assert.match(edgeFailures(record({ messages: many }))["burst-rate"][0], /within 1 s/);

  const spread = Array.from({ length: max + 1 }, (_, i) => reply(i * 300, "e1"));
  assert.equal(edgeFailures(record({ messages: spread }))["burst-rate"], undefined);

  const streamed = Array.from({ length: 20 }, (_, i) =>
    reply(i * 10, "e1", { id: "one", text: "x".repeat(i + 1), done: i === 19 }),
  );
  assert.equal(edgeFailures(record({ messages: streamed }))["burst-rate"], undefined);
});

test("repeat-coalescing: a quick run of one event shares the per-event limit", () => {
  const kills = Array.from({ length: 5 }, (_, i) => event(i, `k${i}`, i * 500, "kill"));
  const oneEach = kills.map((k) => reply(k.t + 1, k.id, { source: "template" }));
  const r = record({ events: kills, messages: oneEach, generatorCalls: [] });
  assert.deepEqual(edgeFailures(r)["repeat-coalescing"], [
    `5 "kill" events in quick succession got 5 messages (limit ${QA_LIMITS.maxMessagesPerEvent})`,
  ]);

  const spaced = kills.map((k, i) => ({ ...k, t: i * QA_LIMITS.coalesceWindowMs }));
  assert.equal(edgeFailures({ ...r, events: spaced })["repeat-coalescing"], undefined);
});

test("timing checks are skipped, not passed, on sped-up runs", () => {
  const results = runChecks(record({ speed: 20 }), { only: ["burst-rate", "repeat-coalescing"] });
  assert.deepEqual(
    results.map((c) => [c.name, c.ok, c.skipped]),
    [
      ["burst-rate", true, true],
      ["repeat-coalescing", true, true],
    ],
  );
});

// --- The stub against each edge case: these failures are what the real pipeline must fix. ---

const { scenario: session } = await loadScenario("basic-session");
const { scenario: burst } = await loadScenario("burst");

async function stubFailures(scenario, generator, { speed = Infinity, limits } = {}) {
  const r = await runScenario(scenario, { speed, settleMs: 1_500, generator });
  return Object.keys(edgeFailures(r, limits)).sort();
}

test("stub, slow model: no fallback and no limit on parallel generations", async () => {
  const slow = createFakeGenerator({ mode: "slow", slowMs: 400 });
  assert.deepEqual(
    await stubFailures(session, slow, { limits: { replyTimeoutMs: 100, timeoutGraceMs: 0 } }),
    ["fallback-on-failure", "generation-concurrency", "reply-timeout"],
  );
});

test("stub, model down: falls back, but still fires generations in parallel", async () => {
  const error = createFakeGenerator({ mode: "error", delayMs: 0 });
  assert.deepEqual(await stubFailures(session, error), ["generation-concurrency"]);
});

test("stub, garbage output: shows it raw", async () => {
  const garbage = createFakeGenerator({ mode: "garbage", delayMs: 0 });
  assert.deepEqual(await stubFailures(session, garbage), ["generation-concurrency", "plain-text"]);
});

test("stub, unsafe output: shows it in chat", async () => {
  const unsafe = createFakeGenerator({ mode: "unsafe", delayMs: 0 });
  assert.deepEqual(await stubFailures(session, unsafe), [
    "ai-text-from-model",
    "fallback-on-failure",
    "generation-concurrency",
    "unsafe-blocked",
  ]);
});

test("stub, burst at real-time speed: floods chat and doesn't coalesce", async () => {
  const normal = createFakeGenerator({ delayMs: 0 });
  assert.deepEqual(await stubFailures(burst, normal, { speed: 1 }), [
    "burst-rate",
    "repeat-coalescing",
  ]);
});
