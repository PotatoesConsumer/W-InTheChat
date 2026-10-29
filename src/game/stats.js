/**
 * stats.js
 *
 * Followers / donations / hype: the stream's stats, as a pure reducer over bus events
 * (interface in docs/pipeline-contract.md). The same events always give the same stats,
 * and nothing the model writes can change them: chat replies never reach this file.
 *
 * - hype: 0-100. Good plays raise it, losses and hits lower it.
 * - followers: only grows. Big moments bring followers, more of them when hype is high.
 * - donations: the donation balance ($). Big moments get a donation once hype passes a
 *   threshold; buying coins in the game (`coin_purchase`) spends `data.dollars` of it.
 *
 * The numbers are a first pass for the demo; tune them once the mini-game is chosen.
 */

/**
 * Per game event: hype change, followers gained, whether it can bring a donation, and
 * whether it spends donations (`data.dollars`).
 */
export const STAT_RULES = Object.freeze({
  round_start: { hype: 2, followers: 0, donation: false },
  kill: { hype: 4, followers: 0, donation: false },
  damage_taken: { hype: -3, followers: 0, donation: false },
  item_pickup: { hype: 1, followers: 0, donation: false },
  coin_purchase: { hype: 0, followers: 0, donation: false, spends: true },
  win: { hype: 20, followers: 3, donation: true },
  loss: { hype: -15, followers: 0, donation: false },
  streak: { hype: 12, followers: 2, donation: true },
  close_call: { hype: 10, followers: 1, donation: false },
  new_best: { hype: 15, followers: 5, donation: true },
});

/** The streamer talking to chat keeps the room warm. */
export const CHAT_RULE = Object.freeze({ hype: 1, followers: 0, donation: false });

export const STAT_LIMITS = Object.freeze({
  maxHype: 100,
  /** Extra followers on a big moment: one per this much hype. */
  hypePerBonusFollower: 20,
  /** Donations only come in at or above this hype. */
  donationHype: 50,
  /** Donations are rounded to this step. */
  donationStep: 10,
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
  if (rule.donation && hype >= STAT_LIMITS.donationHype) {
    donations += Math.round(hype / STAT_LIMITS.donationStep) * STAT_LIMITS.donationStep;
  }
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
