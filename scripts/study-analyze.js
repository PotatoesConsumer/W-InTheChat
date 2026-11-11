/**
 * The study's analysis: reads the session logs, the questionnaire responses and the
 * filled rating sheets, and prints the results as Markdown for the evaluation report
 * (docs/report/). Parts with no input yet say so.
 *
 *   npm run study:analyze
 *   npm run study:analyze -- --logs study-logs --responses study-logs/responses.csv \
 *     --key study-logs/rating/rating-key.csv --ratings study-logs/rating/filled \
 *     --out study-logs/results.md
 *
 * --ratings is a folder of filled sheets, one CSV per rater (the file name is the rater).
 * Session logs whose label starts with T (pilot) or CHECK are left out.
 */

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseCsv } from "../src/analysis/csv.js";
import { parseSessionLog, summarizeSessions } from "../src/analysis/sessions.js";
import { analyzeRatings } from "../src/analysis/rating.js";
import { analyzeResponses } from "../src/analysis/engagement.js";
import { formatSessions, formatRatings, formatEngagement } from "../src/analysis/report.js";

const { values } = parseArgs({
  options: {
    logs: { type: "string", default: "study-logs" },
    responses: { type: "string", default: "study-logs/responses.csv" },
    key: { type: "string", default: "study-logs/rating/rating-key.csv" },
    ratings: { type: "string", default: "study-logs/rating/filled" },
    out: { type: "string" },
    "include-pilot": { type: "boolean", default: false },
  },
});

const notStudy = /^(T\d|CHECK|session-)/;

async function sessionLogs() {
  if (!existsSync(values.logs)) return [];
  const files = (await readdir(values.logs)).filter((f) => f.endsWith(".jsonl")).sort();
  const logs = await Promise.all(
    files.map(async (f) => parseSessionLog(await readFile(join(values.logs, f), "utf8"), f)),
  );
  return logs.filter(
    (log) => log.events.length > 0 && (values["include-pilot"] || !notStudy.test(log.file)),
  );
}

async function ratings() {
  if (!existsSync(values.key) || !existsSync(values.ratings)) return null;
  const files = (await readdir(values.ratings)).filter((f) => f.endsWith(".csv")).sort();
  if (files.length === 0) return null;
  const key = parseCsv(await readFile(values.key, "utf8"));
  const sheets = await Promise.all(
    files.map(async (f) => ({
      rater: basename(f, ".csv"),
      rows: parseCsv(await readFile(join(values.ratings, f), "utf8")),
    })),
  );
  return analyzeRatings(key, sheets);
}

async function responses() {
  if (!existsSync(values.responses)) return null;
  return analyzeResponses(parseCsv(await readFile(values.responses, "utf8")));
}

const logs = await sessionLogs();
const markdown = [
  "# Study results",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run study:analyze\` from ` +
    `${logs.length} session logs. Local model (qwen2.5:3b through Ollama); no hosted API.`,
  "",
  formatSessions(summarizeSessions(logs)),
  formatRatings(await ratings()),
  formatEngagement(await responses()),
].join("\n");

if (values.out) {
  await writeFile(values.out, markdown);
  console.log(`Wrote ${values.out}`);
} else {
  console.log(markdown);
}
