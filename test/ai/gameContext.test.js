import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONTEXT } from "../../src/ai/personas/game.js";
import { PERSONA_PROMPTS } from "../../src/ai/personas/index.js";
import { ENEMY_TYPES } from "../../src/game/shooter/waves.js";
import { SHOP_ITEMS } from "../../src/game/shooter/shop.js";

test("every persona's prompt describes the real game", () => {
  for (const [persona, { system }] of Object.entries(PERSONA_PROMPTS)) {
    assert.ok(system.includes(GAME_CONTEXT), persona);
  }
});

test("the game description names the shooter's enemies and shop items", () => {
  const text = GAME_CONTEXT.toLowerCase().replace(/\s+/g, " ");
  for (const enemy of Object.keys(ENEMY_TYPES)) assert.ok(text.includes(enemy), enemy);
  for (const item of SHOP_ITEMS) assert.ok(text.includes(item.name.toLowerCase()), item.name);
});
