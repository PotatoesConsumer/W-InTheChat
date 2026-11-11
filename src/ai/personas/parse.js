/**
 * Shared reply parser for every persona: the model's raw output -> one chat line.
 */

/**
 * Speaker labels the model sometimes writes before the line (`Player: "hi"`), copying
 * the "viewer: text" chat format. Only these words, so "Pro tip: wait" is left alone.
 */
const SPEAKER_LABEL =
  /^(player|streamer|viewer|chat|chat back|chat message|message|reply|response|fan|hater|backseat|backseat gamer|lurker)\s*:\s*/i;

/**
 * Keeps the first real line of the reply and strips the speaker label, quotes and
 * markdown the model sometimes wraps it in. Also used on partial streamed text, so it
 * only ever trims the ends and removes `**`; it never reorders what's left.
 * @param {string} raw
 */
export function parseChatLine(raw) {
  const line =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "" && !l.startsWith("```")) ?? "";
  return line
    .replace(/\*\*/g, "")
    .replace(SPEAKER_LABEL, "")
    .replace(/^["'*`]+|["'*`]+$/g, "")
    .trim();
}

/**
 * Keeps whole sentences while the line stays within `maxWords`, and always the first
 * one. For a persona the 3B model can't keep short by prompt alone: the Backseat Gamer
 * writes a second sentence about a quarter of the time. It only cuts at sentence ends,
 * so a line still only grows as more of the reply comes in.
 * @param {string} line - A parsed chat line.
 * @param {number} maxWords
 */
export function limitSentences(line, maxWords) {
  const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
  let out = "";
  for (const sentence of sentences) {
    const next = out + sentence;
    if (out && next.trim().split(/\s+/).length > maxWords) break;
    out = next;
  }
  return out.trim();
}
