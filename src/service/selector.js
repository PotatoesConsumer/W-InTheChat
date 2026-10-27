/**
 * selector.js
 *
 * Persona selector (W06): which persona answers a major event or a player message with a
 * model reply. A weighted draw from the event and one seeded random number, so the same
 * seed and events always pick the same personas, whatever the model returns
 * (docs/pipeline-contract.md, persona-independent-of-model). Voice rules behind the
 * weights: docs/personas.md.
 */

/**
 * Relative weights per event. Game events by catalog name, `chat` for player messages,
 * `major` for any other major event (the catalog is a draft until the mini-game is
 * chosen). A persona with no weight is never picked for that event: the Lurker only
 * speaks at big moments, so it never answers player chat.
 */
export const PERSONA_WEIGHTS = Object.freeze({
  win: Object.freeze({ fan: 5, hater: 3, backseat: 1, lurker: 2 }),
  loss: Object.freeze({ fan: 2, hater: 4, backseat: 4, lurker: 1 }),
  streak: Object.freeze({ fan: 5, hater: 2, backseat: 1, lurker: 2 }),
  close_call: Object.freeze({ fan: 3, hater: 2, backseat: 3, lurker: 2 }),
  new_best: Object.freeze({ fan: 5, hater: 2, backseat: 1, lurker: 2 }),
  major: Object.freeze({ fan: 3, hater: 2, backseat: 2, lurker: 1 }),
  chat: Object.freeze({ fan: 4, hater: 3, backseat: 3 }),
});

/**
 * @param {{kind: "game" | "chat", name: string | null}} ctx - A context payload.
 * @param {number} roll - A seeded random number in [0, 1).
 * @param {readonly string[]} personas - The personas that may answer.
 * @returns {string} one of `personas`
 */
export function selectPersona(ctx, roll, personas) {
  const weights =
    ctx.kind === "chat"
      ? PERSONA_WEIGHTS.chat
      : Object.hasOwn(PERSONA_WEIGHTS, ctx.name)
        ? PERSONA_WEIGHTS[ctx.name]
        : PERSONA_WEIGHTS.major;
  const options = personas.filter((p) => (weights[p] ?? 0) > 0);
  if (options.length === 0) {
    throw new Error(`no enabled persona can answer "${ctx.name ?? ctx.kind}"`);
  }
  const total = options.reduce((sum, p) => sum + weights[p], 0);
  let x = roll * total;
  for (const p of options) {
    if (x < weights[p]) return p;
    x -= weights[p];
  }
  return options.at(-1);
}
