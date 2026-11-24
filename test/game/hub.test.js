import { test } from "node:test";
import assert from "node:assert/strict";
import { createHub, isPlayable, PAUSE_OPTIONS } from "../../src/game/hub.js";
import {
  hubHit,
  hubLayout,
  offlineHit,
  offlineLayout,
  pauseLayout,
} from "../../src/game/hubView.js";
import { GAMES } from "../../src/game/games.js";
import { waveSurvival } from "../../src/game/shooter/index.js";

/** A stand-in game that records what the hub asks of it. */
function fakeGame(id) {
  const calls = [];
  return {
    calls,
    module: {
      id,
      title: id,
      blurb: "",
      controls: [],
      bindings: {},
      create: () => ({
        update: () => calls.push("update"),
        back() {
          if (!calls.includes("store")) return false;
          calls.push("closed store");
          return true;
        },
        restart: () => calls.push("restart"),
        quit: () => calls.push("quit"),
        takeEvents: () => [],
      }),
    },
  };
}

const soon = { id: "soon", title: "Soon", blurb: "", comingSoon: true };

test("the hub plays the selected game, once chat is ready", () => {
  const a = fakeGame("a");
  const made = [];
  const hub = createHub({
    games: [soon, a.module],
    makeGame: (g) => (made.push(g.id), g.create()),
  });
  assert.equal(hub.screen, "hub");
  assert.equal(hub.selected, 1, "starts on the first playable game");

  assert.equal(hub.confirm({ canPlay: false }), false, "chat not ready");
  assert.equal(hub.screen, "hub");
  hub.move(1); // wraps to the coming-soon card
  assert.equal(hub.selected, 0);
  assert.equal(hub.confirm({ canPlay: true }), false, "coming soon can't be played");
  hub.move(-1);
  assert.equal(hub.confirm({ canPlay: true }), true);
  assert.equal(hub.screen, "playing");
  assert.equal(hub.current.game.id, "a");
  assert.deepEqual(made, ["a"]);
});

test("pause menu: resume, restart and quit; one instance per game is kept", () => {
  const a = fakeGame("a");
  const hub = createHub({ games: [a.module], makeGame: (g) => g.create() });
  hub.confirm({ canPlay: true });
  const first = hub.current.instance;

  assert.equal(hub.back(), true);
  assert.equal(hub.screen, "paused");
  assert.equal(hub.back(), true, "Escape again resumes");
  assert.equal(hub.screen, "playing");

  hub.pause();
  hub.move(1);
  assert.equal(PAUSE_OPTIONS[hub.pauseIndex].id, "restart");
  hub.confirm({ canPlay: true });
  assert.equal(hub.screen, "playing");
  assert.deepEqual(a.calls, ["restart"]);

  hub.pause();
  hub.move(-1); // wraps to quit
  assert.equal(PAUSE_OPTIONS[hub.pauseIndex].id, "quit");
  hub.confirm({ canPlay: true });
  assert.equal(hub.screen, "hub");
  assert.equal(hub.current, null);
  assert.deepEqual(a.calls, ["restart", "quit"]);

  hub.confirm({ canPlay: true });
  assert.equal(hub.current.instance, first, "the same instance comes back");
  assert.equal(hub.pause(), true);
  assert.equal(hub.pause(), false, "already paused");
});

test("quit drops the run from playing or paused (ending the stream)", () => {
  const a = fakeGame("a");
  const hub = createHub({ games: [a.module], makeGame: (g) => g.create() });
  assert.equal(hub.quit(), false, "nothing to quit on the hub");
  hub.confirm({ canPlay: true });
  assert.equal(hub.quit(), true);
  assert.equal(hub.screen, "hub");
  assert.equal(hub.current, null);
  hub.confirm({ canPlay: true });
  hub.pause();
  assert.equal(hub.quit(), true);
  assert.equal(hub.screen, "hub");
  assert.deepEqual(a.calls, ["quit", "quit"]);
});

test("the offline screen's Go live button is clickable", () => {
  const world = { width: 960, height: 540 };
  const r = offlineLayout(world);
  assert.equal(offlineHit(world, r.x + r.width / 2, r.y + r.height / 2), true);
  assert.equal(offlineHit(world, 10, 10), false);
});

