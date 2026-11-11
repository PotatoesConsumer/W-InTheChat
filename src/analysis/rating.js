/**
 * rating.js
 *
 * The blind rating of the proposal's evaluation: raters score whether each sampled chat
 * message fits its triggering event (1-5) and say which of the four personas wrote it.
 *
 * - ratingItems() takes run records of the fixed event set (one per condition and seed,
 *   from `npm run eval:runs`) and keeps the lines that answer a major event or a player
 *   message: the lines the two conditions produce differently. Minor events get the same
 *   templates in both, so they're left out.
 * - ratingSheet() shuffles them with a seed and splits them into the sheet raters see
 *   (trigger and message only: no condition, persona, viewer name or source) and the
 *   key the analysis joins back on `item`.
 * - analyzeRatings() reads filled sheets with the key: relevance per condition, persona
 *   accuracy and the confusion matrix, and how far raters agree.
 */

import { GAME_EVENTS } from "../events/schema.js";
import { seededRandom } from "../game/random.js";
import { mean, median, distribution, wilsonInterval, bootstrapInterval } from "./stats.js";

export const PERSONAS = Object.freeze(["fan", "hater", "backseat", "lurker"]);
export const SHEET_COLUMNS = Object.freeze(["item", "trigger", "message", "relevance", "persona"]);
export const KEY_COLUMNS = Object.freeze([
  "item",
  "condition",
  "seed",
  "persona",
  "source",
  "eventId",
  "category",
  "viewer",
]);

const REPLY_SOURCES = new Set(["ai", "scripted", "fallback"]);

/** What a rater reads as the trigger: the event in words, or what the player typed. */
export function describeTrigger(event) {
  if (event.kind === "chat") return `The streamer typed in chat: "${event.text}"`;
  const phrase = GAME_EVENTS[event.name]?.phrase ?? event.name;
  const details = Object.entries(event.data ?? {})
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return `The streamer ${phrase}${details ? ` (${details})` : ""}`;
}

/** @param {object[]} records - Harness run records (src/harness/runner.js). */
export function ratingItems(records) {
  const items = [];
  for (const record of records) {
    const events = new Map(record.events.filter((e) => e.accepted).map((e) => [e.event.id, e]));
    for (const { message } of record.messages) {
      if (!message.done || !REPLY_SOURCES.has(message.source)) continue;
      const entry = events.get(message.eventId);
      if (!entry) continue;
      items.push({
        condition: record.condition,
        seed: record.seed,
        persona: message.persona,
        source: message.source,
        eventId: message.eventId,
        category: entry.note?.split(":")[0] ?? entry.event.name ?? "",
        viewer: message.viewer,
        trigger: describeTrigger(entry.event),
        message: message.text,
      });
    }
  }
  return items;
}

/**
 * @param {ReturnType<typeof ratingItems>} items
 * @param {{seed?: number}} [opts]
 * @returns {{sheet: object[], key: object[]}}
 */
