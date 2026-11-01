/**
 * The real implementations the contract suites run against (docs/pipeline-contract.md).
 *
 * Register yours here when it lands. Until a list has an entry, its suite shows every
 * check as TODO, so `npm test` always lists what's still waiting on an implementation.
 *
 *   import startPipeline from "../../src/service/pipeline.js";
 *   export const pipelines = [{ name: "service pipeline", start: startPipeline }];
 *
 * A pipeline may list edge cases it doesn't handle yet in `pending` (edge-case id ->
 * reason, ids in edgeCases.contract.test.js). They show as TODO until removed from it.
 */

import startPipeline from "../../src/service/pipeline.js";
import { stats } from "../../src/game/stats.js";
import { checkSafety } from "../../src/service/safetyFilter.js";

/**
 * @type {{name: string, start: Function, pending?: Record<string, string>}[]}
 * Sittipon: persona selector + router (W06-W07).
 */
export const pipelines = [
  {
    name: "service pipeline",
    start: startPipeline,
  },
];

/**
 * @type {{name: string, initial: () => object, reduce: (state: object, event: object) => object}[]}
 * Shapphanyu: followers / donations / hype model (W02, W04).
 */
export const statsModels = [{ name: "stream stats", ...stats }];

/**
 * @type {{name: string, check: (text: string) => {ok: boolean, reason?: string} | Promise<{ok: boolean, reason?: string}>}[]}
 * Sittipon: output filter (W07). `ok: false` means the text must not be shown.
 */
export const filters = [{ name: "output safety filter", check: checkSafety }];
