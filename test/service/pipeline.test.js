import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../src/events/bus.js";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { validateChatMessage } from "../../src/events/chatMessage.js";
import startPipeline, { PIPELINE_DEFAULTS } from "../../src/service/pipeline.js";
import {
  EVENT_LINES,
  FALLBACK_LINES,
  SCRIPTED_LINES,
  VIEWERS,
} from "../../src/service/templates.js";

/**
 * A generator that answers from `script`, one entry per call:
 *   string        -> streamed in 3 growing parts, then resolved
 *   Error         -> rejected
 *   "hang"        -> never answers until aborted
 *   {parts, text} -> streams `parts` then resolves `text`
 */
function scriptedGenerator(script) {
  const calls = [];
  const generate = async (prompt, { signal, onText, system } = {}) => {
    const step = script[Math.min(calls.length, script.length - 1)];
    calls.push({ prompt, system });
    await tick();
    if (signal?.aborted) throw signal.reason;
    if (step instanceof Error) throw step;
    if (step === "hang") {
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    }
    const { parts, text } = typeof step === "string" ? { parts: growing(step), text: step } : step;
    for (const part of parts) {
      if (signal?.aborted) throw signal.reason;
      onText?.(part);
      await tick();
    }
    return { text };
  };
  return { generate, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 1));
const growing = (s) => [1, 2, 3].map((i) => s.slice(0, Math.ceil((i * s.length) / 3)));

function setup(script, deps = {}) {
  const bus = createEventBus({
    onError: (err) => {
      throw err;
    },
  });
  const messages = [];
  const gen = scriptedGenerator(script);
  const handle = startPipeline(bus, (m) => messages.push(m), {
    generate: gen.generate,
    random: seeded(7),
    ...deps,
  });
  return { bus, messages, handle, calls: gen.calls };
}

/** Small deterministic PRNG so tests don't depend on Math.random. */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Final update of every message, in first-seen order. */
function finals(messages) {
  const byId = new Map();
  for (const m of messages) byId.set(m.id, m);
  return [...byId.values()];
}

const game = (name, data = {}, id = `evt-${name}`) =>
  createGameEvent(name, data, { id, ts: Date.now() });

test("a minor event gets one template line, without calling the model", async () => {
  const { bus, messages, handle, calls } = setup(["unused"]);
  bus.publish(game("kill"));
  await handle.idle();

  assert.equal(calls.length, 0);
  assert.equal(messages.length, 1);
  const [m] = messages;
  assert.equal(m.source, "template");
  assert.equal(m.eventId, "evt-kill");
  assert.equal(m.done, true);
  assert.ok(EVENT_LINES.kill.includes(m.text));
  assert.ok(VIEWERS.fan.includes(m.viewer));
});

test("streamPartials: a streamed AI reply has one id, growing text, done last", async () => {
  const reply = "no way you clutched that, LETS GO";
  const { bus, messages, handle, calls } = setup([reply], { streamPartials: true });
  bus.publish(game("win", { score: 12 }));
  await handle.idle();

  assert.equal(calls.length, 1);
  assert.ok(calls[0].prompt.includes("just won the round"));
  assert.ok(calls[0].system.includes("excited fan"));
  assert.ok(messages.length >= 2, "expected partial updates before the final one");
  assert.equal(new Set(messages.map((m) => m.id)).size, 1);
  for (let i = 1; i < messages.length; i++) {
    assert.ok(messages[i].text.startsWith(messages[i - 1].text));
    assert.equal(messages[i - 1].done, false);
  }
  assert.deepEqual(
    { source: messages.at(-1).source, text: messages.at(-1).text, done: messages.at(-1).done },
    { source: "ai", text: reply, done: true },
  );
  for (const m of messages) assert.deepEqual(validateChatMessage(m), { ok: true });
});

test("short partials are held back until minStreamChars", async () => {
  const { bus, messages, handle } = setup([
    { parts: ["GG", "GG W", "GG WWWW chat"], text: "GG WWWW chat" },
  ]);
  bus.publish(game("win"));
  await handle.idle();
  assert.ok(messages.every((m) => m.text.length >= PIPELINE_DEFAULTS.minStreamChars));
});

test("player chat is answered by the model, and kept as history when history is on", async () => {
  const { bus, messages, handle, calls } = setup(["left is faster, trust", "WOOO what a win"], {
    historySize: 5,
  });
  bus.publish(createChatEvent("chat should I go left?", { id: "c1", ts: Date.now() }));
  await handle.idle();
  bus.publish(game("win"));
  await handle.idle();

  assert.ok(calls[0].prompt.includes('typed in chat: "chat should I go left?"'));
  assert.ok(!calls[0].prompt.includes("Recent chat"), "the message itself isn't history yet");
  assert.ok(calls[1].prompt.includes("the streamer: chat should I go left?"));
  assert.ok(calls[1].prompt.includes(": left is faster, trust"));
  assert.deepEqual(
    finals(messages).map((m) => [m.eventId, m.source]),
    [
      ["c1", "ai"],
      ["evt-win", "ai"],
    ],
  );
});

