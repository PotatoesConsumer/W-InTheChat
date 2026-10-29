import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, createChatEvent } from "../../src/events/schema.js";
import { stats, statChanges, STAT_LIMITS } from "../../src/game/stats.js";

const play = (...names) =>
  names.reduce(
    (state, name) =>
      stats.reduce(state, name === "chat" ? createChatEvent("hi chat") : createGameEvent(name)),
    stats.initial(),
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

test("donations only come in on big moments once hype passes the threshold", () => {
  assert.equal(play("win", "win").donations, 0, "hype 40 is below the threshold");
  const s = play("win", "win", "win"); // hype 60 on the third win
  assert.equal(s.donations, 60);
  assert.equal(stats.reduce(s, createGameEvent("close_call")).donations, 60, "no donation");
  assert.equal(stats.reduce(s, createGameEvent("new_best")).donations, 60 + 80);
});

test("the same events always give the same stats", () => {
  const names = ["round_start", "kill", "win", "chat", "close_call", "streak", "loss", "new_best"];
  assert.deepEqual(play(...names), play(...names));
});

test("statChanges reports what moved", () => {
  const a = play("win");
  const b = stats.reduce(a, createGameEvent("loss"));
  assert.deepEqual(statChanges(a, b), { followers: 0, donations: 0, hype: -15 });
});

test("buying coins spends donations, never below zero", () => {
  const rich = play("win", "win", "win"); // $60 donated
  const buy = (dollars) => createGameEvent("coin_purchase", { pack: "Bag of Coins", dollars });
  assert.equal(stats.reduce(rich, buy(25)).donations, 35);
  assert.equal(stats.reduce(rich, buy(500)).donations, 0);
  assert.equal(stats.reduce(rich, createGameEvent("coin_purchase")).donations, 60, "no dollars");
  assert.equal(stats.reduce(rich, buy(25)).hype, rich.hype);
});
