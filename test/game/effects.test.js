import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameEvent, GAME_EVENTS, IMPORTANCE } from "../../src/events/schema.js";
import { createEffects, BANNERS, EFFECT_MS } from "../../src/game/effects.js";
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

test("donation alerts stack up to two and expire", () => {
  const fx = createEffects();
  for (const amount of [1, 2, 3]) fx.donation({ viewer: "pixel_pal", amount });
  assert.deepEqual(
    fx.alerts.map((a) => a.amount),
    [2, 3],
  );
  fx.update(EFFECT_MS.alert);
  assert.equal(fx.alerts.length, 0);
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
