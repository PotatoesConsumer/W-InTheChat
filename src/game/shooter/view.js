/**
 * view.js
 *
 * Draws the wave shooter (game.js) on the canvas: the grass arena, the farmer, enemies,
 * bullets, coins, the HUD strip and the title / shop / coin store / game-over screens.
 * The only logic here is the shop's layout and hit test, used for mouse clicks.
 */

import { SHOP_ITEMS, COIN_PACKS, priceOf, checkPurchase, packBonus } from "./shop.js";
import { COIN, LOW_HP_FRACTION } from "./game.js";

export const HUD_HEIGHT = 40;

const COLORS = Object.freeze({
  grass: ["#4f8a3c", "#4a8338"],
  text: "#fff8e7",
  muted: "#c9c0a8",
  panel: "rgba(43, 30, 22, 0.94)",
  panelEdge: "#d9a55b",
  card: "#5b3d27",
  cardHover: "#74502f",
  cardOff: "#3d2a1d",
  gold: "#ffd34e",
  heart: "#ff4d5e",
  heartEmpty: "#5a3a3a",
  slime: "#7bd34f",
  bat: "#9b6bd6",
  brute: "#c8553d",
  bullet: "#ffe9a3",
  store: "#2d6cdf",
  ribbon: "#e5323b",
});

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * Where the shop's and coin store's parts are, in world coordinates.
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 */
export function shopLayout() {
  const panel = { x: 40, y: 56, width: 680, height: 420 };
  const pad = 20;
  const gap = 12;
  const cardW = (panel.width - 2 * pad - 2 * gap) / 3;
  const cardH = 104;
  const cards = SHOP_ITEMS.map((item, i) => ({
    id: item.id,
    key: i + 1,
    x: panel.x + pad + (i % 3) * (cardW + gap),
    y: panel.y + 84 + Math.floor(i / 3) * (cardH + gap),
    width: cardW,
    height: cardH,
  }));
  const buttonY = panel.y + 84 + 2 * cardH + gap + 18;
  const buttonW = (panel.width - 2 * pad - gap) / 2;
  const packW = (panel.width - 2 * pad - 3 * gap) / 4;
  const packs = COIN_PACKS.map((pack, i) => ({
    id: pack.id,
    key: i + 1,
    x: panel.x + pad + i * (packW + gap),
    y: panel.y + 92,
    width: packW,
    height: 214,
  }));
  return {
    panel,
    cards,
    openStore: { x: panel.x + pad, y: buttonY, width: buttonW, height: 44 },
    next: { x: panel.x + pad + buttonW + gap, y: buttonY, width: buttonW, height: 44 },
    packs,
    closeStore: { x: panel.x + pad, y: buttonY, width: panel.width - 2 * pad, height: 44 },
  };
}

/**
 * What a click at (x, y) hits in the shop, or in the coin store when it's open.
 * @returns {{kind: "item" | "pack", id: string} | {kind: "openStore" | "closeStore" | "next"} | null}
 */
