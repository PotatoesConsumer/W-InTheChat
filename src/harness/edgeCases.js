/**
 * edgeCases.js
 *
 * The proposal's edge cases and how each one is produced (scenario, fake model mode,
 * playback speed). Shared by the W07 contract suite (test/contracts/) and the
 * regression pass (scripts/regression.js). Expected outcomes and the checks that judge
 * them: docs/pipeline-contract.md ("Edge cases").
 *
 * `scenario` defaults to basic-session and `mode` to normal. A registered pipeline may
 * list ids it doesn't handle yet in `pending` (id -> reason).
 */

export const EDGE_CASES = Object.freeze([
  { id: "slow", title: "slow model: falls back within the timeout", mode: "slow", speed: 20 },
  { id: "down", title: "model down: falls back", mode: "error", speed: 20 },
  {
    id: "garbage",
    title: "malformed model output never reaches chat as-is",
    mode: "garbage",
    speed: 20,
  },
  { id: "unsafe", title: "unsafe model output is blocked and replaced", mode: "unsafe", speed: 20 },
  {
    id: "burst",
    title: "event bursts are coalesced and rate-limited",
    scenario: "burst",
    speed: 1,
  },
  {
    id: "bad-input",
    title: "empty and oversized player input gets no reply",
    scenario: "player-chat",
    speed: 20,
  },
  {
    id: "malformed",
    title: "malformed events are dropped, the next one still works",
    scenario: "malformed",
    speed: 20,
  },
]);

/**
 * The pending edge cases that cover a run: those whose scenario and mode (where set)
 * match it. Used to tell a known gap from a regression.
 * @param {{scenario: string, mode: string}} run
 * @param {Record<string, string>} [pending] - Edge-case id -> reason.
 * @returns {{id: string, reason: string}[]}
 */
export function pendingFor(run, pending = {}) {
  return EDGE_CASES.filter(
    (c) =>
      Object.hasOwn(pending, c.id) &&
      (!c.scenario || c.scenario === run.scenario) &&
      (!c.mode || c.mode === run.mode),
  ).map((c) => ({ id: c.id, reason: pending[c.id] }));
}
