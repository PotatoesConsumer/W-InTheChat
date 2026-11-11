import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERSONA_LABELS } from "../../src/ui/chatOverlay.js";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const home = read("index.html");
const stream = read("stream.html");

test("the home page links to the stream, and the stream page runs the game", () => {
  assert.match(home, /href="stream\.html"/);
  assert.match(home, /src="src\/ui\/home\.js"/);
  assert.doesNotMatch(home, /src\/game\/main\.js/);
  assert.match(stream, /src="src\/game\/main\.js"/);
});

test("old links with a query (?condition=, ?session=, ?bot=) are forwarded to the stream", () => {
  assert.match(
    home,
    /if \(location\.search\) location\.replace\(`stream\.html\$\{location\.search\}/,
  );
});

test("the home page lists every chat persona by its chat label", () => {
  for (const label of Object.values(PERSONA_LABELS)) {
    assert.ok(home.includes(`>${label}</span>`), label);
  }
});
