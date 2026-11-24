/**
 * sound.js
 *
 * Short sound effects for stream moments, synthesized with Web Audio: no audio files.
 * Driven by bus events and donations like effects.js. Browsers only allow sound after
 * the player has clicked or pressed a key, so the first sounds of a page can be silent.
 */

/** Notes per sound: [Hz, ms, wave, volume?] played one after another; volume scales VOLUME. */
export const SOUNDS = Object.freeze({
  round_start: [
    [330, 70, "square"],
    [660, 90, "square"],
  ],
  // Up to a few shots a second, so short and quiet.
  shot: [[520, 35, "triangle", 0.5]],
  kill: [[880, 45, "square"]],
  damage_taken: [[140, 160, "sawtooth"]],
  item_pickup: [
    [988, 60, "square"],
    [1319, 110, "square"],
  ],
  coin_purchase: [
    [988, 60, "square"],
    [1319, 60, "square"],
    [1568, 120, "square"],
  ],
  win: [
    [523, 80, "triangle"],
    [659, 80, "triangle"],
    [784, 80, "triangle"],
    [1047, 180, "triangle"],
  ],
  new_best: [
    [784, 80, "triangle"],
    [1047, 80, "triangle"],
    [1319, 80, "triangle"],
    [1568, 220, "triangle"],
  ],
  close_call: [
    [440, 90, "triangle"],
    [659, 200, "triangle"],
  ],
  streak: [
    [880, 60, "square"],
    [1175, 120, "square"],
  ],
  loss: [
    [392, 160, "triangle"],
    [330, 160, "triangle"],
    [196, 360, "triangle"],
  ],
  key_found: [
    [1319, 70, "sine"],
    [1760, 160, "sine"],
  ],
  monster_near: [
    [62, 600, "sawtooth"],
    [58, 700, "sawtooth"],
  ],
  escaped: [
    [523, 90, "triangle"],
    [784, 90, "triangle"],
    [1047, 260, "triangle"],
  ],
  caught: [
    [880, 120, "sawtooth"],
    [110, 700, "sawtooth"],
  ],
  donation: [
    [1047, 120, "sine"],
    [1568, 280, "sine"],
  ],
});

const VOLUME = 0.06;
const MUTE_KEY = "witc-muted";

export function createSound(win = globalThis.window) {
  let ctx = null;
  let muted = false;
  try {
    muted = win.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    // Storage can be blocked; sound just starts on.
  }

  // Created on the first sound, then resumed on the next click or key if the browser held it.
  function audio() {
    ctx ??= new win.AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  return {
    /** @param {string} name - Key of SOUNDS; anything else is silent. */
    play(name) {
      if (muted || !Object.hasOwn(SOUNDS, name) || !win.AudioContext) return;
      const ac = audio();
      let at = ac.currentTime;
      for (const [hz, ms, type, volume = 1] of SOUNDS[name]) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(VOLUME * volume, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
        osc.connect(gain).connect(ac.destination);
        osc.start(at);
        osc.stop(at + ms / 1000);
        at += (ms * 0.8) / 1000; // notes overlap a little
      }
    },

    /** Lets the browser start audio; call from a click or key handler. */
    unlock() {
      if (!muted && win.AudioContext) audio();
    },

    toggleMute() {
      muted = !muted;
      try {
        win.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      } catch {
        // Not saved; the setting lasts until the page reloads.
      }
      return muted;
    },

    get muted() {
      return muted;
    },
  };
}
