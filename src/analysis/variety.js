/**
 * variety.js
 *
 * The proposal's variety measure: repeated-message rate and distinct-2 across
 * equal-length sessions, read alongside relevance (a chat can be varied and off-topic).
 *
 * - Repeat rate: the share of lines whose text already appeared earlier in the same
 *   session, after normalizing case, punctuation and spacing.
 * - Distinct-2: unique word bigrams / all word bigrams (Li et al., 2016), with bigrams
 *   taken inside each line, over the session's lines.
 */

/** Lower case, NFKC, punctuation and emoji to spaces, spaces collapsed. */
export function normalize(text) {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(text) {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/** @param {string[]} texts - In the order they were shown. Null when there are none. */
export function repeatRate(texts) {
  if (texts.length === 0) return null;
  const seen = new Set();
  let repeats = 0;
  for (const text of texts) {
    // An emoji-only line normalizes to "": compare those by their raw text.
    const key = normalize(text) || `raw:${String(text).trim()}`;
    if (seen.has(key)) repeats++;
    else seen.add(key);
  }
  return repeats / texts.length;
}

/** @param {string[]} texts - Null when no line has two words. */
export function distinct2(texts) {
  const all = [];
  for (const text of texts) {
    const w = words(text);
    for (let i = 0; i + 1 < w.length; i++) all.push(`${w[i]} ${w[i + 1]}`);
  }
  return all.length ? new Set(all).size / all.length : null;
}

/** @param {string[]} texts */
export function variety(texts) {
  return { lines: texts.length, repeatRate: repeatRate(texts), distinct2: distinct2(texts) };
}
