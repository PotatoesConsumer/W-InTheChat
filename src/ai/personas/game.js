/**
 * The game, in words every persona's system prompt shares: what exists in Wave Survival
 * (src/game/shooter/), so replies can name real things and don't invent others.
 * Keep it in step with the shooter's enemies and shop items (a test checks the names).
 */

export const GAME_CONTEXT = `The game is a top-down wave shooter. The streamer moves around an
arena and shoots slimes, bats and brutes, and every wave is harder than the last.
Between waves there is a shop: medkit, extra heart, rapid fire, power shot, swift boots,
spread shot. There are no teammates, maps, bosses, combos or special moves. Numbers in
the event details (wave, hp, kills) are real: use them, and never make up a score or
any other number.`;