export function shopHit(x, y, storeOpen = false) {
  const layout = shopLayout();
  if (storeOpen) {
    const pack = layout.packs.find((c) => inside(c, x, y));
    if (pack) return { kind: "pack", id: pack.id };
    if (inside(layout.closeStore, x, y)) return { kind: "closeStore" };
    return null;
  }
  const card = layout.cards.find((c) => inside(c, x, y));
  if (card) return { kind: "item", id: card.id };
  if (inside(layout.openStore, x, y)) return { kind: "openStore" };
  if (inside(layout.next, x, y)) return { kind: "next" };
  return null;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./game.js").createShooter>} game
 * @param {object} opts
 * @param {{x: number, y: number, width: number, height: number}} opts.arena
 * @param {number} opts.alpha - Interpolation between the last two updates.
 * @param {number} opts.donations - The stream's donation balance, for the coin store.
 * @param {{x: number, y: number} | null} opts.pointer - Mouse in world coordinates.
 * @param {string} opts.startHint - Shown on the title screen.
 * @param {number} opts.clock - ms, for animation.
 */
export function drawShooter(ctx, game, { arena, alpha, donations, pointer, startHint, clock }) {
  const s = game.state;
  drawGrass(ctx, arena);
  ctx.save();
  ctx.beginPath();
  ctx.rect(arena.x, arena.y, arena.width, arena.height);
  ctx.clip();
  for (const c of s.coins) drawCoin(ctx, c, clock);
  for (const b of s.bursts) drawBurst(ctx, b);
  for (const e of s.enemies) drawEnemy(ctx, e, alpha, clock);
  if (s.phase !== "ready") drawPlayer(ctx, s.player, alpha, clock);
  ctx.fillStyle = COLORS.bullet;
  for (const b of s.bullets) circle(ctx, lerp(b.prevX, b.x, alpha), lerp(b.prevY, b.y, alpha), b.r);
  ctx.restore();

  drawHud(ctx, s, arena);
  if (s.phase === "ready") drawTitle(ctx, arena, startHint);
  if (s.phase === "shop" && s.storeOpen) drawStore(ctx, s, donations, pointer, clock);
  else if (s.phase === "shop") drawShop(ctx, s, donations, pointer);
  if (s.phase === "over") drawGameOver(ctx, s, arena);
  if (pointer && s.phase === "wave") drawCrosshair(ctx, pointer);
}

// --- arena -------------------------------------------------------------------------

function drawGrass(ctx, arena) {
  const tile = 40;
  for (let y = arena.y; y < arena.y + arena.height; y += tile) {
    for (let x = arena.x; x < arena.x + arena.width; x += tile) {
      const i = Math.floor(x / tile) + Math.floor(y / tile);
      ctx.fillStyle = COLORS.grass[i % 2];
      ctx.fillRect(x, y, tile, tile);
      // A few fixed tufts and flowers, the same every frame.
      const h = hash(x, y);
      if (h % 5 === 0) {
        ctx.fillStyle = "#3d7230";
        ctx.fillRect(x + (h % 23) + 6, y + ((h >> 3) % 23) + 6, 3, 6);
        ctx.fillRect(x + (h % 23) + 10, y + ((h >> 3) % 23) + 8, 3, 4);
      } else if (h % 13 === 0) {
        ctx.fillStyle = h % 2 ? "#f7e26b" : "#f2f2f2";
        circle(ctx, x + (h % 27) + 6, y + ((h >> 4) % 27) + 6, 2.5);
      }
    }
  }
}

function drawPlayer(ctx, p, alpha, clock) {
  if (p.invulnerableMs > 0 && Math.floor(clock / 80) % 2 === 0) return;
  const x = lerp(p.prevX, p.x, alpha);
  const y = lerp(p.prevY, p.y, alpha);
  ctx.save();
  ctx.translate(x, y);
  shadow(ctx, 0, p.r - 2, p.r);
  // Blaster, pointing where the player aims.
  ctx.save();
  ctx.rotate(Math.atan2(p.aimY, p.aimX));
  ctx.fillStyle = "#3a3a46";
  ctx.fillRect(4, -3, p.r + 6, 6);
  ctx.restore();
  // Overalls, face, straw hat.
  ctx.fillStyle = "#3b6fd1";
  circle(ctx, 0, 3, p.r - 2);
  ctx.fillStyle = "#f2c6a0";
  circle(ctx, 0, -4, p.r - 6);
  ctx.fillStyle = "#e8c15a";
  ellipse(ctx, 0, -9, p.r + 2, 5);
  ctx.fillStyle = "#d4a63e";
  ellipse(ctx, 0, -12, p.r - 6, 5);
  ctx.fillStyle = "#2b2233";
  circle(ctx, -3 + p.aimX * 2, -4 + p.aimY * 2, 1.6);
  circle(ctx, 3 + p.aimX * 2, -4 + p.aimY * 2, 1.6);
  ctx.restore();
}

function drawEnemy(ctx, e, alpha, clock) {
  const x = lerp(e.prevX, e.x, alpha);
  const y = lerp(e.prevY, e.y, alpha);
  const flash = e.hitMs > 0;
  ctx.save();
  ctx.translate(x, y);
  shadow(ctx, 0, e.r - 2, e.r);
  if (e.type === "slime") {
    const squish = Math.sin(e.ageMs / 140 + e.wobble) * 0.12;
    ctx.fillStyle = flash ? "#ffffff" : COLORS.slime;
    ellipse(ctx, 0, 2, e.r * (1 + squish), e.r * (0.85 - squish));
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    circle(ctx, -e.r * 0.35, -e.r * 0.25, e.r * 0.22);
    eyes(ctx, e.r * 0.3, -1, 2.4);
  } else if (e.type === "bat") {
    const flap = Math.sin(clock / 60 + e.wobble) * 6;
    ctx.fillStyle = flash ? "#ffffff" : COLORS.bat;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(-e.r - 10, -6 - flap);
    ctx.lineTo(-e.r - 2, 4);
    ctx.moveTo(4, 0);
    ctx.lineTo(e.r + 10, -6 - flap);
    ctx.lineTo(e.r + 2, 4);
    ctx.fill();
    circle(ctx, 0, 0, e.r);
    ctx.fillStyle = "#ffd34e";
    circle(ctx, -3, -2, 1.8);
    circle(ctx, 3, -2, 1.8);
  } else {
    ctx.fillStyle = flash ? "#ffffff" : COLORS.brute;
    roundRect(ctx, -e.r, -e.r, e.r * 2, e.r * 2, 8);
    ctx.fill();
    ctx.fillStyle = "#efe2c4";
    ctx.beginPath();
    ctx.moveTo(-e.r + 4, -e.r + 2);
    ctx.lineTo(-e.r - 2, -e.r - 10);
    ctx.lineTo(-e.r + 12, -e.r + 2);
    ctx.moveTo(e.r - 4, -e.r + 2);
    ctx.lineTo(e.r + 2, -e.r - 10);
    ctx.lineTo(e.r - 12, -e.r + 2);
    ctx.fill();
    eyes(ctx, 7, -4, 3);
  }
  ctx.restore();
  if (e.hp < e.maxHp) {
    const w = e.r * 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - w / 2, y - e.r - 10, w, 4);
    ctx.fillStyle = "#ff6b6b";
    ctx.fillRect(x - w / 2, y - e.r - 10, (w * Math.max(0, e.hp)) / e.maxHp, 4);
  }
}

