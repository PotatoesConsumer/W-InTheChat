import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, GAME_EVENTS, IMPORTANCE } from "../../src/events/schema.js";
import {
  createEffects,
  BANNERS,
  EFFECT_MS,
  ALERT_TIERS,
  MAX_QUEUED_ALERTS,
  alertTier,
} from "../../src/game/effects.js";
import { SOUNDS, createSound } from "../../src/game/sound.js";

test("big moments show a banner that fades away", () => {
  const fx = createEffects();
  fx.react(createGameEvent("kill"));
  assert.equal(fx.banner, null, "no banner for minor events");
  fx.react(createGameEvent("close_call", { wave: 2, hp: 1, maxHp: 5 }));
  assert.equal(fx.banner.text, "CLOSE CALL!");
  fx.react(createGameEvent("streak", { kills: 20 }));
  assert.equal(fx.banner.text, "20 KILL STREAK!", "the newest moment wins");
  fx.update(EFFECT_MS.banner);
  assert.equal(fx.banner, null);
});

test("a hit shakes the screen for a moment", () => {
  const fx = createEffects();
  assert.deepEqual(fx.shake(), { x: 0, y: 0 });
  fx.react(createGameEvent("damage_taken", { hp: 4, maxHp: 5 }));
  const { x, y } = fx.shake();
  assert.ok(Math.abs(x) <= 7 && Math.abs(y) <= 7);
  fx.update(EFFECT_MS.shake);
  assert.deepEqual(fx.shake(), { x: 0, y: 0 });
});

test("donation alerts show one at a time, in order, each with its chime", () => {
  const shown = [];
  const fx = createEffects({ onAlert: (a) => shown.push(a.amount) });
  fx.donation({ viewer: "pixel_pal", amount: 2, message: "i love your stream" });
  fx.donation({ viewer: "cozy_carrot", amount: 7, message: "" });
  assert.equal(fx.alert, null, "appears on the next update");
  fx.update(16);
  assert.equal(fx.alert.viewer, "pixel_pal");
  assert.equal(fx.alert.message, "i love your stream");
  assert.equal(fx.queued, 1, "the second waits its turn");
  assert.deepEqual(shown, [2]);

  fx.update(alertTier(2).ms); // the first ends
  assert.equal(fx.alert, null);
  fx.update(EFFECT_MS.alertGap); // a short pause, then the next
  assert.equal(fx.alert.viewer, "cozy_carrot");
  assert.deepEqual(shown, [2, 7]);
  fx.update(alertTier(7).ms);
  assert.equal(fx.alert, null);
  assert.equal(fx.queued, 0);
});

test("bigger donations get a bigger, longer alert; $20+ gets confetti", () => {
  assert.equal(alertTier(1), ALERT_TIERS.at(-1));
  assert.ok(alertTier(5).ms > alertTier(4).ms);
  assert.ok(alertTier(20).ms > alertTier(19).ms);
  assert.ok(alertTier(100).confetti && !alertTier(19).confetti);
  const fx = createEffects();
  fx.donation({ viewer: "big_fan", amount: 50, message: "" });
  fx.update(16);
  assert.ok(fx.alert.confetti.length > 0);
});

test("a burst of donations keeps the newest few waiting, never the one on screen", () => {
  const fx = createEffects();
  for (let amount = 1; amount <= 8; amount++) fx.donation({ viewer: "v", amount });
  fx.update(16);
  assert.equal(fx.alert.amount, 5, "1-4 were dropped from the queue before it showed");
  assert.equal(fx.queued, MAX_QUEUED_ALERTS - 1);
});

test("every major event has a sound, and banners only use catalog events", () => {
  for (const [name, { importance }] of Object.entries(GAME_EVENTS)) {
    if (importance === IMPORTANCE.MAJOR) assert.ok(SOUNDS[name], name);
  }
  for (const name of Object.keys(BANNERS)) assert.ok(GAME_EVENTS[name], name);
});

test("mute is remembered, and sound stays quiet without Web Audio or storage", () => {
  const store = new Map();
  const win = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  };
  const sound = createSound(win);
  assert.equal(sound.muted, false);
  sound.play("win"); // no AudioContext: silently does nothing
  assert.equal(sound.toggleMute(), true);
  assert.equal(createSound(win).muted, true, "a reload keeps it muted");

  const locked = {
    localStorage: {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
  };
  assert.equal(createSound(locked).toggleMute(), true);
});
