import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScenario } from "../../src/harness/scenario.js";
import { runScenario } from "../../src/harness/runner.js";
import { createFakeGenerator } from "../../src/harness/fakeGenerator.js";
import { createChatMessage } from "../../src/events/chatMessage.js";

const scenario = parseScenario({
  name: "unit",
  description: "runner test",
  steps: [
    { at: 0, game: "kill" },
    { at: 0, game: "win" },
    { at: 0, chat: "" },
    { at: 0, chat: "hello chat" },
  ],
});

const fast = { speed: Infinity, settleMs: 2_000 };

/** Replies to every event once, synchronously, with a template line. */
function echoPipeline(bus, emit) {
  return bus.subscribe("*", (event) =>
    emit(
      createChatMessage({
        eventId: event.id,
        persona: "fan",
        viewer: "echo",
        source: "template",
        text: `echo ${event.kind}`,
      }),
    ),
  );
}

test("records accepted and rejected events in order, with importance", async () => {
  const record = await runScenario(scenario, { ...fast, pipeline: echoPipeline });

  assert.deepEqual(
    record.events.map((e) => [e.id, e.accepted, e.importance ?? null]),
    [
      ["unit-000", true, "minor"],
      ["unit-001", true, "major"],
      ["unit-002", false, null],
      ["unit-003", true, null],
    ],
  );
  assert.deepEqual(
    record.events[2].errors.map((e) => e.path),
    ["text"],
  );
  assert.equal(record.messages.length, 3);
  assert.deepEqual(
    record.messages.map((m) => m.message.eventId),
    ["unit-000", "unit-001", "unit-003"],
  );
});

test("a reply sent during publish comes right after its event in sequence", async () => {
  const record = await runScenario(scenario, { ...fast, pipeline: echoPipeline });
  const firstEvent = record.events[0];
  const firstReply = record.messages[0];
  assert.equal(firstReply.seq, firstEvent.seq + 1);
  assert.ok(record.events[1].seq > firstReply.seq);
});

test("records generator calls with prompt, timing and outcome", async () => {
  const record = await runScenario(scenario, {
    ...fast,
    generator: createFakeGenerator({ delayMs: 5 }),
  });
  assert.equal(record.generatorCalls.length, 2, "stub generates for the major event and the chat");
  for (const call of record.generatorCalls) {
    assert.equal(call.outcome, "ok");
    assert.equal(typeof call.prompt, "string");
    assert.ok(call.end >= call.start);
  }
});

test("failed generations are recorded as errors and the stub falls back", async () => {
  const record = await runScenario(scenario, {
    ...fast,
    generator: createFakeGenerator({ mode: "error", delayMs: 0 }),
  });
  assert.deepEqual(
    record.generatorCalls.map((c) => c.outcome),
    ["error", "error"],
  );
  assert.ok(record.messages.some((m) => m.message.source === "fallback"));
});

test("plays steps at their `at` times, scaled by speed", async () => {
  const timed = parseScenario({
    name: "timed",
    steps: [
      { at: 0, game: "kill" },
      { at: 400, game: "kill" },
    ],
  });
  const record = await runScenario(timed, { pipeline: echoPipeline, speed: 4, settleMs: 0 });
  const gap = record.events[1].t - record.events[0].t;
  assert.ok(gap >= 90 && gap < 400, `expected ~100ms between steps, got ${gap}`);
});

test("waits for idle(), then stops; later replies count as late", async () => {
  let stopped = false;
  let lateEmit;
  const pipeline = (bus, emit) => {
    lateEmit = emit;
    let pending = Promise.resolve();
    const off = bus.subscribe("game", (event) => {
      pending = new Promise((r) => setTimeout(r, 30)).then(() =>
        emit(
          createChatMessage({
            eventId: event.id,
            persona: "hater",
            viewer: "slowpoke",
            source: "ai",
            text: "late but in time",
          }),
        ),
      );
    });
    return {
      stop() {
        stopped = true;
        off();
      },
      idle: () => pending,
    };
  };

  const record = await runScenario(scenario, { ...fast, pipeline });
  assert.ok(stopped);
  assert.equal(record.messages.length, 2);
  lateEmit({ anything: true });
  assert.equal(record.lateMessages, 1);
});

test("a throwing pipeline handler is recorded, not fatal", async () => {
  const pipeline = (bus) =>
    bus.subscribe("chat", () => {
      throw new Error("boom");
    });
  const record = await runScenario(scenario, { ...fast, pipeline });
  assert.deepEqual(
    record.handlerErrors.map((e) => [e.eventId, e.error]),
    [["unit-003", "Error: boom"]],
  );
});

test("same seed, same choices: runs are reproducible", async () => {
  const run = async (seed) => {
    const record = await runScenario(scenario, { ...fast, seed });
    return record.messages.map((m) => [m.message.eventId, m.message.persona, m.message.text]);
  };
  assert.deepEqual(await run(7), await run(7));
});

test("the record is plain JSON", async () => {
  const record = await runScenario(scenario, fast);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test("rejects a pipeline that returns nothing usable", async () => {
  await assert.rejects(runScenario(scenario, { ...fast, pipeline: () => 42 }), TypeError);
});