function drawCoin(ctx, c, clock) {
  // Blink in the last two seconds before it disappears.
  if (c.lifeMs < 2000 && Math.floor(clock / 120) % 2 === 0) return;
  const bob = Math.sin(clock / 200 + c.x) * 2;
  ctx.fillStyle = "#b8860b";
  circle(ctx, c.x, c.y + bob + 1, COIN.radius);
  ctx.fillStyle = COLORS.gold;
  circle(ctx, c.x, c.y + bob, COIN.radius - 1);
  ctx.fillStyle = "#fff3b0";
  ctx.fillRect(c.x - 1, c.y + bob - 4, 2, 8);
}

function drawBurst(ctx, b) {
  const t = b.ageMs / 400;
  ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(b.x, b.y, 8 + t * 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = COLORS[b.type] ?? "#fff";
  ctx.globalAlpha = 1 - t;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    circle(ctx, b.x + Math.cos(a) * t * 30, b.y + Math.sin(a) * t * 30, 3);
  }
  ctx.globalAlpha = 1;
}

function drawCrosshair(ctx, { x, y }) {
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.moveTo(x - 13, y);
  ctx.lineTo(x - 4, y);
  ctx.moveTo(x + 4, y);
  ctx.lineTo(x + 13, y);
  ctx.moveTo(x, y - 13);
  ctx.lineTo(x, y - 4);
  ctx.moveTo(x, y + 4);
  ctx.lineTo(x, y + 13);
  ctx.stroke();
}

// --- HUD and screens ---------------------------------------------------------------

