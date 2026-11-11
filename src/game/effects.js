/**
 * effects.js
 *
 * Stream reaction effects over whatever game is running: a banner on big moments, a
 * screen shake when the player is hit, and a donation alert by the facecam, like a real
 * stream overlay. Driven by bus events and donations, so it works for every hub game.
 * Plain state (tested in Node); draw() is the only part that touches the canvas.
 */

/** Banner per major event. */
// shortcut: the texts fit Wave Survival; move them into the game module when a second game lands.
export const BANNERS = Object.freeze({
  win: Object.freeze({ text: "WAVE CLEARED!", color: "#7ee08a" }),
  close_call: Object.freeze({ text: "CLOSE CALL!", color: "#ff9f43" }),
  new_best: Object.freeze({ text: "NEW BEST!", color: "#ffd34e" }),
  streak: Object.freeze({ text: "KILL STREAK!", color: "#ff6fae" }),
});

export const EFFECT_MS = Object.freeze({ banner: 1400, shake: 300, alert: 3500 });
const SHAKE_PX = 7;

export function createEffects() {
  let banner = null; // {text, color, ms}
  let shakeMs = 0;
  const alerts = []; // {viewer, amount, ms}, oldest first

  return {
    /** @param {Readonly<object>} event - A valid bus event. */
    react(event) {
      if (event.kind !== "game") return;
      if (Object.hasOwn(BANNERS, event.name)) {
        const { text, color } = BANNERS[event.name];
        const kills = event.name === "streak" ? event.data?.kills : null;
        banner = { text: kills ? `${kills} KILL STREAK!` : text, color, ms: EFFECT_MS.banner };
      }
      if (event.name === "damage_taken") shakeMs = EFFECT_MS.shake;
    },

    /** @param {{viewer: string, amount: number}} gift - From donations.js. */
    donation({ viewer, amount }) {
      alerts.push({ viewer, amount, ms: EFFECT_MS.alert });
      if (alerts.length > 2) alerts.shift(); // a burst shows the newest two
    },

    /** @param {number} dt - ms */
    update(dt) {
      shakeMs = Math.max(0, shakeMs - dt);
      if (banner && (banner.ms -= dt) <= 0) banner = null;
      for (const a of alerts) a.ms -= dt;
      while (alerts.length && alerts[0].ms <= 0) alerts.shift();
    },

    /** Offset to draw the game at this frame: {x, y}, zero when not shaking. */
    shake() {
      if (shakeMs === 0) return { x: 0, y: 0 };
      const size = (SHAKE_PX * shakeMs) / EFFECT_MS.shake;
      return { x: (Math.random() * 2 - 1) * size, y: (Math.random() * 2 - 1) * size };
    },

    get banner() {
      return banner;
    },
    get alerts() {
      return alerts;
    },

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {{world: {width: number, height: number}, alertAt: {x: number, y: number, width: number}}} opts
     *   alertAt: where donation alerts stack up from (above the facecam).
     */
    draw(ctx, { world, alertAt }) {
      if (banner) drawBanner(ctx, banner, world);
      alerts.forEach((a, i) => drawAlert(ctx, a, alertAt, alerts.length - 1 - i));
    },
  };
}

function drawBanner(ctx, { text, color, ms }, world) {
  const t = 1 - ms / EFFECT_MS.banner; // 0 -> 1
  const pop = t < 0.15 ? 0.6 + (0.4 * t) / 0.15 : 1; // quick scale-in
  ctx.save();
  ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1; // fade out at the end
  ctx.translate(world.width / 2, world.height / 2 - 20);
  ctx.scale(pop, pop);
  ctx.font = "800 54px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(20, 14, 10, 0.85)";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawAlert(ctx, { viewer, amount, ms }, at, slot) {
  const age = EFFECT_MS.alert - ms;
  const slide = Math.min(1, age / 250); // slides up into place
  const y = at.y - 52 * (slot + 1) + (1 - slide) * 20;
  ctx.save();
  ctx.globalAlpha = Math.min(1, ms / 400) * slide;
  ctx.fillStyle = "rgba(43, 30, 10, 0.92)";
  ctx.beginPath();
  ctx.roundRect(at.x, y, at.width, 44, 8);
  ctx.fill();
  ctx.strokeStyle = "#ffd34e";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = "800 15px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ffd34e";
  ctx.fillText(`$${amount} donation!`, at.x + 12, y + 19);
  ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#fff8e7";
  ctx.fillText(`from ${viewer}`, at.x + 12, y + 36, at.width - 24);
  ctx.restore();
}
