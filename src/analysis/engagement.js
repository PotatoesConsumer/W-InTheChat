/**
 * engagement.js
 *
 * The questionnaire (docs/study/questionnaire.md): each participant rates both
 * conditions on the same 1-5 items, so the comparison is paired. Reads the rows of
 * `responses.csv` and reports, per item, the paired difference (ai - scripted), the
 * Wilcoxon signed-rank test, the preference counts, and an order check (half 1 vs 2).
 */

import { mean, median, wilcoxonSignedRank, bootstrapInterval } from "./stats.js";
import { readRelevance } from "./rating.js";

export const ITEMS = Object.freeze({
  immersion: "I felt like I was really streaming to an audience.",
  keep_playing: "I wanted to keep playing.",
  chat_relevant: "The chat reacted to what I was doing in the game.",
  chat_viewers: "The chat felt like different people with their own personalities.",
});

/**
 * @param {Record<string, string>[]} rows - Parsed responses.csv.
 * @param {{a?: string, b?: string}} [opts] - The conditions compared as b - a.
 */
export function analyzeResponses(rows, { a = "scripted", b = "ai" } = {}) {
  const problems = [];
  const byParticipant = new Map();
  for (const row of rows) {
    if (!row.participant) continue;
    const halves = byParticipant.get(row.participant) ?? {};
    if (halves[row.condition]) problems.push(`${row.participant}: two rows for ${row.condition}`);
    halves[row.condition] = row;
    byParticipant.set(row.participant, halves);
  }
  const complete = [...byParticipant.entries()].filter(([id, h]) => {
    const ok = h[a] && h[b];
    if (!ok) problems.push(`${id}: missing a condition, left out`);
    return ok;
  });

  const items = {};
  for (const item of Object.keys(ITEMS)) {
    const pairs = complete
      .map(([, h]) => [readRelevance(h[a][item]), readRelevance(h[b][item])])
      .filter(([x, y]) => x !== null && y !== null);
    const diffs = pairs.map(([x, y]) => y - x);
    items[item] = {
      n: pairs.length,
      [a]: { mean: mean(pairs.map((p) => p[0])), median: median(pairs.map((p) => p[0])) },
      [b]: { mean: mean(pairs.map((p) => p[1])), median: median(pairs.map((p) => p[1])) },
      meanDiff: mean(diffs),
      // 95% bootstrap interval for the mean paired difference, resampling participants.
      interval: bootstrapInterval([diffs], (d) => mean(d)),
      higher: {
        [b]: diffs.filter((d) => d > 0).length,
        same: diffs.filter((d) => d === 0).length,
        [a]: diffs.filter((d) => d < 0).length,
      },
      test: wilcoxonSignedRank(diffs),
    };
  }

  // The preference is asked once, at the end, as "first", "second" or "none".
  const preferred = { [a]: 0, [b]: 0, none: 0, missing: 0 };
  const order = { [`${b} first`]: 0, [`${a} first`]: 0 };
  const byHalf = { 1: [], 2: [] };
  for (const [, h] of complete) {
    const first = [h[a], h[b]].find((r) => r.half === "1");
    const second = [h[a], h[b]].find((r) => r.half === "2");
    if (!first || !second) {
      preferred.missing++;
      continue;
    }
    order[`${first.condition} first`]++;
    const answer = (second.preferred || first.preferred || "").toLowerCase();
    if (answer === "first") preferred[first.condition]++;
    else if (answer === "second") preferred[second.condition]++;
    else if (answer === "none") preferred.none++;
    else preferred.missing++;
    for (const r of [first, second]) {
      const v = readRelevance(r.immersion);
      if (v !== null) byHalf[r.half].push(v);
    }
  }

  const comments = { [a]: [], [b]: [] };
  for (const [, h] of complete) {
    for (const c of [a, b]) if (h[c].comment) comments[c].push(h[c].comment);
  }

  return {
    participants: complete.length,
    order,
    items,
    preferred,
    // A big gap here means the second half felt different just for being second.
    orderCheck: { immersionHalf1: mean(byHalf[1]), immersionHalf2: mean(byHalf[2]) },
    comments,
    problems,
  };
}
