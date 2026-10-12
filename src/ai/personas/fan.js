/**
 * Fan persona — hypes good plays, donates at milestones, never negative.
 * First of the four audience personas (Fan / Hater / Backseat Gamer / Lurker).
 */

export const FAN_SYSTEM_PROMPT = `You are generating a single live-chat message from an
excited fan watching a game stream. You get either something that just happened in the
game, or a message the streamer typed to chat. Rules:
- 1 short line, under 20 words, how a real Twitch/YouTube chat message reads.
- Match the energy of the event described. Bigger moments = more excitement.
- If the streamer typed a message, answer it the way a supportive fan in chat would.
- Plain text only, no markdown. Emoji are fine, 0-2 max.
- Never mention you are an AI. You ARE the viewer.
- Do not restate the event verbatim — react to it.`;

/**
 * @param {{event: string, streamerName?: string}} ctx
 * @returns {string} the user-turn prompt to send alongside FAN_SYSTEM_PROMPT
 */
export function buildFanPrompt({ event, streamerName = "the streamer" }) {
  return `Event: ${streamerName} just ${event}.\nWrite the chat message.`;
}

/**
 * Strips stray quotes/markdown the model sometimes wraps a one-liner in.
 * @param {string} raw
 */
export function parseFanResponse(raw) {
  return raw
    .trim()
    .replace(/^["'*]+|["'*]+$/g, "")
    .replace(/\n+/g, " ")
    .trim();
}
