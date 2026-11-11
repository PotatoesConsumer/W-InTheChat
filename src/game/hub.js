/**
 * hub.js
 *
 * The game hub: the stream can run more than one mini-game. The hub is the menu that
 * picks one, and the pause menu while it runs. Plain state with no DOM (tested in
 * Node); hubView.js draws it and main.js feeds it input.
 *
 * Screens: hub -> playing <-> paused -> (quit) hub.
 *
 * A game is a module registered in games.js:
 *
 *   {
 *     id, title, blurb,
 *     controls: [[keys, what], ...],      // shown in the hub and the pause menu
 *     bindings: {KeyboardEvent.code: action},  // its own keymap (input.js)
 *     drawThumbnail?(ctx, rect, clock),    // the hub card's picture
 *     create({world, obstacles, random, stream}) -> instance
 *   }
 *
 * An instance:
 *
 *   update(dt, {input, mouse})   one fixed step; reads its own input
 *   pointerDown(point)           a click, in world coordinates
 *   back()                       Escape: close something of its own (true) or let the
 *                                hub pause (false)
 *   render(ctx, {alpha, pointer, clock})
 *   takeEvents()                 catalog events since the last call: [{name, data}]
 *   restart()                    drop the run and start a new one (pause menu)
 *   quit()                       drop the run, back to its title screen (pause menu)
 *   chatScene?()                 "shop" while between rounds in a shop, else nothing:
 *                                chat events then say where the player is (SCENES)
 *   state                        for the console (witc.game())
 *
 * `world` is the scene size ({width, height}); `obstacles` are optional solid rectangles (none
 * now). `stream` gives a game read-only stream numbers (`donations()`); games never change
 * the stats themselves, they send events. Entries with `comingSoon: true` are shown in
 * the hub but can't be played.
 */

export const PAUSE_OPTIONS = Object.freeze([
  { id: "resume", label: "Resume" },
  { id: "restart", label: "Restart run" },
  { id: "quit", label: "Quit to game hub" },
]);

/**
 * @param {object} opts
 * @param {object[]} opts.games - Game modules (and comingSoon entries), in hub order.
 * @param {(game: object) => object} opts.makeGame - Creates an instance of a module. Each
 *   module gets one instance, kept between visits (so a best score survives quitting).
 */
export function createHub({ games, makeGame }) {
  if (!games.some(isPlayable)) throw new Error("the hub needs at least one playable game");
  let screen = "hub";
  let selected = games.findIndex(isPlayable);
  let pauseIndex = 0;
  let current = null;
  const instances = new Map();

  function play(index) {
    const game = games[index];
    if (!isPlayable(game)) return false;
    if (!instances.has(game.id)) instances.set(game.id, makeGame(game));
    current = { game, instance: instances.get(game.id) };
    screen = "playing";
    return true;
  }

  function pause() {
    if (screen !== "playing") return false;
    screen = "paused";
    pauseIndex = 0;
    return true;
  }

  function choosePause(id) {
    if (screen !== "paused") return false;
    if (id === "resume") screen = "playing";
    else if (id === "restart") {
      current.instance.restart();
      screen = "playing";
    } else if (id === "quit") {
      current.instance.quit();
      current = null;
      screen = "hub";
    } else return false;
    return true;
  }

  return {
    get screen() {
      return screen;
    },
    get selected() {
      return selected;
    },
    get pauseIndex() {
      return pauseIndex;
    },
    get games() {
      return games;
    },
    /** {game, instance} while playing or paused, else null. */
    get current() {
      return current;
    },

    /** Moves the hub selection (left/right) or the pause menu's (up/down), wrapping. */
    move(delta) {
      if (screen === "hub") selected = wrap(selected + delta, games.length);
      else if (screen === "paused") pauseIndex = wrap(pauseIndex + delta, PAUSE_OPTIONS.length);
    },

    /** Points the selection at an index (mouse hover). */
    point(index) {
      if (screen === "hub" && index >= 0 && index < games.length) selected = index;
      else if (screen === "paused" && index >= 0 && index < PAUSE_OPTIONS.length)
        pauseIndex = index;
    },

    /**
     * Space / click: plays the selected game, or runs the selected pause option.
     * @param {{canPlay: boolean}} opts - false while chat isn't ready.
     * @returns {boolean} whether anything happened
     */
    confirm({ canPlay }) {
      if (screen === "hub") return canPlay && play(selected);
      if (screen === "paused") return choosePause(PAUSE_OPTIONS[pauseIndex].id);
      return false;
    },

    /** Escape: the game's own back first (e.g. close its store), else pause; resumes if paused. */
    back() {
      if (screen === "paused") return choosePause("resume");
      if (screen === "playing" && current.instance.back?.()) return true;
      return pause();
    },

    pause,
    resume: () => choosePause("resume"),

    /** Drops the current run and goes back to the hub (ending the stream). */
    quit() {
      if (!current) return false;
      current.instance.quit();
      current = null;
      screen = "hub";
      return true;
    },
  };
}

export function isPlayable(game) {
  return !game.comingSoon && typeof game.create === "function";
}

function wrap(i, n) {
  return ((i % n) + n) % n;
}