function drawHud(ctx, s, arena) {
  ctx.fillStyle = "#2b1e16";
  ctx.fillRect(arena.x, 0, arena.width, HUD_HEIGHT);
  ctx.fillStyle = "#d9a55b";
  ctx.fillRect(arena.x, HUD_HEIGHT - 3, arena.width, 3);

  const p = s.player;
  const low = s.phase !== "ready" && p.hp <= p.maxHp * LOW_HP_FRACTION;
  for (let i = 0; i < p.maxHp; i++) {
    ctx.fillStyle = i < p.hp ? COLORS.heart : COLORS.heartEmpty;
    heart(ctx, 22 + i * 24, 19, low && i < p.hp ? 9 + Math.sin(Date.now() / 90) : 9);
  }

  text(ctx, s.phase === "ready" ? "Ready" : `Wave ${s.wave}`, arena.width / 2, 26, {
    size: 18,
    weight: 700,
    align: "center",
  });
  if (s.phase === "wave") {
    const left = s.spawn.config.count - s.spawn.spawned + s.enemies.length;
    text(ctx, `${left} left`, arena.width / 2 + 70, 26, { size: 13, color: COLORS.muted });
  }

  ctx.fillStyle = COLORS.gold;
  circle(ctx, arena.width - 120, 19, 8);
  text(ctx, String(s.run.coins), arena.width - 106, 25, { size: 16, weight: 700 });
  text(ctx, `${s.run.kills} kills`, arena.width - 60, 25, { size: 13, color: COLORS.muted });
}

function drawTitle(ctx, arena, startHint) {
  dim(ctx, arena);
  const cx = arena.x + arena.width / 2;
  text(ctx, "WAVE SURVIVAL", cx, 190, {
    size: 44,
    weight: 800,
    align: "center",
    color: COLORS.gold,
  });
  text(ctx, "Survive the waves. Spend coins in the shop between them.", cx, 232, {
    size: 16,
    align: "center",
  });
  text(ctx, "WASD move  ·  Arrow keys or hold the mouse to shoot", cx, 270, {
    size: 15,
    align: "center",
    color: COLORS.muted,
  });
  text(ctx, startHint, cx, 320, { size: 20, weight: 700, align: "center" });
  text(ctx, "Esc pauses", cx, 350, { size: 14, align: "center", color: COLORS.muted });
}

function drawGameOver(ctx, s, arena) {
  dim(ctx, arena);
  const cx = arena.x + arena.width / 2;
  text(ctx, "YOU FELL", cx, 200, { size: 44, weight: 800, align: "center", color: COLORS.heart });
  text(
    ctx,
    `Wave ${s.wave}  ·  ${s.run.kills} kills  ·  best wave cleared: ${s.bestWave}`,
    cx,
    245,
    {
      size: 17,
      align: "center",
    },
  );
  text(ctx, "Space to go again", cx, 300, { size: 20, weight: 700, align: "center" });
}

function drawShop(ctx, s, donations, pointer) {
  const layout = shopLayout();
  const { panel } = layout;
  const p = s.player;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 12);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 3;
  ctx.stroke();

  text(ctx, `Wave ${s.wave} cleared!  ·  Shop`, panel.x + 20, panel.y + 36, {
    size: 22,
    weight: 800,
    color: COLORS.gold,
  });
  text(ctx, `${s.run.coins} coins  ·  HP ${p.hp}/${p.maxHp}`, panel.x + 20, panel.y + 62, {
    size: 15,
  });
  text(ctx, "1-6 or click to buy", panel.x + panel.width - 20, panel.y + 62, {
    size: 13,
    align: "right",
    color: COLORS.muted,
  });

  const run = { ...s.run, hp: p.hp, maxHp: p.maxHp };
  for (const card of layout.cards) {
    const item = SHOP_ITEMS.find((i) => i.id === card.id);
    const level = s.run.levels[item.id] ?? 0;
    const check = checkPurchase(run, item.id);
    const soldOut = level >= item.maxLevel;
    const hover = pointer && inside(card, pointer.x, pointer.y);
    ctx.fillStyle = !check.ok ? COLORS.cardOff : hover ? COLORS.cardHover : COLORS.card;
    roundRect(ctx, card.x, card.y, card.width, card.height, 8);
    ctx.fill();
    const color = check.ok ? COLORS.text : COLORS.muted;
    text(ctx, `${card.key}  ${item.name}`, card.x + 12, card.y + 26, {
      size: 16,
      weight: 700,
      color,
    });
    text(ctx, item.text, card.x + 12, card.y + 50, { size: 13, color: COLORS.muted });
    const price = soldOut ? "SOLD OUT" : `${priceOf(item, level)} coins`;
    text(ctx, price, card.x + 12, card.y + 84, {
      size: 15,
      weight: 700,
      color: soldOut ? COLORS.muted : COLORS.gold,
    });
    if (Number.isFinite(item.maxLevel) && item.maxLevel > 1) {
      for (let i = 0; i < item.maxLevel; i++) {
        ctx.fillStyle = i < level ? COLORS.gold : "#2b1e16";
        ctx.fillRect(card.x + card.width - 14 - (item.maxLevel - i) * 11, card.y + 78, 8, 8);
      }
    }
  }

  button(ctx, layout.openStore, pointer, true, `C  Coin store  ($${donations} in donations)`);
  button(ctx, layout.next, pointer, true, `Space  Start wave ${s.wave + 1}`);

  if (s.notice) {
    text(ctx, s.notice.text, panel.x + panel.width / 2, panel.y + panel.height - 18, {
      size: 15,
      weight: 700,
      align: "center",
      color: COLORS.gold,
    });
  }
}

