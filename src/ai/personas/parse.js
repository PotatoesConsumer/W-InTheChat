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
