/**
 * donations.js
 *
 * Viewer donations, like a real stream: big moments sometimes bring one, usually a few
 * dollars, rarely $20 or more, each with a short message from the donor ("$5: i love
 * your stream"). stats.js adds the amount; main.js shows the donation in chat.
 *
 * Whether an event brings a donation, how much and from whom are drawn from a random
 * seeded with the event's id, so the same events always give the same donations (the
 * stats stay a pure function of the events). The model never writes these lines.
 */

import { seededRandom, hashString } from "./random.js";

/** Game events that can bring a donation. */
export const DONATION_EVENTS = Object.freeze(["win", "streak", "close_call", "new_best"]);

export const DONATION_RULES = Object.freeze({
  /** No donations below this hype. */
  minHype: 30,
  /** Chance of a donation at minHype, rising to maxChance at 100 hype. */
  minChance: 0.15,
  maxChance: 0.5,
  /** Amount tiers ($, inclusive), by weight: about 9 in 10 are under $10, 1 in 50 is $20+. */
  tiers: Object.freeze([
    Object.freeze({ weight: 70, min: 1, max: 4 }),
    Object.freeze({ weight: 20, min: 5, max: 9 }),
    Object.freeze({ weight: 8, min: 10, max: 19 }),
    Object.freeze({ weight: 1.6, min: 20, max: 49 }),
    Object.freeze({ weight: 0.4, min: 50, max: 100 }),
  ]),
  /** At or above this, a donation gets one of the BIG_MESSAGES. */
  bigAmount: 20,
});

/** Donor names. Max 25 chars, like viewer names. */
export const DONORS = Object.freeze([
  "cozy_carrot",
  "slime_slayer88",
  "pixel_pal",
  "mochi_mage",
  "night_owl_tv",
  "coinflip_kid",
  "bean_bandit",
  "lofi_larry",
]);

/** Fixed, safe donor messages: any moment, per event, and for big donations. */
export const DONATION_MESSAGES = Object.freeze({
  any: Object.freeze([
    "i love your stream",
    "first time here, love the vibes",
    "for the medkit fund",
    "keep it up!",
    "buy yourself a snack",
    "hi from the lurk squad",
    "small dono, big love",
  ]),
  win: Object.freeze(["gg on that wave!", "clean wave clear"]),
  streak: Object.freeze(["that streak tho", "untouchable!!"]),
  close_call: Object.freeze(["my heart cant take this", "1 hp hero"]),
  new_best: Object.freeze(["new record!! here's a little something", "PB money"]),
  big: Object.freeze([
    "HOLY that was insane, take my money",
    "best stream on the site fr",
    "you earned every cent of this",
  ]),
});

/**
 * The donation an event brings, if any.
 * @param {Readonly<object>} event - A valid bus event.
 * @param {number} hype - The hype after the event (0-100).
 * @returns {{amount: number, viewer: string, message: string} | null}
 */
export function donationFor(event, hype) {
  if (event?.kind !== "game" || !DONATION_EVENTS.includes(event.name)) return null;
  const { minHype, minChance, maxChance, tiers, bigAmount } = DONATION_RULES;
  if (hype < minHype) return null;

  const random = seededRandom(hashString(event.id));
  const chance = minChance + ((maxChance - minChance) * (hype - minHype)) / (100 - minHype);
  if (random() >= chance) return null;

  const tier = pickWeighted(tiers, random());
  const amount = tier.min + Math.floor(random() * (tier.max - tier.min + 1));
  const viewer = pick(DONORS, random());
  const messages =
    amount >= bigAmount
      ? DONATION_MESSAGES.big
      : [...DONATION_MESSAGES.any, ...DONATION_MESSAGES[event.name]];
  return { amount, viewer, message: pick(messages, random()) };
}

function pickWeighted(tiers, roll) {
  const total = tiers.reduce((sum, t) => sum + t.weight, 0);
  let left = roll * total;
  for (const tier of tiers) {
    if (left < tier.weight) return tier;
    left -= tier.weight;
  }
  return tiers.at(-1);
}

function pick(list, roll) {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}
