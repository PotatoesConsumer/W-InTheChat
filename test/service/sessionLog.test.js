import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionLog, SESSION_LABEL } from "../../src/service/sessionLog.js";
import { createService } from "../../src/service/server.js";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";

const lines = (file) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "witc-log-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("session labels are file-name safe ids", () => {
  for (const ok of ["P07", "p-12_b", "A".repeat(32)]) assert.ok(SESSION_LABEL.test(ok), ok);
  for (const bad of ["", "../x", "P 07", "a@b.c", "A".repeat(33)]) {
    assert.ok(!SESSION_LABEL.test(bad), bad);
  }
});

test("a file per session and condition, from start to end", () =>
  withDir((dir) => {
    let t = Date.UTC(2026, 10, 11, 9, 0, 0);
    const log = createSessionLog({ dir, now: () => t++, about: { version: "abc1234" } });
    const file = log.open({ session: "P01", condition: "ai" });
    assert.match(file, /P01-ai-2026-11-11T09-00-00-000Z\.jsonl$/);
    log.write({ type: "event", event: { id: "e1" } });
    log.close({ replies: { ai: 1 } });
    log.write({ type: "event", event: { id: "after close" } });
    assert.deepEqual(
      lines(file).map((r) => r.type),
      ["start", "event", "end"],
    );
    assert.deepEqual(lines(file)[0], {
      ts: Date.UTC(2026, 10, 11, 9, 0, 0) + 1,
      type: "start",
      session: "P01",
      condition: "ai",
      version: "abc1234",
    });
  }));

test("the service logs events in, finished lines out and replies, per session", () =>
  withDir(async (dir) => {
    const service = createService({
      port: 0,
      sessionLog: createSessionLog({ dir }),
      deps: {
        condition: "scripted",
        random: () => 0,
        generate: async () => ({ text: "what a play chat!!" }),
      },
    });
    const { url } = await service.start();
    const setCondition = (body) =>
      fetch(`${url}/condition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      assert.equal((await setCondition({ condition: "ai", session: "../etc" })).status, 400);

      const first = await setCondition({ condition: "ai", session: "P01" });
      assert.deepEqual(await first.json(), { ok: true, condition: "ai", session: "P01" });
      assert.equal(service.session(), "P01");
      service.bus.publish(createGameEvent("win"));
      service.bus.publish(createChatEvent("is this boss hard?"));
      await service.idle();
      await new Promise((resolve) => setTimeout(resolve, 600)); // the pacer's last line

      // Same condition, new participant: a new file.
      await setCondition({ condition: "ai", session: "P02" });
      // Same session again: nothing to restart.
      await setCondition({ condition: "ai" });
      assert.equal(service.session(), "P02");
    } finally {
      await service.close();
    }

    const files = readdirSync(dir).sort();
    assert.equal(files.length, 3, files.join(", "));
    const [p01, p02, unlabelled] = files.map((f) => join(dir, f));
    assert.match(unlabelled, /session-scripted-/, "before any label: the starting condition");
    const records = lines(p01);
    assert.deepEqual(
      records.map((r) => r.type),
      ["start", "event", "event", "message", "reply", "message", "reply", "end"],
    );
    assert.equal(records[1].event.name, "win");
    assert.equal(records[2].event.text, "is this boss hard?");
    for (const r of records.filter((x) => x.type === "message")) assert.equal(r.message.done, true);
    for (const r of records.filter((x) => x.type === "reply")) {
      assert.equal(r.source, "ai");
      assert.equal(typeof r.completionMs, "number");
    }
    assert.equal(records.at(-1).stats.replies.ai, 2);
    assert.deepEqual(
      lines(p02).map((r) => r.type),
      ["start", "end"],
    );
  }));
