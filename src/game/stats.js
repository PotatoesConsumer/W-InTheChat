/**
 * stats.js
 *
 * Followers / donations / hype: the stream's stats, as a pure reducer over bus events
 * (interface in docs/pipeline-contract.md). The same events always give the same stats,
 * and nothing the model writes can change them: chat replies never reach this file.
 *
 * - hype: 0-100. Good plays raise it, losses and hits lower it.
 * - followers: only grows. Big moments bring followers, more of them when hype is high.
 * - donations: the donation balance ($). Big moments sometimes bring a donation, usually a
 *   few dollars (donations.js); buying coins in the game (`coin_purchase`) spends
 *   `data.dollars` of it.
 *
 * The numbers are a first pass for the demo; tune them after playing.
 */

import { donationFor } from "./donations.js";

/**
 * Per game event: hype change, followers gained, and whether it spends donations
 * (`data.dollars`). Which events can bring a donation is DONATION_EVENTS in donations.js.
 */
export const STAT_RULES = Object.freeze({
  round_start: { hype: 2, followers: 0 },
  kill: { hype: 4, followers: 0 },
  damage_taken: { hype: -3, followers: 0 },
  item_pickup: { hype: 1, followers: 0 },
  coin_purchase: { hype: 0, followers: 0, spends: true },
  win: { hype: 20, followers: 3 },
  loss: { hype: -15, followers: 0 },
  streak: { hype: 12, followers: 2 },
  close_call: { hype: 10, followers: 1 },
  new_best: { hype: 15, followers: 5 },
  // The Dark House
  horror_start: { hype: 2, followers: 0 },
  key_found: { hype: 4, followers: 0 },
  monster_near: { hype: 6, followers: 0 },
  escaped: { hype: 20, followers: 3 },
  caught: { hype: -10, followers: 0 },
  // Just Chatting
  crafted: { hype: 3, followers: 0 },
  material_purchase: { hype: 0, followers: 0, spends: true },
  ghost_pet: { hype: 2, followers: 0 },
});

/** The streamer talking to chat keeps the room warm. */
export const CHAT_RULE = Object.freeze({ hype: 1, followers: 0 });

export const STAT_LIMITS = Object.freeze({
  maxHype: 100,
  /** Extra followers on a big moment: one per this much hype. */
  hypePerBonusFollower: 20,
});

function initial() {
  return Object.freeze({ followers: 0, donations: 0, hype: 0 });
}

/**
 * @param {{followers: number, donations: number, hype: number}} state
 * @param {Readonly<object>} event - A valid bus event.
 */
function reduce(state, event) {
  const rule = ruleFor(event);
  if (!rule) return state;

  const hype = clamp(state.hype + rule.hype, 0, STAT_LIMITS.maxHype);
  let followers = state.followers + rule.followers;
  if (rule.followers > 0) followers += Math.floor(hype / STAT_LIMITS.hypePerBonusFollower);
  let donations = state.donations;
  donations += donationFor(event, hype)?.amount ?? 0;
  if (rule.spends) donations = Math.max(0, donations - spentDollars(event));
  return Object.freeze({ followers, donations, hype });
}

/** Dollars an event spends; anything but a non-negative number spends nothing. */
function spentDollars(event) {
  const dollars = event.data?.dollars;
  return typeof dollars === "number" && dollars > 0 ? dollars : 0;
}

function ruleFor(event) {
  if (event?.kind === "chat") return CHAT_RULE;
  if (event?.kind === "game" && Object.hasOwn(STAT_RULES, event.name)) {
    return STAT_RULES[event.name];
  }
  return null;
}

/** The stats model, in the shape the harness and contract tests take. */
export const stats = Object.freeze({ initial, reduce });

/**
 * What changed between two states, for the HUD's "+3 followers" pop-ups.
 * @returns {{followers: number, donations: number, hype: number}}
 */
export function statChanges(prev, next) {
  return {
    followers: next.followers - prev.followers,
    donations: next.donations - prev.donations,
    hype: next.hype - prev.hype,
  };
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
