/**
 * stats.js
 *
 * The few statistics the evaluation report needs, written out so they can be checked:
 * mean, median, a 1-5 distribution, and the Wilcoxon signed-rank test for the paired
 * questionnaire answers (each participant rates both conditions). The study is small
 * and exploratory (proposal), so the report gives n, the paired differences and an
 * exact p-value, never a p-value alone.
 */

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Counts of each whole score from `min` to `max`, e.g. {1: 0, 2: 3, ...}. */
export function distribution(values, min = 1, max = 5) {
  const counts = {};
  for (let v = min; v <= max; v++) counts[v] = 0;
  for (const v of values) if (Object.hasOwn(counts, v)) counts[v]++;
  return counts;
}

/**
 * Wilcoxon signed-rank test on paired differences (b - a), exact and two-sided.
 * Zero differences are dropped; tied absolute differences get average ranks, and the
 * exact null distribution is built over those ranks (doubled to stay whole numbers).
 * @param {number[]} diffs
 * @returns {{n: number, wPlus: number, wMinus: number, p: number}}
 */
export function wilcoxonSignedRank(diffs) {
  const nonZero = diffs.filter((d) => d !== 0);
  const n = nonZero.length;
  if (n === 0) return { n: 0, wPlus: 0, wMinus: 0, p: 1 };

  const order = nonZero
    .map((d, i) => ({ abs: Math.abs(d), positive: d > 0, i }))
    .sort((a, b) => a.abs - b.abs);
  const rank2 = new Array(n); // doubled ranks: average ranks of ties are then whole
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && order[j + 1].abs === order[i].abs) j++;
    const doubled = i + 1 + (j + 1); // 2 * average of ranks i+1..j+1
    for (let k = i; k <= j; k++) rank2[k] = doubled;
    i = j + 1;
  }
  let wPlus2 = 0;
  order.forEach((o, k) => {
    if (o.positive) wPlus2 += rank2[k];
  });
  const total2 = rank2.reduce((a, b) => a + b, 0);

  // ways[s]: how many sign assignments give a doubled W+ of s.
  let ways = new Array(total2 + 1).fill(0);
  ways[0] = 1;
  for (const r of rank2) {
    const next = [...ways];
    for (let s = 0; s + r <= total2; s++) if (ways[s]) next[s + r] += ways[s];
    ways = next;
  }
  const all = 2 ** n;
  let lower = 0;
  let upper = 0;
  ways.forEach((count, s) => {
    if (s <= wPlus2) lower += count;
    if (s >= wPlus2) upper += count;
  });
  const p = Math.min(1, (2 * Math.min(lower, upper)) / all);
  return { n, wPlus: wPlus2 / 2, wMinus: (total2 - wPlus2) / 2, p };
}
