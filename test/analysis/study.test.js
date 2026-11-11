import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSessionLog,
  trimSession,
  summarizeSessions,
  failureCases,
} from "../../src/analysis/sessions.js";
import {
  ratingItems,
  ratingSheet,
  analyzeRatings,
  readPersona,
  describeTrigger,
} from "../../src/analysis/rating.js";
import { analyzeResponses } from "../../src/analysis/engagement.js";
import { formatSessions, formatRatings, formatEngagement } from "../../src/analysis/report.js";

const T0 = 1_000_000;

/** A session log as the service writes it (src/service/sessionLog.js). */
function sessionLog(condition, { session = "P01", lines = [], late = false } = {}) {
  const records = [{ ts: T0, type: "start", session, condition }];
  let t = T0 + 1000;
  const event = (e) => records.push({ ts: t, type: "event", event: { ts: t, ...e } });
  event({ id: "e0", kind: "chat", text: "hi chat" }); // before the first wave: not counted
  t += 1000;
  event({ id: "e1", kind: "game", name: "round_start", data: {} });
  lines.forEach(([text, source, failure = null, ms = 400], i) => {
    t += 1000;
    const id = `e${i + 2}`;
    event({ id, kind: "chat", text: `msg ${i}` });
    records.push({
      ts: t + ms,
      type: "message",
      message: { id: `m${i}`, eventId: id, persona: "fan", source, text, done: true },
    });
    records.push({
      ts: t + ms,
      type: "reply",
      eventId: id,
      source,
      firstTextMs: ms,
      completionMs: ms,
      text,
      failure,
    });
  });
  if (late) {
    t += 10 * 60_000;
    event({ id: "late", kind: "game", name: "win", data: {} });
  }
  records.push({ ts: t + 5000, type: "end", stats: {} });
  return records.map((r) => JSON.stringify(r)).join("\n");
}

test("session logs: parsed, trimmed to the first 5 minutes from the first wave", () => {
  const log = parseSessionLog(sessionLog("ai", { lines: [["gg", "ai"]], late: true }), "P01-ai");
  assert.equal(log.condition, "ai");
  assert.equal(log.session, "P01");
  const trimmed = trimSession(log);
  assert.deepEqual(
    trimmed.events.map((r) => r.event.id),
    ["e1", "e2"],
    "the chat before the first wave and the event after 5 minutes are out",
  );
  assert.throws(() => parseSessionLog('{"type":"event"}', "bad"), /no start record/);
  assert.throws(() => parseSessionLog("{oops", "bad"), /bad, line 1: not JSON/);
});