test("model errors and malformed output fall back to a safe line", async () => {
  const cases = [
    [new Error("Ollama down"), "error"],
    [{ parts: [], text: "" }, "empty"],
    [{ parts: [], text: "As an AI language model, I cannot watch streams." }, "ai_disclosure"],
    [{ parts: [], text: '{"message": "nice"}' }, "structured"],
    [{ parts: [], text: "LETS GO ".repeat(40) }, "too_long"],
  ];
  for (const [step, reason] of cases) {
    const { bus, messages, handle } = setup([step]);
    bus.publish(game("loss"));
    await handle.idle();
    assert.equal(messages.length, 1, reason);
    assert.equal(messages[0].source, "fallback", reason);
    assert.ok(FALLBACK_LINES.includes(messages[0].text), reason);
    assert.deepEqual(handle.stats().failures, { [reason]: 1 });
  }
});

test("an 'As an AI' reply is never shown, even while streaming", async () => {
  const text = "As an AI I cannot watch, but nice win";
  const { bus, messages, handle } = setup([{ parts: growing(text), text }], {
    streamPartials: true,
  });
  bus.publish(game("win"));
  await handle.idle();
  assert.deepEqual(
    messages.map((m) => m.source),
    ["fallback"],
  );
});

test("a reply that times out falls back after replyTimeoutMs", async () => {
  const { bus, messages, handle } = setup(["hang"], { replyTimeoutMs: 20, minGenerationMs: 5 });
  bus.publish(game("streak"));
  await handle.idle();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].source, "fallback");
  assert.deepEqual(handle.stats().failures, { timeout: 1 });
});

test("streamPartials: a bad ending after partials keeps the shown text, same source", async () => {
  const shown = "that was insane chat";
  const { bus, messages, handle } = setup(
    [{ parts: [shown], text: `${shown}\n` + "x".repeat(300) }],
    { streamPartials: true },
  );
  bus.publish(game("close_call"));
  await handle.idle();
  assert.deepEqual(
    messages.map((m) => [m.source, m.text, m.done]),
    [
      ["ai", shown, false],
      ["ai", shown, true],
    ],
  );
});

test("back-to-back major events each get a model reply (no timing-based routing)", async () => {
  const { bus, messages, handle, calls } = setup(["first reply, nice play", "second one, PB!!"]);
  bus.publish(game("win", {}, "e1"));
  bus.publish(game("new_best", {}, "e2"));
  await handle.idle();

  assert.equal(calls.length, 2);
  assert.deepEqual(
    finals(messages)
      .map((m) => [m.eventId, m.source])
      .sort(),
    [
      ["e1", "ai"],
      ["e2", "ai"],
    ],
  );
});

test("scripted condition: fixed lines for every event, the model is never called", async () => {
  const { bus, messages, handle, calls } = setup(["unused"], { condition: "scripted" });
  bus.publish(game("kill", {}, "minor"));
  bus.publish(game("win", {}, "major"));
  bus.publish(createChatEvent("hi chat", { id: "chat", ts: Date.now() }));
  await handle.idle();

  assert.equal(calls.length, 0);
  assert.deepEqual(
    messages.map((m) => [m.eventId, m.source]),
    [
      ["minor", "template"],
      ["major", "scripted"],
      ["chat", "scripted"],
    ],
  );
  const [, major, chat] = messages;
  assert.ok(SCRIPTED_LINES[major.persona].win.includes(major.text), major.text);
  assert.ok(SCRIPTED_LINES[chat.persona].chat.includes(chat.text), chat.text);
  assert.ok(VIEWERS[chat.persona].includes(chat.viewer));
});

test("both conditions give the same persona labels for the same seed and events", async () => {
  const labels = async (condition) => {
    const { bus, messages, handle } = setup(["a good reply here"], {
      condition,
      random: seeded(3),
    });
    const names = ["win", "loss", "streak", "close_call", "new_best", "loss", "win"];
    for (const [i, name] of names.entries()) {
      bus.publish(game(name, {}, `e${i}`));
      await handle.idle();
    }
    bus.publish(createChatEvent("hi chat", { id: "c1", ts: Date.now() }));
    await handle.idle();
    return finals(messages).map((m) => `${m.eventId} ${m.persona} ${m.viewer}`);
  };
  const ai = await labels("ai");
  assert.deepEqual(await labels("scripted"), ai);
  assert.ok(new Set(ai.map((l) => l.split(" ")[1])).size > 1, "more than one persona");
});

