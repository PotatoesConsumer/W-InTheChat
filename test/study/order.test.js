import { test } from "node:test";
import assert from "node:assert/strict";
import { studySchedule, participantId, sessionUrl } from "../../src/study/order.js";
import { SESSION_LABEL } from "../../src/service/sessionLog.js";
import { conditionFromUrl, sessionFromUrl } from "../../src/ui/studyPanel.js";

test("orders alternate, so an even group is exactly balanced", () => {
  const schedule = studySchedule(20);
  assert.equal(schedule.length, 20);
  assert.deepEqual(schedule[0], { participant: "P01", order: ["ai", "scripted"] });
  assert.deepEqual(schedule[1], { participant: "P02", order: ["scripted", "ai"] });
  const aiFirst = schedule.filter((s) => s.order[0] === "ai").length;
  assert.equal(aiFirst, 10);
  for (const { order } of schedule) assert.deepEqual([...order].sort(), ["ai", "scripted"]);
  assert.equal(new Set(schedule.map((s) => s.participant)).size, 20);
});

test("an odd group is off by one at most; pilots get their own prefix", () => {
  const schedule = studySchedule(15);
  const aiFirst = schedule.filter((s) => s.order[0] === "ai").length;
  assert.ok(Math.abs(aiFirst - (15 - aiFirst)) === 1);
  assert.equal(studySchedule(2, { prefix: "T" })[1].participant, "T02");
});

test("ids are valid session labels, and the URL gives the game both", () => {
  assert.equal(participantId(7), "P07");
  assert.ok(SESSION_LABEL.test(participantId(99)));
  assert.throws(() => participantId(0), RangeError);
  assert.throws(() => studySchedule(0), RangeError);
  const url = new URL(sessionUrl("P07", "scripted"));
  assert.equal(conditionFromUrl(url.search), "scripted");
  assert.equal(sessionFromUrl(url.search), "P07");
});