test("Escape lets the game close its own screen before pausing", () => {
  const a = fakeGame("a");
  const hub = createHub({ games: [a.module], makeGame: (g) => g.create() });
  hub.confirm({ canPlay: true });
  a.calls.push("store");
  hub.back();
  assert.equal(hub.screen, "playing");
  assert.ok(a.calls.includes("closed store"));
});

test("the hub needs a playable game; the real list has one", () => {
  assert.throws(() => createHub({ games: [soon], makeGame: () => ({}) }));
  assert.ok(GAMES.some(isPlayable));
  assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
  for (const game of GAMES.filter(isPlayable)) {
    assert.ok(game.title && game.blurb && game.controls.length > 0, game.id);
  }
});

test("clicks hit hub cards and pause buttons", () => {
  const games = [...GAMES, soon];
  const hub = createHub({ games, makeGame: () => ({ quit() {}, restart() {} }) });
  const centre = (r) => [r.x + r.width / 2, r.y + r.height / 2];
  assert.equal(hubHit(hub, ...centre(hubLayout(games.length)[1])), 1);
  assert.equal(hubHit(hub, 5, 5), -1);
  hub.confirm({ canPlay: true });
  assert.equal(hubHit(hub, 5, 5), -1, "nothing to click while playing");
  hub.pause();
  assert.equal(hubHit(hub, ...centre(pauseLayout()[2])), 2);
});

test("Wave Survival module: coin packs spend the stream's donations only once", () => {
  let donations = 60;
  const instance = waveSurvival.create({
    world: { width: 960, height: 540 },
    stream: { donations: () => donations },
  });
  const keys = new Set();
  const input = { wasPressed: (a) => keys.has(a), isDown: () => false };
  const mouse = { pointer: null, down: false };
  const step = (...pressed) => {
    keys.clear();
    pressed.forEach((k) => keys.add(k));
    instance.update(16, { input, mouse });
  };

  assert.equal(instance.chatScene(), undefined, "title screen: just playing");
  step("action");
  assert.equal(instance.state.phase, "wave");
  assert.equal(instance.chatScene(), undefined);
  instance.state.spawn.spawned = instance.state.spawn.config.count; // clear wave 1
  step();
  assert.equal(instance.state.phase, "shop");
  assert.equal(instance.chatScene(), "shop", "chat hears the player from the shop");
  instance.takeEvents();

  step("store");
  assert.equal(instance.state.storeOpen, true);
  step("key2", "key3"); // bag ($25), then chest ($50): $35 is left, so the chest is refused
  const events = instance.takeEvents();
  assert.deepEqual(
    events.map((e) => [e.name, e.data.dollars]),
    [["coin_purchase", 25]],
  );
  donations -= 25; // what the stats do with that event

  assert.equal(instance.back(), true, "Escape closes the store first");
  assert.equal(instance.state.storeOpen, false);
  assert.equal(instance.back(), false);

  instance.restart();
  assert.equal(instance.state.phase, "wave");
  assert.deepEqual(instance.takeEvents(), [{ name: "round_start", data: { wave: 1 } }]);
  instance.quit();
  assert.equal(instance.state.phase, "ready");
});

test("a game's setting is an extra pause row: ← → change it, the other games don't get it", () => {
  let level = 5;
  const tuned = fakeGame("tuned");
  tuned.module.setting = {
    label: "Mouse sensitivity",
    value: () => level,
    change: (delta) => (level += delta),
  };
  const plain = fakeGame("plain");
  const hub = createHub({ games: [tuned.module, plain.module], makeGame: (g) => g.create() });

  hub.confirm({ canPlay: true });
  hub.pause();
  assert.equal(hub.pauseOptions.length, PAUSE_OPTIONS.length + 1);
  assert.equal(hub.adjust(1), false); // "Resume" is selected
  hub.move(-1); // wraps to the setting row
  assert.equal(hub.pauseOptions[hub.pauseIndex].id, "setting");
  assert.equal(hub.adjust(1), true);
  assert.equal(hub.adjust(-1), true);
  hub.adjust(-1);
  assert.equal(level, 4);
  hub.confirm({ canPlay: true }); // Space on the row raises it, and stays paused
  assert.equal(level, 5);
  assert.equal(hub.screen, "paused");
  assert.equal(pauseLayout(hub.pauseOptions.length).length, 4);

  hub.back();
  hub.quit();
  hub.move(1);
  hub.confirm({ canPlay: true });
  hub.pause();
  assert.deepEqual(hub.pauseOptions, PAUSE_OPTIONS);
});
