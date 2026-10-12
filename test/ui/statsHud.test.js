import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount, formatMoney, hypeLabel } from "../../src/ui/statsHud.js";

test("counts are short and readable", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(1234), "1,234");
  assert.equal(formatCount(12_345), "12.3K");
  assert.equal(formatCount(20_000), "20K");
  assert.equal(formatCount(2_500_000), "2.5M");
  assert.equal(formatMoney(60), "$60");
});

test("hype labels", () => {
  assert.equal(hypeLabel(0), "CHILL");
  assert.equal(hypeLabel(20), "WARM");
  assert.equal(hypeLabel(50), "HYPED");
  assert.equal(hypeLabel(100), "ON FIRE");
});