function drawStore(ctx, s, donations, pointer, clock) {
  const layout = shopLayout();
  const { panel } = layout;
  ctx.fillStyle = "rgba(18, 24, 48, 0.96)";
  roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 12);
  ctx.fill();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 3;
  ctx.stroke();

  text(ctx, "COIN STORE", panel.x + 20, panel.y + 38, {
    size: 24,
    weight: 800,
    color: COLORS.gold,
  });
  text(
    ctx,
    "Spend chat's donations on coins. Donations you spend are gone.",
    panel.x + 20,
    panel.y + 64,
    {
      size: 13,
      color: "#b9c4e8",
    },
  );
  text(ctx, `Donations: $${donations}`, panel.x + panel.width - 20, panel.y + 38, {
    size: 18,
    weight: 800,
    align: "right",
    color: "#7ee08a",
  });
  text(ctx, `Coins: ${s.run.coins}`, panel.x + panel.width - 20, panel.y + 64, {
    size: 14,
    weight: 700,
    align: "right",
  });

  layout.packs.forEach((card, i) => {
    const pack = COIN_PACKS[i];
    const affordable = donations >= pack.dollars;
    const hover = affordable && pointer && inside(card, pointer.x, pointer.y);
    const lift = hover ? -4 : 0;
    const y = card.y + lift;
    const gradient = ctx.createLinearGradient(0, y, 0, y + card.height);
    gradient.addColorStop(0, affordable ? "#3d5fb8" : "#2a3350");
    gradient.addColorStop(1, affordable ? "#1f2f66" : "#1a2036");
    ctx.fillStyle = gradient;
    roundRect(ctx, card.x, y, card.width, card.height, 10);
    ctx.fill();
    ctx.strokeStyle = hover ? COLORS.gold : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (pack.tag) {
      ctx.fillStyle = COLORS.ribbon;
      roundRect(ctx, card.x + 8, y - 10, card.width - 16, 22, 6);
      ctx.fill();
      text(ctx, pack.tag.toUpperCase(), card.x + card.width / 2, y + 5, {
        size: 11,
        weight: 800,
        align: "center",
      });
    }

    drawCoinPile(ctx, card.x + card.width / 2, y + 76, i + 1, clock);
    const cx = card.x + card.width / 2;
    text(ctx, `${pack.coins}`, cx, y + 126, {
      size: 26,
      weight: 800,
      align: "center",
      color: COLORS.gold,
    });
    text(ctx, pack.name, cx, y + 146, { size: 13, align: "center", color: "#dfe6ff" });
    const bonus = packBonus(pack);
    if (bonus > 0) {
      text(ctx, `+${bonus}% bonus`, cx, y + 164, {
        size: 12,
        weight: 700,
        align: "center",
        color: "#7ee08a",
      });
    }

    const price = { x: card.x + 12, y: y + card.height - 42, width: card.width - 24, height: 32 };
    ctx.fillStyle = affordable ? "#4caf50" : "#3a4258";
    roundRect(ctx, price.x, price.y, price.width, price.height, 8);
    ctx.fill();
    text(ctx, `${card.key}   $${pack.dollars}`, cx, price.y + 22, {
      size: 16,
      weight: 800,
      align: "center",
      color: affordable ? "#ffffff" : "#8a93ad",
    });
  });

  button(ctx, layout.closeStore, pointer, true, "C or Esc  Back to the shop");

  if (s.notice) {
    text(ctx, s.notice.text, panel.x + panel.width / 2, panel.y + panel.height - 18, {
      size: 15,
      weight: 700,
      align: "center",
      color: COLORS.gold,
    });
  }
}

