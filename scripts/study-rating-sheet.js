/**
 * Makes the blind rating sheet from the evaluation runs (`npm run eval:runs`): every
 * line that answers a major event or a player message, from both conditions, shuffled.
 * Raters get the sheet and docs/study/rating.md; the key stays with the analysis.
 *
 *   npm run study:rating-sheet
 *   npm run study:rating-sheet -- --runs study-logs/eval-runs --out study-logs/rating --seed 7
 */

import { parseArgs } from "node:util";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ratingItems, ratingSheet, SHEET_COLUMNS, KEY_COLUMNS } from "../src/analysis/rating.js";
import { toCsv } from "../src/analysis/csv.js";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "study-logs/eval-runs" },
    out: { type: "string", default: "study-logs/rating" },
    seed: { type: "string", default: "1" },
  },
});

const files = (await readdir(values.runs)).filter((f) => f.endsWith(".json")).sort();
if (files.length === 0) throw new Error(`no run records in ${values.runs}; run npm run eval:runs`);
const records = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(join(values.runs, f), "utf8"))),
);
const sets = new Set(records.map((r) => r.scenario?.file?.sha256));
if (sets.size > 1) throw new Error("the runs come from different event set versions");

const items = ratingItems(records);
const { sheet, key } = ratingSheet(items, { seed: Number(values.seed) });
await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "rating-sheet.csv"), toCsv(sheet, SHEET_COLUMNS));
await writeFile(join(values.out, "rating-key.csv"), toCsv(key, KEY_COLUMNS));

const count = (condition) => key.filter((k) => k.condition === condition).length;
console.log(
  `${sheet.length} items from ${files.length} runs (ai ${count("ai")}, scripted ${count("scripted")}).\n` +
    `Give each rater a copy of ${join(values.out, "rating-sheet.csv")} and docs/study/rating.md.\n` +
    `Keep ${join(values.out, "rating-key.csv")} away from the raters.`,
);
