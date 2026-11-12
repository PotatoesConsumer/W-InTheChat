/**
 * effects.js
 *
 * Stream reaction effects over whatever game is running: a banner on big moments, a
 * screen shake when the player is hit, and Twitch-style donation alerts, like a real
 * stream overlay. Driven by bus events and donations, so it works for every hub game.
 * Plain state (tested in Node); draw() is the only part that touches the canvas.
 *
 * Donation alerts work like a stream's alert box: one at a time at the top of the screen,
 * the rest wait their turn. Each shows the donor, the amount and their message; bigger
 * donations get a bigger, longer alert in another colour, and $20 or more gets confetti.
 */

/** Banner per major event. */
// shortcut: the texts fit Wave Survival; move them into the game module when a second game lands.
export const BANNERS = Object.freeze({
  win: Object.freeze({ text: "WAVE CLEARED!", color: "#7ee08a" }),
  close_call: Object.freeze({ text: "CLOSE CALL!", color: "#ff9f43" }),
  new_best: Object.freeze({ text: "NEW BEST!", color: "#ffd34e" }),
  streak: Object.freeze({ text: "KILL STREAK!", color: "#ff6fae" }),
});

export const EFFECT_MS = Object.freeze({ banner: 1400, shake: 300, alertGap: 400 });
const SHAKE_PX = 7;

/** Alert looks by amount ($, at least `min`), biggest first. */
export const ALERT_TIERS = Object.freeze([
  Object.freeze({ min: 20, color: "#c77dff", ms: 7500, size: 1.15, confetti: true }),
  Object.freeze({ min: 5, color: "#ff9f43", ms: 5500, size: 1.05, confetti: false }),
  Object.freeze({ min: 0, color: "#ffd34e", ms: 4500, size: 1, confetti: false }),
]);

/** Donations waiting for the alert box beyond this are dropped, oldest first. */
export const MAX_QUEUED_ALERTS = 4;

export const alertTier = (amount) => ALERT_TIERS.find((t) => amount >= t.min);

/**
 * @param {object} [opts]
 * @param {(alert: object) => void} [opts.onAlert] - When an alert appears (play the chime).
 */
export function createEffects({ onAlert } = {}) {
  let banner = null; // {text, color, ms}
  let shakeMs = 0;
  let alert = null; // the one on screen: {viewer, amount, message, tier, ms}
  let gapMs = 0; // pause between two alerts
  const queue = []; // donations waiting their turn, oldest first

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

    /** @param {{viewer: string, amount: number, message?: string}} gift - From donations.js. */
    donation({ viewer, amount, message = "" }) {
      queue.push({ viewer, amount, message });
      if (queue.length > MAX_QUEUED_ALERTS) queue.shift();
    },

    /** @param {number} dt - ms */
    update(dt) {
      shakeMs = Math.max(0, shakeMs - dt);
      if (banner && (banner.ms -= dt) <= 0) banner = null;
      if (alert && (alert.ms -= dt) <= 0) {
        alert = null;
        gapMs = EFFECT_MS.alertGap;
      } else if (!alert) {
        gapMs = Math.max(0, gapMs - dt);
      }
      if (!alert && gapMs === 0 && queue.length > 0) {
        const gift = queue.shift();
        const tier = alertTier(gift.amount);
        alert = { ...gift, tier, ms: tier.ms, confetti: tier.confetti ? makeConfetti() : [] };
        onAlert?.(alert);
      }
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
    /** The donation alert on screen, or null. */
    get alert() {
      return alert;
    },
    /** How many donations are waiting for the alert box. */
    get queued() {
      return queue.length;
    },

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {{world: {width: number, height: number}, top: number}} opts
     *   top: where the alert box sits (below the game's own HUD).
     */
    draw(ctx, { world, top }) {
      if (banner) drawBanner(ctx, banner, world);
      if (alert) drawAlert(ctx, alert, world, top);
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

const FONT = "Inter, 'Segoe UI Variable Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Confetti for the top tier: drawn only, never part of the game's state. */
function makeConfetti() {
  const colors = ["#ffd34e", "#ff6fae", "#7ee08a", "#6fc3ff", "#c77dff"];
  return Array.from({ length: 70 }, () => ({
    x: Math.random(),
    delay: Math.random() * 900,
    speed: 0.09 + Math.random() * 0.12,
    drift: (Math.random() * 2 - 1) * 0.03,
    spin: Math.random() * Math.PI * 2,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
}

/** The message, cut into at most two lines that fit `width`. */
function wrap(ctx, text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [""];
  for (const word of words) {
    const next = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
    if (ctx.measureText(next).width <= width || !lines.at(-1)) lines[lines.length - 1] = next;
    else if (lines.length < 2) lines.push(word);
    else {
      lines[1] = `${lines[1]}…`;
      break;
    }
  }
  return lines.filter(Boolean);
}

function drawAlert(ctx, { viewer, amount, message, tier, ms, confetti }, world, top) {
  const age = tier.ms - ms;
  const enter = Math.min(1, age / 450);
  const bounce = enter < 1 ? 1 - Math.pow(1 - enter, 3) * Math.cos(enter * Math.PI * 1.5) : 1;
  const fade = Math.min(1, ms / 500);
  const width = 470 * tier.size;
  const height = (message ? 104 : 74) * tier.size;
  const x = (world.width - width) / 2;
  const y = top - (1 - bounce) * (height + top);

  ctx.save();
  // Confetti falls over the whole game area, behind the card.
  for (const c of confetti) {
    const t = age - c.delay;
    if (t < 0) continue;
    const cy = top + t * c.speed;
    if (cy > world.height) continue;
    ctx.globalAlpha = fade;
    ctx.fillStyle = c.color;
    ctx.save();
    ctx.translate((c.x + c.drift * (t / 100)) * world.width, cy);
    ctx.rotate(c.spin + t / 150);
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }

  ctx.globalAlpha = fade;
  // See-through card, so the game stays visible behind it; the tier's colour pulses on the border.
  ctx.fillStyle = "rgba(24, 16, 34, 0.45)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 14);
  ctx.fill();
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = 10 + 6 * Math.sin(age / 180);
  ctx.strokeStyle = tier.color;
  ctx.lineWidth = 3;
  ctx.stroke();
  // A dark halo keeps the text readable over a busy game.
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 4;

  // The coin.
  const r = 22 * tier.size;
  const cx = x + 20 + r;
  const cy = y + (message ? 38 : height / 2) * (message ? tier.size : 1);
  ctx.fillStyle = tier.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r * (1 + 0.06 * Math.sin(age / 120)), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1024";
  ctx.font = `900 ${Math.round(24 * tier.size)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", cx, cy + 1);

  // "pixel_pal donated $5!", the name and amount in the tier's colour.
  const textX = cx + r + 14;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${Math.round(19 * tier.size)}px ${FONT}`;
  const parts = [
    [viewer, tier.color],
    [" donated ", "#fff8e7"],
    [`$${amount}`, tier.color],
    ["!", "#fff8e7"],
  ];
  let px = textX;
  const titleY = cy + 7 * tier.size;
  for (const [text, color] of parts) {
    ctx.fillStyle = color;
    ctx.fillText(text, px, titleY);
    px += ctx.measureText(text).width;
  }

  if (message) {
    ctx.font = `${Math.round(15 * tier.size)}px ${FONT}`;
    ctx.fillStyle = "#e9dcff";
    wrap(ctx, message, width - 40).forEach((line, i) =>
      ctx.fillText(line, x + 20, y + (72 + i * 19) * tier.size, width - 40),
    );
  }
  ctx.restore();
}
