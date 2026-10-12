/**
 * loop.js
 *
 * Fixed-timestep game loop. Game logic runs in fixed `step` ms updates so it behaves
 * the same at any frame rate; rendering happens once per animation frame with an
 * `alpha` (0..1) for interpolating between the last two updates.
 *
 * The clock and frame scheduler are injectable so tests can drive the loop by hand.
 */

/**
 * @param {object} opts
 * @param {(dtMs: number) => void} opts.update - Advance the game by exactly `dtMs` (= step).
 * @param {(alpha: number) => void} opts.render - Draw; `alpha` is how far into the next step we are.
 * @param {number} [opts.step] - Update length in ms (default 60 updates/s).
 * @param {number} [opts.maxFrame] - Longest frame counted, in ms. A longer gap (tab in the
 *   background, debugger pause) is clamped so the game doesn't run hundreds of catch-up updates.
 * @param {() => number} [opts.now] - Clock in ms.
 * @param {(cb: () => void) => unknown} [opts.requestFrame]
 * @param {(id: unknown) => void} [opts.cancelFrame]
 */
export function createGameLoop({
  update,
  render,
  step = 1000 / 60,
  maxFrame = 250,
  now = () => performance.now(),
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
}) {
  if (typeof update !== "function") throw new TypeError("update must be a function");
  if (typeof render !== "function") throw new TypeError("render must be a function");
  if (!(step > 0)) throw new RangeError("step must be a positive number of ms");

  let running = false;
  let frameId = null;
  let last = 0;
  let accumulator = 0;

  function frame() {
    frameId = null;
    const t = now();
    accumulator += Math.min(Math.max(t - last, 0), maxFrame);
    last = t;

    while (running && accumulator >= step) {
      update(step);
      accumulator -= step;
    }
    if (!running) return;

    render(accumulator / step);
    if (running) frameId = requestFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = now();
      accumulator = 0;
      frameId = requestFrame(frame);
    },

    stop() {
      running = false;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },

    get running() {
      return running;
    },
  };
}
