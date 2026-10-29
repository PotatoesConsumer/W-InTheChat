import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { stats, statChanges, STAT_LIMITS } from "../../src/game/stats.js";
import {
  donationFor,
  DONATION_EVENTS,
  DONATION_RULES,
  DONATION_MESSAGES,
  DONORS,
} from "../../src/game/donations.js";

// Fixed ids: donations are seeded from the event id, so these tests see the same ones.
const event = (name, i, data = {}) =>
  name === "chat"
    ? createChatEvent("hi chat", { id: `c${i}`, ts: 1 })
    : createGameEvent(name, data, { id: `e${i}`, ts: 1 });
const play = (...names) => names.reduce((s, n, i) => stats.reduce(s, event(n, i)), stats.initial());

/** Many donations at full hype, from event ids d0, d1, ... */
const sample = (n, name = "win") =>
  Array.from({ length: n }, (_, i) =>
    donationFor(createGameEvent(name, {}, { id: `d${i}`, ts: 1 }), 100),
  );

test("starts at zero and returns frozen states", () => {
  assert.deepEqual(stats.initial(), { followers: 0, donations: 0, hype: 0 });
  assert.ok(Object.isFrozen(play("win")));
});

test("good plays raise hype, losses and hits lower it, within 0-100", () => {
  assert.equal(play("kill", "kill").hype, 8);
  assert.equal(play("kill", "damage_taken").hype, 1);
  assert.equal(play("loss").hype, 0, "never below 0");
  assert.equal(play(...Array(10).fill("win")).hype, STAT_LIMITS.maxHype);
  assert.equal(play("chat").hype, 1);
});

test("big moments bring followers, more when hype is high; followers never drop", () => {
  assert.equal(play("win").followers, 3 + 1); // hype 20 -> one bonus follower
  const hyped = play("win", "win", "win"); // hype 60
  assert.equal(hyped.followers, 4 + 5 + 6);
  assert.equal(play("win", "loss", "loss").followers, 4);
  assert.equal(play("kill", "item_pickup", "damage_taken").followers, 0);
});

test("the stats add exactly the donation donationFor gives", () => {
  let state = stats.initial();
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const e = event(i % 3 === 0 ? "kill" : DONATION_EVENTS[i % DONATION_EVENTS.length], i);
    state = stats.reduce(state, e);
    total += donationFor(e, state.hype)?.amount ?? 0;
  }
  assert.ok(total > 0);
  assert.equal(state.donations, total);
});

test("donations: only big moments, only with some hype, and not every time", () => {
  for (const name of ["kill", "loss", "damage_taken", "round_start", "chat"]) {
    assert.equal(donationFor(event(name, 1), 100), null, name);
  }
  const low = Array.from({ length: 200 }, (_, i) => donationFor(event("win", i), 29));
  assert.ok(
    low.every((d) => d === null),
    "nothing below minHype",
  );

  const given = sample(2000).filter(Boolean);
  const rate = given.length / 2000;
  assert.ok(rate > 0.4 && rate < 0.6, `about half at full hype, got ${rate}`);
  const atMin = Array.from({ length: 2000 }, (_, i) =>
    donationFor(event("win", i), DONATION_RULES.minHype),
  ).filter(Boolean).length;
  assert.ok(atMin / 2000 < 0.2, `rarer at low hype, got ${atMin / 2000}`);
});

test("donations are mostly small; $20-100 is rare", () => {
  const amounts = sample(5000)
    .filter(Boolean)
    .map((d) => d.amount);
  const share = (test) => amounts.filter(test).length / amounts.length;
  assert.ok(amounts.every((a) => Number.isInteger(a) && a >= 1 && a <= 100));
  assert.ok(share((a) => a < 10) > 0.85, `under $10: ${share((a) => a < 10)}`);
  assert.ok(share((a) => a >= 20) < 0.04, `$20+: ${share((a) => a >= 20)}`);
  assert.ok(share((a) => a >= 20) > 0, "but it does happen");
});

test("each donation has a donor and a fitting message", () => {
  for (const name of DONATION_EVENTS) {
    for (const d of sample(300, name).filter(Boolean)) {
      assert.ok(DONORS.includes(d.viewer));
      const fits =
        d.amount >= DONATION_RULES.bigAmount
          ? DONATION_MESSAGES.big
          : [...DONATION_MESSAGES.any, ...DONATION_MESSAGES[name]];
      assert.ok(fits.includes(d.message), `${name} $${d.amount}: ${d.message}`);
    }
  }
  for (const viewer of DONORS) assert.ok(viewer.length <= 25, viewer);
});

test("the same events always give the same stats", () => {
  const names = ["round_start", "kill", "win", "chat", "close_call", "streak", "loss", "new_best"];
  assert.deepEqual(play(...names), play(...names));
  const e = event("win", 7);
  assert.deepEqual(donationFor(e, 80), donationFor(e, 80));
});

test("statChanges reports what moved", () => {
  const a = play("win");
  const b = stats.reduce(a, event("loss", 9));
  assert.deepEqual(statChanges(a, b), { followers: 0, donations: 0, hype: -15 });
});

test("buying coins spends donations, never below zero", () => {
  const rich = { followers: 0, donations: 60, hype: 50 };
  const buy = (dollars) => createGameEvent("coin_purchase", { pack: "Bag of Coins", dollars });
  assert.equal(stats.reduce(rich, buy(25)).donations, 35);
  assert.equal(stats.reduce(rich, buy(500)).donations, 0);
  assert.equal(stats.reduce(rich, createGameEvent("coin_purchase")).donations, 60, "no dollars");
  assert.equal(stats.reduce(rich, buy(25)).hype, rich.hype);
});
