/**
 * The real implementations the contract suites run against (docs/pipeline-contract.md).
 *
 * Register yours here when it lands. Until a list has an entry, its suite shows every
 * check as TODO, so `npm test` always lists what's still waiting on an implementation.
 *
 *   import startPipeline from "../../src/service/pipeline.js";
 *   export const pipelines = [{ name: "service pipeline", start: startPipeline }];
 */

/** @type {{name: string, start: Function}[]} Sittipon: persona selector + router (W06-W07). */
export const pipelines = [];

/**
 * @type {{name: string, initial: () => object, reduce: (state: object, event: object) => object}[]}
 * Shapphanyu: followers / donations / hype model (W02, W04).
 */
export const statsModels = [];