/** A heap of coins; bigger packs get taller heaps. */
function drawCoinPile(ctx, x, y, size, clock) {
  const rows = size + 1;
  for (let row = 0; row < rows; row++) {
    const count = rows - row;
    for (let i = 0; i < count; i++) {
      const cx = x + (i - (count - 1) / 2) * 15;
      const cy = y + 20 - row * 9;
      ctx.fillStyle = "#b8860b";
      ellipse(ctx, cx, cy + 2, 9, 5);
      ctx.fillStyle = COLORS.gold;
      ellipse(ctx, cx, cy, 9, 5);
    }
  }
  // A sparkle that moves across the heap.
  const t = (clock / 900 + size * 0.3) % 1;
  ctx.fillStyle = `rgba(255, 255, 255, ${1 - t})`;
  circle(ctx, x - 20 + t * 40, y + 6 - rows * 4, 2.5);
}

function button(ctx, rect, pointer, enabled, label) {
  const hover = pointer && inside(rect, pointer.x, pointer.y);
  ctx.fillStyle = !enabled ? COLORS.cardOff : hover ? "#e0b062" : COLORS.panelEdge;
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();
  text(ctx, label, rect.x + rect.width / 2, rect.y + 28, {
    size: 15,
    weight: 700,
    align: "center",
    color: enabled ? "#2b1e16" : COLORS.muted,
  });
}

// --- helpers -----------------------------------------------------------------------

function dim(ctx, arena) {
  ctx.fillStyle = "rgba(20, 14, 10, 0.6)";
  ctx.fillRect(arena.x, arena.y, arena.width, arena.height);
}

function text(
  ctx,
  value,
  x,
  y,
  { size = 14, weight = 400, align = "left", color = COLORS.text } = {},
) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.textAlign = "left";
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function shadow(ctx, x, y, r) {
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ellipse(ctx, x, y, r, r * 0.35);
}

function eyes(ctx, apart, y, r) {
  ctx.fillStyle = "#1d1a28";
  circle(ctx, -apart, y, r);
  circle(ctx, apart, y, r);
}

function heart(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.9);
  ctx.bezierCurveTo(
    x - size * 1.4,
    y - size * 0.1,
    x - size * 0.6,
    y - size * 1.1,
    x,
    y - size * 0.35,
  );
  ctx.bezierCurveTo(
    x + size * 0.6,
    y - size * 1.1,
    x + size * 1.4,
    y - size * 0.1,
    x,
    y + size * 0.9,
  );
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function inside(r, x, y) {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * The hub card's picture: a patch of grass, the farmer and a few slimes.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {number} clock - ms
 */
export function drawThumbnail(ctx, rect, clock) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  drawGrass(ctx, rect);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const slimes = [
    [-80, -40, 0],
    [70, -50, 1],
    [90, 35, 2],
    [-70, 45, 3],
  ];
  for (const [dx, dy, wobble] of slimes) {
    const enemy = { x: cx + dx, y: cy + dy, prevX: cx + dx, prevY: cy + dy, r: 14 };
    drawEnemy(
      ctx,
      { ...enemy, type: "slime", hp: 1, maxHp: 1, hitMs: 0, ageMs: clock, wobble },
      1,
      clock,
    );
  }
  const aim = clock / 1500;
  const player = { x: cx, y: cy, prevX: cx, prevY: cy, r: 14, invulnerableMs: 0 };
  drawPlayer(ctx, { ...player, aimX: Math.cos(aim), aimY: Math.sin(aim) }, 1, clock);
  ctx.fillStyle = COLORS.bullet;
  const reach = ((clock / 4) % 80) + 20;
  circle(ctx, cx + Math.cos(aim) * reach, cy + Math.sin(aim) * reach, 4);
  ctx.restore();
}
