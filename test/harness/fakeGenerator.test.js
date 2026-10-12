import { test } from "node:test";
import assert from "node:assert/strict";
import { OllamaError } from "../../src/ai/ollamaClient.js";
import { createFakeGenerator, FAKE_LINES, streamParts } from "../../src/harness/fakeGenerator.js";

test("normal mode answers with its lines in order, cycling", async () => {
  const gen = createFakeGenerator({ delayMs: 0, lines: ["a b", "c"] });
  const texts = [];
  for (let i = 0; i < 3; i++) texts.push((await gen.generate("p")).text);
  assert.deepEqual(texts, ["a b", "c", "a b"]);

  const result = await gen.generate("p");
  assert.equal(result.evalTokens, 1);
  assert.equal(result.unsafe, false);
  assert.equal(typeof result.totalMs, "number");
});

test("error mode rejects like a down Ollama", async () => {
  const gen = createFakeGenerator({ mode: "error", delayMs: 0 });
  await assert.rejects(gen.generate("p"), OllamaError);
});

test("unsafe mode flags its results", async () => {
  const gen = createFakeGenerator({ mode: "unsafe", delayMs: 0 });
  const result = await gen.generate("p");
  assert.equal(result.unsafe, true);
  assert.ok(FAKE_LINES.unsafe.includes(result.text));
});

test("garbage mode includes empty and oversized output", () => {
  assert.ok(FAKE_LINES.garbage.includes(""));
  assert.ok(FAKE_LINES.garbage.some((l) => l.length > 200));
  assert.ok(FAKE_LINES.garbage.some((l) => l.includes("\n")));
});

test("slow mode can be aborted through the signal", async () => {
  const gen = createFakeGenerator({ mode: "slow", slowMs: 60_000 });
  const signal = AbortSignal.timeout(20);
  const started = Date.now();
  await assert.rejects(gen.generate("p", { signal }), { name: "TimeoutError" });
  assert.ok(Date.now() - started < 5_000, "abort must not wait for slowMs");
});

test("an already-aborted signal rejects immediately", async () => {
  const gen = createFakeGenerator({ delayMs: 10_000 });
  await assert.rejects(gen.generate("p", { signal: AbortSignal.abort() }), { name: "AbortError" });
});

test("dispose aborts calls in flight", async () => {
  const gen = createFakeGenerator({ mode: "slow", slowMs: 60_000 });
  const call = gen.generate("p");
  gen.dispose();
  await assert.rejects(call, { name: "AbortError" });
});

test("onText streams growing prefixes that end with the full text", async () => {
  const gen = createFakeGenerator({ delayMs: 0, lines: ["LETS GOOO"], chunks: 3 });
  const parts = [];
  const { text } = await gen.generate("p", { onText: (t) => parts.push(t) });
  assert.equal(parts.at(-1), text);
  assert.equal(parts.length, 3);
  for (let i = 1; i < parts.length; i++) assert.ok(parts[i].startsWith(parts[i - 1]));
});

test("streamParts handles short and empty text", () => {
  assert.deepEqual(streamParts("ab", 5), ["a", "ab"]);
  assert.deepEqual(streamParts("", 3), [""]);
});

test("rejects unknown modes and empty line sets", () => {
  assert.throws(() => createFakeGenerator({ mode: "chaos" }), TypeError);
  assert.throws(() => createFakeGenerator({ lines: [] }), TypeError);
});