export function ratingSheet(items, { seed = 1 } = {}) {
  const random = seededRandom(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const id = (i) => `R${String(i + 1).padStart(3, "0")}`;
  return {
    sheet: shuffled.map((it, i) => ({
      item: id(i),
      trigger: it.trigger,
      message: it.message,
      relevance: "",
      persona: "",
    })),
    key: shuffled.map((it, i) => ({ item: id(i), ...it })),
  };
}

/** A rater's persona answer to one of PERSONAS, or null ("backseat gamer" -> backseat). */
export function readPersona(answer) {
  const a = String(answer ?? "")
    .trim()
    .toLowerCase();
  return PERSONAS.find((p) => a === p || a.startsWith(p)) ?? null;
}

/** A 1-5 relevance score, or null. */
export function readRelevance(answer) {
  const n = Number(String(answer ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * @param {Record<string, string>[]} key - Parsed key CSV.
 * @param {{rater: string, rows: Record<string, string>[]}[]} sheets - Parsed, filled sheets.
 */
export function analyzeRatings(key, sheets) {
  const byItem = new Map(key.map((k) => [k.item, k]));
  const conditions = [...new Set(key.map((k) => k.condition))].sort();
  const ratings = []; // {rater, item, condition, persona (true), source, relevance, guess}
  const unknownItems = new Set();
  let blank = 0;
  for (const { rater, rows } of sheets) {
    for (const row of rows) {
      const k = byItem.get(row.item);
      if (!k) {
        unknownItems.add(row.item);
        continue;
      }
      const relevance = readRelevance(row.relevance);
      const guess = readPersona(row.persona);
      if (relevance === null && guess === null) blank++;
      ratings.push({ rater, item: row.item, ...k, relevance, guess });
    }
  }

  // Each item's mean relevance across its raters: the unit the intervals resample, since
  // ratings of one item by several raters aren't independent.
  const itemMeans = (condition) => {
    const byItem = new Map();
    for (const r of ratings) {
      if (r.condition !== condition || r.relevance === null) continue;
      byItem.set(r.item, [...(byItem.get(r.item) ?? []), r.relevance]);
    }
    return [...byItem.values()].map((v) => mean(v));
  };

  const perCondition = {};
  for (const condition of conditions) {
    const mine = ratings.filter((r) => r.condition === condition);
    const scores = mine.map((r) => r.relevance).filter((v) => v !== null);
    const guessed = mine.filter((r) => r.guess !== null);
    const confusion = Object.fromEntries(
      PERSONAS.map((t) => [t, Object.fromEntries(PERSONAS.map((g) => [g, 0]))]),
    );
    for (const r of guessed) if (confusion[r.persona]) confusion[r.persona][r.guess]++;
    const bySource = {};
    for (const source of [...new Set(mine.map((r) => r.source))].sort()) {
      const s = mine.filter((r) => r.source === source && r.relevance !== null);
      bySource[source] = { n: s.length, mean: mean(s.map((r) => r.relevance)) };
    }
    perCondition[condition] = {
      items: new Set(mine.map((r) => r.item)).size,
      relevance: {
        n: scores.length,
        mean: mean(scores),
        // 95% bootstrap interval for the mean, resampling items.
        interval: bootstrapInterval([itemMeans(condition)], (m) => mean(m)),
        median: median(scores),
        distribution: distribution(scores),
        bySource,
      },
      persona: {
        n: guessed.length,
        correct: guessed.filter((r) => r.guess === r.persona).length,
        accuracy: guessed.length
          ? guessed.filter((r) => r.guess === r.persona).length / guessed.length
          : null,
        // 95% Wilson interval. It treats every answer as independent, so with several
        // raters on the same items it's somewhat too narrow.
        interval: wilsonInterval(
          guessed.filter((r) => r.guess === r.persona).length,
          guessed.length,
        ),
        confusion, // rows: the true persona; columns: the raters' answer
      },
    };
  }

  // Agreement between raters, over items two or more raters answered.
  const byItemRatings = new Map();
  for (const r of ratings) byItemRatings.set(r.item, [...(byItemRatings.get(r.item) ?? []), r]);
  let personaPairs = 0;
  let personaAgree = 0;
  let relevancePairs = 0;
  let relevanceWithin1 = 0;
  for (const rs of byItemRatings.values()) {
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        if (rs[i].guess && rs[j].guess) {
          personaPairs++;
          if (rs[i].guess === rs[j].guess) personaAgree++;
        }
        if (rs[i].relevance !== null && rs[j].relevance !== null) {
          relevancePairs++;
          if (Math.abs(rs[i].relevance - rs[j].relevance) <= 1) relevanceWithin1++;
        }
      }
    }
  }

  // ai - scripted mean relevance, with a 95% bootstrap interval over items.
  const relevanceDiff =
    perCondition.ai && perCondition.scripted
      ? {
          diff: mean(itemMeans("ai")) - mean(itemMeans("scripted")),
          interval: bootstrapInterval(
            [itemMeans("ai"), itemMeans("scripted")],
            (a, s) => mean(a) - mean(s),
          ),
        }
      : null;

  return {
    raters: sheets.map((s) => s.rater),
    perCondition,
    relevanceDiff,
    agreement: {
      personaSame: personaPairs ? personaAgree / personaPairs : null,
      relevanceWithin1: relevancePairs ? relevanceWithin1 / relevancePairs : null,
      pairs: { persona: personaPairs, relevance: relevancePairs },
    },
    problems: { unknownItems: [...unknownItems], blankRows: blank },
  };
}
