/**
 * report.js
 *
 * Formats the study's analysis as Markdown for the evaluation report: performance and
 * safety from the session logs, variety, the blind ratings, and the questionnaire.
 * Any part whose input is missing says so instead of showing an empty table, so a
 * partial report can't pass for a finished one.
 */

import { ITEMS } from "./engagement.js";
import { PERSONAS } from "./rating.js";

const pct = (v) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
const num = (v, digits = 2) => (v === null || v === undefined ? "–" : v.toFixed(digits));
const ms = (s) => (s?.n ? `${s.p50} / ${s.p95} (n=${s.n})` : "–");
const p = (v) => (v < 0.001 ? "<0.001" : v.toFixed(3));

export function formatSessions(sessions) {
  const conditions = Object.keys(sessions).sort();
  if (conditions.length === 0) return "## Sessions\n\nNo session logs yet.\n";
  const row = (label, pick) =>
    `| ${label} | ${conditions.map((c) => pick(sessions[c])).join(" | ")} |`;
  return [
    "## Sessions: performance, safety and variety",
    "",
    `| | ${conditions.join(" | ")} |`,
    `|---|${conditions.map(() => "---").join("|")}|`,
    row("Sessions", (s) => s.sessions),
    row("Minutes played (first 5 min of each)", (s) => num(s.playedMinutes, 1)),
    row("Player messages", (s) => s.playerMessages),
    row("Chat lines", (s) => s.lines),
    row("Lines by source", (s) => fmtCounts(s.bySource)),
    row("Lines by persona", (s) => fmtCounts(s.byPersona)),
    row("Model reply, first text p50 / p95 ms", (s) => ms(s.latency.model.firstText)),
    row("Model reply, completion p50 / p95 ms", (s) => ms(s.latency.model.completion)),
    row("Any reply, completion p50 / p95 ms", (s) => ms(s.latency.allReplies)),
    row("Failures (fallback shown)", (s) => fmtCounts(s.failures) || "none"),
    row("Filtered by the reply check / safety filter", (s) => s.filtered),
    row("Repeat rate, all lines", (s) => pct(s.variety.allLines.repeatRate)),
    row("Distinct-2, all lines", (s) => num(s.variety.allLines.distinct2, 3)),
    row("Repeat rate, replies only", (s) => pct(s.variety.replies.repeatRate)),
    row("Distinct-2, replies only", (s) => num(s.variety.replies.distinct2, 3)),
    "",
    "Variety is computed per session over its first 5 minutes, then averaged. " +
      '"Replies only" leaves out the template lines for minor events, which are the ' +
      "same in both conditions.",
    "",
  ].join("\n");
}

export function formatRatings(ratings) {
  if (!ratings) return "## Blind ratings\n\nNo rating sheets yet.\n";
  const conditions = Object.keys(ratings.perCondition).sort();
  const lines = [
    "## Blind ratings: relevance and persona",
    "",
    `Raters: ${ratings.raters.length} (${ratings.raters.join(", ")}).`,
    "",
    `| | ${conditions.join(" | ")} |`,
    `|---|${conditions.map(() => "---").join("|")}|`,
    `| Items | ${conditions.map((c) => ratings.perCondition[c].items).join(" | ")} |`,
    `| Relevance, mean (median), n | ${conditions
      .map((c) => {
        const r = ratings.perCondition[c].relevance;
        return `${num(r.mean)} (${r.median ?? "–"}), n=${r.n}`;
      })
      .join(" | ")} |`,
    `| Relevance 1 / 2 / 3 / 4 / 5 | ${conditions
      .map((c) => Object.values(ratings.perCondition[c].relevance.distribution).join(" / "))
      .join(" | ")} |`,
    `| Persona accuracy (chance 25%) | ${conditions
      .map((c) => {
        const pa = ratings.perCondition[c].persona;
        return `${pct(pa.accuracy)} (${pa.correct}/${pa.n})`;
      })
      .join(" | ")} |`,
    "",
  ];
  for (const c of conditions) {
    const { confusion } = ratings.perCondition[c].persona;
    lines.push(
      `Confusion matrix, ${c} (rows: the persona that wrote it; columns: the raters' answer)`,
      "",
      `| | ${PERSONAS.join(" | ")} |`,
      `|---|${PERSONAS.map(() => "---").join("|")}|`,
      ...PERSONAS.map((t) => `| ${t} | ${PERSONAS.map((g) => confusion[t][g]).join(" | ")} |`),
      "",
    );
    const bySource = ratings.perCondition[c].relevance.bySource;
    if (Object.keys(bySource).length > 1) {
      lines.push(
        `Relevance by source, ${c}: ${Object.entries(bySource)
          .map(([s, v]) => `${s} ${num(v.mean)} (n=${v.n})`)
          .join(", ")}`,
        "",
      );
    }
  }
  const a = ratings.agreement;
  lines.push(
    `Rater agreement: same persona ${pct(a.personaSame)} of ${a.pairs.persona} pairs; ` +
      `relevance within 1 point ${pct(a.relevanceWithin1)} of ${a.pairs.relevance} pairs.`,
  );
  if (ratings.problems.unknownItems.length || ratings.problems.blankRows) {
    lines.push(
      "",
      `Problems: ${ratings.problems.unknownItems.length} unknown items, ` +
        `${ratings.problems.blankRows} blank rows.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatEngagement(engagement) {
  if (!engagement) return "## Questionnaire\n\nNo responses yet.\n";
  const e = engagement;
  const lines = [
    "## Questionnaire: engagement (paired)",
    "",
    `Participants with both halves: ${e.participants} (${fmtCounts(e.order)}).`,
    "",
    "| Item | n | scripted mean | ai mean | mean diff (ai − scripted) | ai higher / same / scripted higher | Wilcoxon p (exact) |",
    "|---|---|---|---|---|---|---|",
    ...Object.entries(ITEMS).map(([item, text]) => {
      const r = e.items[item];
      return (
        `| ${text} | ${r.n} | ${num(r.scripted.mean)} | ${num(r.ai.mean)} | ${num(r.meanDiff)} | ` +
        `${r.higher.ai} / ${r.higher.same} / ${r.higher.scripted} | ${r.test.n ? p(r.test.p) : "–"} |`
      );
    }),
    "",
    `Preferred: ai ${e.preferred.ai}, scripted ${e.preferred.scripted}, no preference ${e.preferred.none}` +
      `${e.preferred.missing ? `, not answered ${e.preferred.missing}` : ""}.`,
    "",
    `Order check: immersion ${num(e.orderCheck.immersionHalf1)} in half 1, ` +
      `${num(e.orderCheck.immersionHalf2)} in half 2.`,
    "",
    "A small exploratory study: read the paired differences and n, not the p-value alone.",
  ];
  if (e.problems.length) lines.push("", `Problems: ${e.problems.join("; ")}.`);
  for (const [c, list] of Object.entries(e.comments)) {
    if (list.length) lines.push("", `Comments after ${c}:`, "", ...list.map((t) => `- ${t}`));
  }
  return `${lines.join("\n")}\n`;
}

function fmtCounts(counts) {
  return Object.entries(counts ?? {})
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}
