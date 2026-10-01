/**
 * input.js
 *
 * Keyboard input mapped to game actions. Game code asks about actions ("left",
 * "action"), never raw keys, so bindings can change without touching the game.
 *
 * - isDown(action): held right now.
 * - wasPressed(action): went down since the last endFrame(). Call endFrame() at the
 *   end of every game update, so a press is seen by exactly one update even when a
 *   frame runs zero or several updates.
 * - Keys typed into a text field (the chat box) are ignored, so typing to chat
 *   doesn't move the player.
 */

export const DEFAULT_BINDINGS = Object.freeze({
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "action",
});

/**
 * @param {{addEventListener: Function, removeEventListener: Function}} target - Usually `window`.
 * @param {Record<string, string>} [bindings] - KeyboardEvent.code -> action.
 */
export function createInput(target, bindings = DEFAULT_BINDINGS) {
  /** Codes currently held, so two keys bound to one action don't release each other. */
  const heldCodes = new Set();
  const pressed = new Set();

  const actionOf = (code) => (Object.hasOwn(bindings, code) ? bindings[code] : null);

  function onKeyDown(event) {
    const action = actionOf(event.code);
    if (!action || isTypingTarget(event.target)) return;
    event.preventDefault?.(); // arrows and Space would otherwise scroll the page
    if (event.repeat || heldCodes.has(event.code)) return;
    if (!isActionHeld(action)) pressed.add(action);
    heldCodes.add(event.code);
  }

  // Release even when focus is in a text field, or a held key would get stuck.
  function onKeyUp(event) {
    heldCodes.delete(event.code);
  }

  function onBlur() {
    heldCodes.clear();
    pressed.clear();
  }

  function isActionHeld(action) {
    for (const code of heldCodes) if (bindings[code] === action) return true;
    return false;
  }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    isDown: isActionHeld,
    wasPressed: (action) => pressed.has(action),
    endFrame() {
      pressed.clear();
    },
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
      onBlur();
    },
  };
}

function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}
