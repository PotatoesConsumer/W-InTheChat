import { test } from "node:test";
import assert from "node:assert/strict";
import { createInput } from "../../src/game/input.js";

/** Stands in for `window`: records listeners and fires plain event objects at them. */
function fakeTarget() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => listeners.get(type) === fn && listeners.delete(type),
    fire(type, props = {}) {
      const event = {
        defaultPrevented: false,
        preventDefault: () => (event.defaultPrevented = true),
        ...props,
      };
      listeners.get(type)?.(event);
      return event;
    },
    get count() {
      return listeners.size;
    },
  };
}

test("maps keys to actions and tracks held state", () => {
  const win = fakeTarget();
  const input = createInput(win);

  win.fire("keydown", { code: "KeyA" });
  assert.equal(input.isDown("left"), true);
  assert.equal(input.isDown("right"), false);

  win.fire("keyup", { code: "KeyA" });
  assert.equal(input.isDown("left"), false);
});

test("wasPressed is true until endFrame, and not again for key repeat", () => {
  const win = fakeTarget();
  const input = createInput(win);

  win.fire("keydown", { code: "Space" });
  assert.equal(input.wasPressed("action"), true);
  input.endFrame();
  assert.equal(input.wasPressed("action"), false);

  win.fire("keydown", { code: "Space", repeat: true });
  assert.equal(input.wasPressed("action"), false);
  assert.equal(input.isDown("action"), true);
});

test("two keys on one action: releasing one keeps the action held", () => {
  const win = fakeTarget();
  const input = createInput(win);

  win.fire("keydown", { code: "ArrowLeft" });
  input.endFrame();
  win.fire("keydown", { code: "KeyA" });
  assert.equal(input.wasPressed("left"), false, "already held, so not a new press");

  win.fire("keyup", { code: "ArrowLeft" });
  assert.equal(input.isDown("left"), true);
});

test("prevents page scroll for bound keys only", () => {
  const win = fakeTarget();
  createInput(win);
  assert.equal(win.fire("keydown", { code: "Space" }).defaultPrevented, true);
  assert.equal(win.fire("keydown", { code: "KeyQ" }).defaultPrevented, false);
});

test("ignores keys typed into the chat box, but still releases on keyup", () => {
  const win = fakeTarget();
  const input = createInput(win);
  const chatBox = { tagName: "INPUT" };

  const typed = win.fire("keydown", { code: "KeyW", target: chatBox });
  assert.equal(input.isDown("up"), false);
  assert.equal(typed.defaultPrevented, false, "the letter must still reach the input");

  win.fire("keydown", { code: "KeyD" });
  win.fire("keyup", { code: "KeyD", target: chatBox });
  assert.equal(input.isDown("right"), false);
});

test("blur releases everything; destroy removes listeners", () => {
  const win = fakeTarget();
  const input = createInput(win);

  win.fire("keydown", { code: "KeyS" });
  win.fire("blur");
  assert.equal(input.isDown("down"), false);
  assert.equal(input.wasPressed("down"), false);

  input.destroy();
  assert.equal(win.count, 0);
});

test("custom bindings", () => {
  const win = fakeTarget();
  const input = createInput(win, { KeyJ: "jump" });
  win.fire("keydown", { code: "KeyJ" });
  assert.equal(input.isDown("jump"), true);
  win.fire("keydown", { code: "Space" });
  assert.equal(input.isDown("action"), false);
});
