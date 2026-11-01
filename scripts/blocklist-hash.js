/**
 * Prints a blocklist entry for src/service/blocklist.js without writing the word anywhere.
 *
 *   node scripts/blocklist-hash.js <word> [slur|profanity]
 */

import { hashWord } from "../src/service/safetyFilter.js";

const [word, category = "slur"] = process.argv.slice(2);
if (!word) {
  console.error("usage: node scripts/blocklist-hash.js <word> [slur|profanity]");
  process.exit(1);
}
console.log(`  ["${hashWord(word.toLowerCase())}", "${category}"],`);
