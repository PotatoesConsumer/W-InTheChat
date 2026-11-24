/**
 * index.js
 *
 * Wave Survival as a hub game module (interface in src/game/hub.js): its keymap, how
 * keys and the mouse drive game.js, and drawing through view.js.
 */

import { createShooter } from "./game.js";
import { drawShooter, drawThumbnail, shopHit, HUD_HEIGHT } from "./view.js";
import { SHOP_ITEMS, COIN_PACKS, coinPack } from "./shop.js";

const BINDINGS = Object.freeze({
  KeyW: "up",
  KeyA: "left",
  KeyS: "down",
  KeyD: "right",
  ArrowUp: "shootUp",
  ArrowLeft: "shootLeft",
  ArrowDown: "shootDown",
  ArrowRight: "shootRight",
  Space: "action",
  KeyC: "store",
  ...Object.fromEntries(SHOP_ITEMS.map((_, i) => [`Digit${i + 1}`, `key${i + 1}`])),
});

export const waveSurvival = Object.freeze({
  id: "wave-survival",
  title: "Wave Survival",
  blurb: "Top-down shooter. Survive waves that keep getting harder and shop between them.",
  controls: Object.freeze([
    ["WASD", "move"],
    ["Arrows / hold mouse", "shoot"],
    ["Space", "start, next wave"],
    ["1-6 / click", "buy in the shop"],
    ["C", "coin store (spend donations)"],
  ]),
  bindings: BINDINGS,
  drawThumbnail,

  /**
   * @param {object} opts
   * @param {{width: number, height: number}} opts.world - The scene; the arena is below the HUD.
   * @param {object[]} [opts.obstacles]
   * @param {() => number} [opts.random]
   * @param {{donations: () => number}} opts.stream
   */
  create({ world, obstacles = [], random, stream, perks = {} }) {
    const arena = { x: 0, y: HUD_HEIGHT, width: world.width, height: world.height - HUD_HEIGHT };
    const game = createShooter({ arena, obstacles, random, ghost: () => perks.ghost?.() ?? false });
    // Dollars spent on coin packs whose events haven't reached the stats yet, so two
    // buys before the next takeEvents() can't spend the same dollars.
    let unsettled = 0;

    function act(action) {
      const s = game.state;
      if (action.kind === "item") game.buy(action.id);
      else if (action.kind === "pack") {
        const result = game.buyCoins(action.id, stream.donations() - unsettled);
        if (result.ok) unsettled += coinPack(action.id).dollars;
      } else if (action.kind === "openStore") game.toggleStore(true);
      else if (action.kind === "closeStore") game.toggleStore(false);
      else if (action.kind === "next" && !s.storeOpen) game.nextWave();
    }

    return {
      get state() {
        return game.state;
      },

      update(dt, { input, mouse }) {
        const s = game.state;
        if ((s.phase === "ready" || s.phase === "over") && input.wasPressed("action")) {
          game.start();
        } else if (s.phase === "shop") {
          if (input.wasPressed("action")) act({ kind: "next" });
          if (input.wasPressed("store")) game.toggleStore();
          const list = s.storeOpen ? COIN_PACKS : SHOP_ITEMS;
          list.forEach((entry, i) => {
            if (input.wasPressed(`key${i + 1}`)) {
              act({ kind: s.storeOpen ? "pack" : "item", id: entry.id });
            }
          });
        }

        // Arrow keys shoot in 8 directions; otherwise holding the mouse shoots at the cursor.
        const axis = (minus, plus) => (input.isDown(plus) ? 1 : 0) - (input.isDown(minus) ? 1 : 0);
        let aimX = axis("shootLeft", "shootRight");
        let aimY = axis("shootUp", "shootDown");
        let fire = aimX !== 0 || aimY !== 0;
        if (!fire && mouse.pointer) {
          aimX = mouse.pointer.x - s.player.x;
          aimY = mouse.pointer.y - s.player.y;
          fire = mouse.down;
        }
        game.update(dt, {
          moveX: axis("left", "right"),
          moveY: axis("up", "down"),
          aimX,
          aimY,
          fire,
        });
      },

      pointerDown(point) {
        const s = game.state;
        if (s.phase === "shop") {
          const hit = shopHit(point.x, point.y, s.storeOpen);
          if (hit) act(hit);
        } else if (s.phase === "ready" || s.phase === "over") {
          game.start();
        }
      },

      back() {
        if (game.state.storeOpen) return game.toggleStore(false);
        return false;
      },

      render(ctx, { alpha, pointer, clock }) {
        drawShooter(ctx, game, {
          arena,
          alpha,
          donations: stream.donations() - unsettled,
          pointer,
          startHint: "Press Space or click to start",
          clock,
        });
      },

      takeEvents() {
        unsettled = 0;
        return game.takeEvents();
      },

      restart() {
        game.abandon();
        game.start();
      },

      quit() {
        game.abandon();
      },

      /** Between waves the player is in the shop, not fighting. */
      chatScene() {
        return game.state.phase === "shop" ? "shop" : undefined;
      },
    };
  },
});
