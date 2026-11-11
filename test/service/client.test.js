import { test } from "node:test";
import assert from "node:assert/strict";
import { connectToService } from "../../src/service/client.js";
import { createService } from "../../src/service/server.js";
import { createChatMessage } from "../../src/events/chatMessage.js";
import { createGameEvent } from "../../src/events/schema.js";

/** Minimal stand-in for the browser's EventSource. */
class FakeEventSource {
  static last;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    FakeEventSource.last = this;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  close() {
    this.readyState = 2;
  }
}

test("passes valid chat messages on, drops malformed frames, reports status", () => {
  const got = [];
  const status = [];
  const chat = connectToService({
    url: "http://localhost:8787/",
    onMessage: (m) => got.push(m),
    onStatus: (s) => status.push(s),
    EventSourceImpl: FakeEventSource,
  });
  const source = FakeEventSource.last;
  assert.equal(source.url, "http://localhost:8787/stream");

  source.fire("open");
  const message = createChatMessage({
    persona: "fan",
    viewer: "gg_goblin",
    source: "ai",
    text: "LETS GO",
    eventId: "e1",
  });
  source.fire("chat_message", { data: JSON.stringify(message) });
  source.fire("chat_message", { data: "{not json" });
  source.fire("chat_message", { data: JSON.stringify({ ...message, text: "" }) });
  source.fire("error");
  chat.close();

  assert.deepEqual(got, [JSON.parse(JSON.stringify(message))]);
  assert.deepEqual(status, ["connected", "reconnecting", "closed"]);
});

test("send posts the event to a running service and never rejects", async () => {
  const service = createService({ port: 0, deps: { condition: "scripted" } });
  const { url } = await service.start();
  try {
    const chat = connectToService({ url, onMessage: () => {}, EventSourceImpl: FakeEventSource });
    assert.deepEqual(await chat.send(createGameEvent("win")), { ok: true });
    const bad = await chat.send({ kind: "game" });
    assert.equal(bad.ok, false);
    chat.close();
  } finally {
    await service.close();
  }

  const offline = connectToService({
    url: "http://127.0.0.1:9",
    onMessage: () => {},
    EventSourceImpl: FakeEventSource,
  });
  const result = await offline.send(createGameEvent("win"));
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /service unreachable/);
});

test("getCondition and setCondition talk to the service's /condition", async () => {
  const service = createService({
    port: 0,
    deps: { condition: "scripted", generate: async () => ({ text: "nice one" }) },
  });
  const { url } = await service.start();
  try {
    const chat = connectToService({ url, onMessage: () => {}, EventSourceImpl: FakeEventSource });
    assert.equal((await chat.getCondition()).condition, "scripted");
    assert.deepEqual(await chat.setCondition("ai"), { ok: true, condition: "ai" });
    assert.equal((await chat.setCondition("nope")).ok, false);
    assert.equal((await chat.getCondition()).condition, "ai");
    assert.deepEqual(await chat.setCondition("ai", undefined, "Pu"), {
      ok: true,
      condition: "ai",
      streamer: "Pu",
    });
    chat.close();
  } finally {
    await service.close();
  }
});
