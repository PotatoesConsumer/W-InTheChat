/**
 * sessions.js
 *
 * Reads the study's session logs (src/service/sessionLog.js, one file per participant
 * and condition) and summarizes them per condition for the report: chat volume,
 * variety over equal-length sessions, reply latency p50/p95, and failures, including
 * what the reply check and the safety filter rejected.
 */

import { summarize } from "../service/latency.js";
import { variety } from "./variety.js";

/** The study's play time per condition (docs/study/protocol.md). */
export const SESSION_MS = 5 * 60_000;

/** Sources that answer a major event or a player message (minor events get templates). */
const REPLY_SOURCES = new Set(["ai", "scripted", "fallback"]);

/**
 * @param {string} text - One JSON-lines session log.
 * @param {string} [file] - For error messages.
 */
export function parseSessionLog(text, file = "session log") {
  const records = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new SyntaxError(`${file}, line ${i + 1}: not JSON`);
      }
    });
  const start = records.find((r) => r.type === "start");
  if (!start) throw new SyntaxError(`${file}: no start record`);
  const of = (type) => records.filter((r) => r.type === type);
  return {
    file,
    session: start.session,
    condition: start.condition,
    startedAt: start.ts,
    version: start.version ?? null,
    model: start.model ?? null,
    events: of("event"),
    messages: of("message"),
    replies: of("reply"),
    end: records.find((r) => r.type === "end") ?? null,
  };
}

/**
 * The first `ms` of play: from the first `round_start` (the protocol starts the timer
 * at the first wave), or the first event if no wave started. Equal lengths keep the
 * variety numbers comparable across sessions.
 */
export function trimSession(log, ms = SESSION_MS) {
  const first =
    log.events.find((r) => r.event.kind === "game" && r.event.name === "round_start") ??
    log.events[0];
  if (!first) return { ...log, events: [], messages: [], replies: [], playedMs: 0 };
  const from = first.ts;
  const to = from + ms;
  const within = (r) => r.ts >= from && r.ts <= to;
  const ids = new Set(log.events.filter(within).map((r) => r.event.id));
  const last = Math.max(from, ...log.events.filter(within).map((r) => r.ts));
  return {
    ...log,
    events: log.events.filter(within),
    messages: log.messages.filter((r) => ids.has(r.message.eventId)),
    replies: log.replies.filter((r) => ids.has(r.eventId)),
    playedMs: last - from,
  };
}

const countBy = (items, key) =>
  items.reduce((acc, item) => {
    const k = key(item);
    if (k !== null && k !== undefined) acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

/**
 * @param {ReturnType<typeof parseSessionLog>[]} logs
 * @param {{durationMs?: number}} [opts]
 * @returns {Record<string, object>} per condition
 */
export function summarizeSessions(logs, { durationMs = SESSION_MS } = {}) {
  const byCondition = {};
  for (const log of logs) (byCondition[log.condition] ??= []).push(trimSession(log, durationMs));

  const out = {};
  for (const [condition, sessions] of Object.entries(byCondition)) {
    const perSession = sessions.map((s) => {
      const lines = s.messages.map((r) => r.message.text);
      const replyLines = s.messages
        .filter((r) => REPLY_SOURCES.has(r.message.source))
        .map((r) => r.message.text);
      return {
        session: s.session,
        playedMs: s.playedMs,
        playerMessages: s.events.filter((r) => r.event.kind === "chat").length,
        all: variety(lines),
        replies: variety(replyLines),
      };
    });
    const replies = sessions.flatMap((s) => s.replies);
    const model = replies.filter((r) => r.source === "ai");
    const avg = (pick) => {
      const values = perSession.map(pick).filter((v) => v !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    out[condition] = {
      sessions: sessions.length,
      // More than one version means the prompts changed mid-study: report them apart.
      versions: [...new Set(sessions.map((s) => s.version ?? "unknown"))].sort(),
      playedMinutes: perSession.reduce((a, s) => a + s.playedMs, 0) / 60_000,
      playerMessages: perSession.reduce((a, s) => a + s.playerMessages, 0),
      lines: perSession.reduce((a, s) => a + s.all.lines, 0),
      bySource: countBy(
        sessions.flatMap((s) => s.messages),
        (r) => r.message.source,
      ),
      byPersona: countBy(
        sessions.flatMap((s) => s.messages),
        (r) => r.message.persona,
      ),
      // Variety per session, then averaged: sessions of equal length, as the proposal asks.
      variety: {
        allLines: {
          repeatRate: avg((s) => s.all.repeatRate),
          distinct2: avg((s) => s.all.distinct2),
        },
        replies: {
          repeatRate: avg((s) => s.replies.repeatRate),
          distinct2: avg((s) => s.replies.distinct2),
        },
      },
      latency: {
        model: {
          firstText: summarize(model.map((r) => r.firstTextMs)),
          completion: summarize(model.map((r) => r.completionMs)),
        },
        allReplies: summarize(replies.map((r) => r.completionMs)),
      },
      failures: countBy(replies, (r) => r.failure),
      // Reply check rejections, the safety filter's ("unsafe") among them.
      filtered: replies.filter((r) =>
        ["unsafe", "empty", "too_long", "ai_disclosure", "structured"].includes(r.failure),
      ).length,
      perSession,
    };
  }
  return out;
}
