/**
 * expression.js
 *
 * The optional camera extension (W11): MediaPipe's face blendshape scores -> one coarse
 * expression word (smiling, surprised, frowning, neutral). Only that word leaves this
 * module: it moves the facecam avatar and goes on the bus as an `expression` event.
 * Plain logic, tested in Node; camera.js does the browser side.
 *
 * The thresholds are a first guess. Tune them on the real camera: `witc.camera()` in the
 * console shows the live scores.
 */

export const EXPRESSION_RULES = Object.freeze({
  /** mouthSmileLeft/Right, averaged. */
  smile: 0.5,
  /** jawOpen, together with raised brows or wide eyes, is surprise. */
  jawOpen: 0.45,
  browsOrEyes: 0.3,
  /** browDownLeft/Right or mouthFrownLeft/Right, averaged. */
  browDown: 0.4,
  frown: 0.3,
  /** An expression has to hold this long to count, so a blink or a word isn't one. */
  holdMs: 800,
  /** At most one event per this long, so the camera can't flood the chat. */
  cooldownMs: 8000,
});

/** Avatar mood per expression (moods from streamer.js). */
export const EXPRESSION_MOODS = Object.freeze({
  smiling: "happy",
  surprised: "shocked",
  frowning: "sad",
});

/**
 * @param {Record<string, number> | null} s - Blendshape name -> score (0-1); null: no face.
 * @param {typeof EXPRESSION_RULES} [rules]
 * @returns {"smiling" | "surprised" | "frowning" | "neutral"}
 */
export function classify(s, rules = EXPRESSION_RULES) {
  if (!s) return "neutral";
  const avg = (a, b) => ((s[a] ?? 0) + (s[b] ?? 0)) / 2;
  const browsOrEyes = Math.max(s.browInnerUp ?? 0, avg("eyeWideLeft", "eyeWideRight"));
  if ((s.jawOpen ?? 0) > rules.jawOpen && browsOrEyes > rules.browsOrEyes) return "surprised";
  if (avg("mouthSmileLeft", "mouthSmileRight") > rules.smile) return "smiling";
  if (
    avg("browDownLeft", "browDownRight") > rules.browDown ||
    avg("mouthFrownLeft", "mouthFrownRight") > rules.frown
  ) {
    return "frowning";
  }
  return "neutral";
}

/**
 * Turns a stream of scores into steady expression changes.
 * @param {typeof EXPRESSION_RULES} [rules]
 */
export function createExpressionTracker(rules = EXPRESSION_RULES) {
  let current = "neutral";
  let candidate = "neutral";
  let since = 0;
  let lastEmit = -Infinity;

  return {
    /**
     * @param {Record<string, number> | null} scores
     * @param {number} now - ms
     * @returns {{expression: string, emit: boolean} | null} the new expression when it
     *   changes (null otherwise); `emit` says whether to send it as an event.
     */
    push(scores, now) {
      const label = classify(scores, rules);
      if (label !== candidate) {
        candidate = label;
        since = now;
        return null;
      }
      if (candidate === current || now - since < rules.holdMs) return null;
      current = candidate;
      const emit = current !== "neutral" && now - lastEmit >= rules.cooldownMs;
      if (emit) lastEmit = now;
      return { expression: current, emit };
    },

    get current() {
      return current;
    },
  };
}