test("the same seed and events give the same chat, whatever the model returns", async () => {
  const run = async (script) => {
    const { bus, messages, handle } = setup(script, { random: seeded(42) });
    for (const name of ["round_start", "kill", "win", "damage_taken", "loss"]) {
      bus.publish(game(name));
      await handle.idle();
    }
    return finals(messages).map((m) => `${m.eventId} ${m.persona} ${m.viewer}`);
  };
  assert.deepEqual(await run(["good reply here"]), await run([new Error("down")]));
});

test("stop() aborts replies in flight and nothing is sent afterwards", async () => {
  const { bus, messages, handle } = setup(["hang"], { replyTimeoutMs: 10_000 });
  bus.publish(game("win"));
  handle.stop();
  await handle.idle();
  bus.publish(game("kill"));
  assert.deepEqual(messages, []);
});

test("stats: counts by source and p50/p95 latency from the event's ts", async () => {
  const { bus, handle } = setup(["what a round that was"]);
  bus.publish(game("kill"));
  bus.publish(game("win"));
  await handle.idle();
  const s = handle.stats();
  assert.equal(s.condition, "ai");
  assert.equal(s.replies.template, 1);
  assert.equal(s.replies.ai, 1);
  assert.equal(s.latency.all.completion.n, 2);
  assert.ok(s.latency.bySource.ai.completion.p50 >= 0);
});

test("rejects a bad condition, and the ai condition without a model", () => {
  const bus = createEventBus();
  assert.throws(() => startPipeline(bus, () => {}, { condition: "both" }), /condition/);
  assert.throws(() => startPipeline(bus, () => {}, { condition: "ai" }), /generate/);
  assert.doesNotThrow(() => startPipeline(bus, () => {}, { condition: "scripted" }).stop());
});

test("history is off by default: prompts carry only the event", async () => {
  const { bus, handle, calls } = setup(["first reply here", "second reply here"]);
  bus.publish(createChatEvent("hello chat", { id: "c1", ts: Date.now() }));
  await handle.idle();
  bus.publish(game("win"));
  await handle.idle();
  assert.equal(PIPELINE_DEFAULTS.historySize, 0);
  assert.ok(!calls[1].prompt.includes("Recent chat"));
});

test("model replies run one at a time, in arrival order", async () => {
  let running = 0;
  let peak = 0;
  const order = [];
  const bus = createEventBus();
  const messages = [];
  const handle = startPipeline(bus, (m) => messages.push(m), {
    random: seeded(3),
    generate: async (prompt) => {
      running++;
      peak = Math.max(peak, running);
      order.push(prompt.match(/just (.+)\./)?.[1] ?? prompt);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return { text: "what a moment chat" };
    },
  });
  for (const name of ["win", "streak", "close_call", "new_best"]) bus.publish(game(name));
  await handle.idle();

  assert.equal(peak, 1);
  assert.deepEqual(order, [
    "won the round",
    "went on a streak",
    "barely survived",
    "beat their personal best",
  ]);
  assert.deepEqual(
    finals(messages).map((m) => m.source),
    ["ai", "ai", "ai", "ai"],
  );
});

test("a reply whose deadline passes while queued gets a fallback, without the model", async () => {
  const { bus, messages, handle, calls } = setup(["hang"], {
    replyTimeoutMs: 60,
    minGenerationMs: 20,
  });
  bus.publish(game("win", {}, "first"));
  bus.publish(game("loss", {}, "second"));
  await handle.idle();

  assert.equal(calls.length, 1, "the second reply never reached the model");
  const byEvent = Object.fromEntries(finals(messages).map((m) => [m.eventId, m]));
  assert.equal(byEvent.first.source, "fallback");
  assert.equal(byEvent.second.source, "fallback");
  assert.deepEqual(handle.stats().failures, { timeout: 1, queue_timeout: 1 });
  for (const row of [byEvent.first, byEvent.second]) {
    assert.ok(FALLBACK_LINES.includes(row.text));
  }
});

test("stop() drops queued replies too", async () => {
  const { bus, messages, handle, calls } = setup(["hang"], { replyTimeoutMs: 10_000 });
  bus.publish(game("win"));
  bus.publish(game("loss"));
  handle.stop();
  await handle.idle();
  assert.equal(calls.length <= 1, true);
  assert.deepEqual(messages, []);
});

test("by default a reply is shown only once complete and checked: one update", async () => {
  const reply = "no way you clutched that, LETS GO";
  const { bus, messages, handle } = setup([reply]);
  bus.publish(game("win"));
  await handle.idle();
  assert.deepEqual(
    messages.map((m) => [m.source, m.text, m.done]),
    [["ai", reply, true]],
  );
});

