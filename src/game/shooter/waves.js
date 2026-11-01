/**
 * waves.js
 *
 * Enemy types and how each wave is built. Every wave is harder than the one before:
 * more enemies, spawning faster, with more health and speed, and new enemy types from
 * wave 3 (bats) and wave 5 (brutes). Pure data and functions, tested in Node.
 */

/** hp and speed are wave 1 values; waveConfig scales them. */
export const ENEMY_TYPES = Object.freeze({
  slime: Object.freeze({ hp: 2, speed: 70, radius: 14, damage: 1, coins: 10 }),
  bat: Object.freeze({ hp: 1, speed: 150, radius: 10, damage: 1, coins: 10 }),
  brute: Object.freeze({ hp: 8, speed: 48, radius: 22, damage: 2, coins: 40 }),
});

/** The wave each enemy type first shows up in. */
export const FIRST_WAVE = Object.freeze({ slime: 1, bat: 3, brute: 5 });

/**
 * @param {number} wave - 1 for the first wave.
 * @returns {Readonly<{
 *   wave: number,
 *   count: number,
 *   spawnEveryMs: number,
 *   hpMultiplier: number,
 *   speedMultiplier: number,
 *   weights: Readonly<Record<string, number>>
 * }>}
 */
export function waveConfig(wave) {
  if (!Number.isInteger(wave) || wave < 1) throw new RangeError(`bad wave ${wave}`);
  const n = wave - 1;
  const weights = {};
  for (const [type, first] of Object.entries(FIRST_WAVE)) {
    // A new type starts rare and becomes more common each wave after.
    if (wave >= first) weights[type] = type === "slime" ? 1 : 0.15 + 0.08 * (wave - first);
  }
  return Object.freeze({
    wave,
    count: 6 + 3 * n,
    spawnEveryMs: Math.max(250, 1100 - 80 * n),
    hpMultiplier: 1 + 0.2 * n,
    speedMultiplier: Math.min(1.6, 1 + 0.06 * n),
    weights: Object.freeze(weights),
  });
}

/**
 * @param {Readonly<Record<string, number>>} weights
 * @param {number} roll - In [0, 1).
 */
export function pickEnemyType(weights, roll) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let left = roll * total;
  for (const [type, w] of entries) {
    if (left < w) return type;
    left -= w;
  }
  return entries.at(-1)[0];
}