test("sessions summarized per condition: latency, failures, filtered, variety", () => {
  const ai = parseSessionLog(
    sessionLog("ai", {
      lines: [
        ["what a clutch", "ai", null, 500],
        ["what a clutch", "ai", null, 700],
        ["nice one chat", "fallback", "unsafe", 0],
        ["new wave lets go", "template", null, 5],
      ],
    }),
  );
  const scripted = parseSessionLog(
    sessionLog("scripted", { session: "P02", lines: [["lets go", "scripted", null, 3]] }),
  );
  const s = summarizeSessions([ai, scripted]);
  assert.deepEqual(Object.keys(s).sort(), ["ai", "scripted"]);
  assert.equal(s.ai.sessions, 1);
  assert.deepEqual(s.ai.versions, ["unknown"], "logs from before the version was recorded");
  assert.equal(s.ai.playerMessages, 4);
  assert.deepEqual(s.ai.bySource, { ai: 2, fallback: 1, template: 1 });
  assert.deepEqual(s.ai.latency.model.completion, { n: 2, p50: 500, p95: 700, max: 700 });
  assert.deepEqual(s.ai.failures, { unsafe: 1 });
  assert.equal(s.ai.filtered, 1);
  assert.equal(s.ai.variety.allLines.repeatRate, 1 / 4);
  assert.equal(s.ai.variety.replies.repeatRate, 1 / 3, "template lines left out");
  assert.equal(s.scripted.latency.model.completion.n, 0);
  assert.equal(s.ai.gpuPeakMiB, null, "no gpu in these logs");
  assert.equal(s.ai.failureCases.length, 1);
  assert.match(formatSessions(s), /### Failure cases/);

  const md = formatSessions(s);
  assert.match(md, /\| ai \| scripted \|/);
  assert.match(md, /500 \/ 700 \(n=2\)/);
  assert.match(formatSessions({}), /No session logs yet/);
});

/** A minimal harness run record (src/harness/runner.js) of the event set. */
function runRecord(condition, seed, replies) {
  return {
    condition,
    seed,
    scenario: { name: "event-set-v1", file: { sha256: "abc" } },
    events: [
      {
        id: "s1",
        accepted: true,
        note: "question: asks about the game",
        event: { id: "s1", kind: "chat", text: "is this boss hard?" },
      },
      {
        id: "s2",
        accepted: true,
        event: { id: "s2", kind: "game", name: "loss", data: { wave: 3 } },
      },
      { id: "s3", accepted: true, event: { id: "s3", kind: "game", name: "kill", data: {} } },
    ],
    messages: replies.map(([eventId, persona, source, text]) => ({
      message: { eventId, persona, source, text, viewer: "v", done: true },
    })),
  };
}

test("rating sheet: only replies to major events and chat, shuffled, nothing that gives it away", () => {
  const records = [
    runRecord("ai", 1, [
      ["s1", "backseat", "ai", "just dodge, obviously"],
      ["s2", "hater", "ai", "wave 3? embarrassing"],
      ["s3", "fan", "template", "nice kill"],
    ]),
    runRecord("scripted", 1, [
      ["s1", "fan", "scripted", "you got this!!"],
      ["s2", "lurker", "fallback", "rip"],
    ]),
  ];
  const items = ratingItems(records);
  assert.equal(items.length, 4, "the template line for a minor event is left out");
  assert.equal(items[0].category, "question");
  assert.equal(items[1].trigger, "The streamer died and lost the run (wave 3)");
  assert.equal(describeTrigger({ kind: "chat", text: "hi" }), 'The streamer typed in chat: "hi"');

  const { sheet, key } = ratingSheet(items, { seed: 3 });
  assert.deepEqual(ratingSheet(items, { seed: 3 }).sheet, sheet, "same seed, same order");
  assert.deepEqual(Object.keys(sheet[0]), ["item", "trigger", "message", "relevance", "persona"]);
  assert.deepEqual(
    sheet.map((r) => r.item),
    ["R001", "R002", "R003", "R004"],
  );
  for (const row of sheet) {
    const k = key.find((x) => x.item === row.item);
    assert.equal(k.message, row.message, "the key joins back on item");
  }
});

test("ratings: relevance per condition, persona accuracy, confusion matrix, agreement", () => {
  const key = [
    { item: "R001", condition: "ai", persona: "hater", source: "ai" },
    { item: "R002", condition: "ai", persona: "fan", source: "ai" },
    { item: "R003", condition: "scripted", persona: "fan", source: "scripted" },
  ];
  const sheets = [
    {
      rater: "A",
      rows: [
        { item: "R001", relevance: "5", persona: "Hater" },
        { item: "R002", relevance: "4", persona: "fan" },
        { item: "R003", relevance: "2", persona: "backseat gamer" },
        { item: "R999", relevance: "3", persona: "fan" },
      ],
    },
    {
      rater: "B",
      rows: [
        { item: "R001", relevance: "3", persona: "hater" },
        { item: "R002", relevance: "", persona: "" },
        { item: "R003", relevance: "1", persona: "fan" },
      ],
    },
  ];
  const r = analyzeRatings(key, sheets);
  assert.equal(readPersona("Backseat Gamer"), "backseat");
  assert.equal(readPersona("streamer"), null);
  assert.deepEqual(r.perCondition.ai.relevance.distribution, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  assert.equal(r.perCondition.ai.relevance.mean, 4);
  assert.equal(r.perCondition.ai.persona.accuracy, 1);
  assert.equal(r.perCondition.scripted.persona.accuracy, 0.5);
  assert.equal(r.perCondition.scripted.persona.confusion.fan.backseat, 1);
  assert.deepEqual(r.problems, { unknownItems: ["R999"], blankRows: 1 });
  assert.equal(r.agreement.personaSame, 0.5, "agree on R001, not R003");
  assert.equal(r.agreement.relevanceWithin1, 0.5, "R003 within 1, R001 not");

  const md = formatRatings(r);
  assert.match(md, /Persona accuracy \[95% CI\] \(chance 25%\) \| 100\.0% \[/);
  assert.match(md, /\(3\/3\) \| 50\.0% \[/);
  const acc = r.perCondition.ai.persona.interval;
  assert.ok(acc.low > 0.3 && acc.low < 0.5 && acc.high === 1, "Wilson for 3/3");
  assert.ok(r.relevanceDiff.diff > 0, "ai rated higher in this sample");
  assert.match(md, /Relevance, ai − scripted: /);
  assert.match(formatRatings(null), /No rating sheets yet/);
});

test("questionnaire: paired by participant, preference mapped through the order", () => {
  const row = (participant, half, condition, immersion, keep, preferred = "") => ({
    participant,
    half: String(half),
    condition,
    immersion: String(immersion),
    keep_playing: String(keep),
    chat_relevant: "3",
    chat_viewers: "3",
    comment: half === 1 && participant === "P01" ? "chat felt alive" : "",
    preferred,
  });
  const rows = [
    row("P01", 1, "ai", 5, 4),
    row("P01", 2, "scripted", 3, 4, "first"),
    row("P02", 1, "scripted", 2, 3),
    row("P02", 2, "ai", 4, 3, "second"),
    row("P03", 1, "ai", 4, 4), // no second half: left out
  ];
  const e = analyzeResponses(rows);
  assert.equal(e.participants, 2);
  assert.deepEqual(e.order, { "ai first": 1, "scripted first": 1 });
  assert.equal(e.items.immersion.meanDiff, 2);
  assert.deepEqual(e.items.immersion.higher, { ai: 2, same: 0, scripted: 0 });
  assert.equal(e.items.keep_playing.test.n, 0, "no differences: nothing to test");
  assert.deepEqual(e.preferred, { scripted: 0, ai: 2, none: 0, missing: 0 });
  assert.deepEqual(e.comments, { scripted: [], ai: ["chat felt alive"] });
  assert.equal(e.problems.length, 1);

  const md = formatEngagement(e);
  assert.match(md, /Preferred: ai 2, scripted 0, no preference 0/);
  assert.match(formatEngagement(null), /No responses yet/);
});

test("failure cases: trigger, persona, reason and the rejected text, never shown", () => {
  const log = parseSessionLog(
    [
      { ts: 1, type: "start", session: "P03", condition: "ai" },
      { ts: 2, type: "event", event: { id: "c1", kind: "chat", text: "am I bad?" } },
      {
        ts: 3,
        type: "reply",
        eventId: "c1",
        source: "fallback",
        persona: "hater",
        firstTextMs: 300,
        completionMs: 300,
        text: "keep going",
        failure: "unsafe",
        rejected: { text: "(blocked line)", category: "personal_attack" },
      },
      { ts: 4, type: "event", event: { id: "g1", kind: "game", name: "win", data: {} } },
      {
        ts: 5,
        type: "reply",
        eventId: "g1",
        source: "fallback",
        persona: "fan",
        firstTextMs: 3000,
        completionMs: 3000,
        text: "GG!!",
        failure: "timeout",
      },
      { ts: 6, type: "end", stats: {}, gpu: { peakMiB: 2165, totalMiB: 6141 } },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  assert.deepEqual(failureCases(log), [
    {
      session: "P03",
      trigger: 'player: "am I bad?"',
      persona: "hater",
      failure: "unsafe",
      category: "personal_attack",
      rejected: "(blocked line)",
      shown: "keep going",
    },
    {
      session: "P03",
      trigger: "win",
      persona: "fan",
      failure: "timeout",
      category: null,
      rejected: null,
      shown: "GG!!",
    },
  ]);
  const s = summarizeSessions([log]);
  assert.equal(s.ai.gpuPeakMiB, 2165);
  const md = formatSessions(s);
  assert.match(md, /2165 of 6141/);
  assert.match(
    md,
    /unsafe \(personal_attack\) · rejected: "\(blocked line\)" · shown: "keep going"/,
  );
});

test("questionnaire differences come with a 95% interval", () => {
  const rows = [];
  for (let i = 1; i <= 6; i++) {
    const id = `P0${i}`;
    rows.push({ participant: id, half: "1", condition: "ai", immersion: "5", keep_playing: "4" });
    rows.push({
      participant: id,
      half: "2",
      condition: "scripted",
      immersion: String(2 + (i % 2)),
      keep_playing: "4",
    });
  }
  const e = analyzeResponses(rows);
  const { interval } = e.items.immersion;
  assert.ok(interval.low >= 2 && interval.high <= 3, JSON.stringify(interval));
  assert.equal(e.items.keep_playing.interval.low, 0);
  assert.match(formatEngagement(e), /\[95% CI\]/);
});