test("by default a timed-out reply sends only the fallback, no partial text", async () => {
  const { bus, messages, handle } = setup(["hang"], { replyTimeoutMs: 40, minGenerationMs: 5 });
  bus.publish(game("win"));
  await handle.idle();
  assert.deepEqual(
    messages.map((m) => m.source),
    ["fallback"],
  );
});

/** `count` events named `name`, `gapMs` apart by their own timestamps. */
const spaced = (name, count, gapMs) =>
  Array.from({ length: count }, (_, i) =>
    createGameEvent(name, {}, { id: `${name}-${i}`, ts: 1_000_000 + i * gapMs }),
  );

test("the selector picks the persona for model replies, the Hater included", async () => {
  const personas = async (deps) => {
    const { bus, messages, handle } = setup(["nice one chat"], {
      maxMessagesPerSecond: 1_000,
      ...deps,
    });
    for (const event of spaced("loss", 60, 3_000)) bus.publish(event);
    await handle.idle();
    return new Set(finals(messages).map((m) => m.persona));
  };
  assert.deepEqual([...(await personas())].sort(), ["backseat", "fan", "hater", "lurker"]);
  const noHater = await personas({ aiPersonas: ["fan", "backseat", "lurker"] });
  assert.ok(!noHater.has("hater"));
});

test("an unsafe reply is never shown: the filter swaps in a fallback", async () => {
  const { bus, messages, handle } = setup(["you're worthless, quit streaming"]);
  bus.publish(game("loss", {}, "major"));
  await handle.idle();
  const [final] = finals(messages);
  assert.equal(final.source, "fallback");
  assert.ok(!messages.some((m) => m.text.includes("worthless")));
  assert.deepEqual(handle.stats().failures, { unsafe: 1 });
});

test("minor-event templates stay with the Fan, whose voice they're written in", async () => {
  for (const condition of ["ai", "scripted"]) {
    const { bus, messages, handle } = setup(["unused"], { condition });
    bus.publish(game("kill", {}, "minor"));
    await handle.idle();
    assert.deepEqual(
      messages.map((m) => m.persona),
      ["fan"],
    );
  }
});

test("repeats are coalesced by the events' timestamps: 1st, 5th and 10th of a run", async () => {
  const { bus, messages, handle } = setup(["unused"]);
  for (const event of spaced("kill", 12, 100)) bus.publish(event);
  await handle.idle();
  assert.deepEqual(
    messages.map((m) => m.eventId),
    ["kill-0", "kill-4", "kill-9"],
  );
  assert.equal(handle.stats().coalesced, 9);
});

test("the same seed and events give the same chat, coalescing included", async () => {
  const run = async () => {
    const { bus, messages, handle } = setup(["good reply here"], { random: seeded(5) });
    for (const event of [...spaced("streak", 6, 300), ...spaced("win", 3, 2_500)]) {
      bus.publish(event);
    }
    await handle.idle();
    return finals(messages).map((m) => `${m.eventId} ${m.persona} ${m.viewer}`);
  };
  assert.deepEqual(await run(), await run());
});

test("over maxMessagesPerSecond, lines wait their turn; none is dropped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { bus, messages, handle } = setup(["unused"], { maxMessagesPerSecond: 3 });
  for (const name of ["round_start", "kill", "damage_taken", "item_pickup"]) {
    bus.publish(game(name));
  }
  assert.equal(messages.length, 3);
  const idle = handle.idle();
  t.mock.timers.tick(1_000);
  await idle;
  assert.equal(messages.length, 4);
  assert.equal(messages[3].ts - messages[0].ts, 1_000);
  assert.equal(handle.stats().replies.template, 4);
});

test("rejects aiPersonas without a prompt", () => {
  const bus = createEventBus();
  const generate = async () => ({ text: "x" });
  assert.throws(() => startPipeline(bus, () => {}, { generate, aiPersonas: ["mod"] }), /mod/);
  assert.throws(() => startPipeline(bus, () => {}, { generate, aiPersonas: [] }), /aiPersonas/);
});

test("a quick follow-up player message is answered; the same line spammed is coalesced", async () => {
  const { bus, messages, handle } = setup(["good question chat"], { maxMessagesPerSecond: 1_000 });
  const at = (text, i) => createChatEvent(text, { id: `c${i}`, ts: 1_000_000 + i * 500 });
  ["ok chat", "should I go left?", "spam", "spam", "SPAM "].forEach((text, i) =>
    bus.publish(at(text, i)),
  );
  await handle.idle();
  assert.deepEqual(
    finals(messages).map((m) => m.eventId),
    ["c0", "c1", "c2"],
  );
  assert.equal(handle.stats().coalesced, 2);
});
