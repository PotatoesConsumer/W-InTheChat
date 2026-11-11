import { test } from "node:test";
import assert from "node:assert/strict";
import { mean, median, distribution, wilcoxonSignedRank } from "../../src/analysis/stats.js";
import { parseCsv, toCsv } from "../../src/analysis/csv.js";
import { normalize, repeatRate, distinct2, variety } from "../../src/analysis/variety.js";

test("mean, median and a 1-5 distribution", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(mean([]), null);
  assert.equal(median([]), null);
  assert.deepEqual(distribution([1, 5, 5, 3, 7]), { 1: 1, 2: 0, 3: 1, 4: 0, 5: 2 });
});

test("Wilcoxon signed-rank: exact two-sided p, zeros dropped, tied ranks averaged", () => {
  // All five positive: the most extreme of 32 sign patterns, either tail -> 2/32.
  assert.deepEqual(wilcoxonSignedRank([1, 2, 3, 4, 5]), { n: 5, wPlus: 15, wMinus: 0, p: 0.0625 });
  assert.equal(wilcoxonSignedRank([-1, -2, -3, -4, -5]).p, 0.0625);
  // |1| tied three times (rank 2 each), |2| rank 4: W+ = 8; 4 of 16 patterns reach 16 doubled.
  assert.deepEqual(wilcoxonSignedRank([1, 1, -1, 2, 0]), { n: 4, wPlus: 8, wMinus: 2, p: 0.5 });
  assert.deepEqual(wilcoxonSignedRank([0, 0]), { n: 0, wPlus: 0, wMinus: 0, p: 1 });
  const balanced = wilcoxonSignedRank([1, -1, 2, -2]);
  assert.equal(balanced.p, 1);
});

test("CSV: quotes, commas, newlines, CRLF and Excel's BOM survive a round trip", () => {
  const rows = [
    { item: "R001", message: 'he said "gg", then left', note: "two\nlines" },
    { item: "R002", message: "plain", note: "" },
  ];
  const text = toCsv(rows, ["item", "message", "note"]);
  assert.deepEqual(parseCsv(text), rows);
  const bom = String.fromCharCode(0xfeff);
  assert.deepEqual(parseCsv(`${bom}a,b\r\n1, 2 \r\n\r\n`), [{ a: "1", b: "2" }]);
  assert.deepEqual(parseCsv("a,b\n1\n"), [{ a: "1", b: "" }], "short rows are padded");
});

test("variety: repeats after normalizing, and distinct-2 inside lines", () => {
  assert.equal(normalize("  GG!!  ez 🔥 "), "gg ez");
  assert.equal(repeatRate(["gg", "GG!", "nice", "🔥", "🔥"]), 2 / 5);
  assert.equal(repeatRate([]), null);
  // "a b", "b c", "a b": 2 unique of 3.
  assert.equal(distinct2(["a b c", "A b!"]), 2 / 3);
  assert.equal(distinct2(["gg", "ez"]), null, "one-word lines have no bigrams");
  assert.deepEqual(variety(["what a play", "what a play"]), {
    lines: 2,
    repeatRate: 0.5,
    distinct2: 0.5,
  });
});
