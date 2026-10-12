# Evaluation event set

The proposal compares AI chat with a scripted baseline **on the same events**. This folder
holds the fixed set of game events and player messages both conditions are run on, so
relevance, persona and variety ratings compare like with like.

| File | What |
|------|------|
| [`eval/event-set-v1.json`](../eval/event-set-v1.json) | The set: scenario format (`docs/harness.md`), 46 steps over 141 s |
| [`eval/manifest.json`](../eval/manifest.json) | Status (`draft` / `frozen`) and hash of each set |
| [`test/eval/eventSet.test.js`](../test/eval/eventSet.test.js) | Coverage rules below, plus the freeze check |

> **v1 is a draft.** It uses the placeholder event catalog. When the mini-game is chosen
> and `GAME_EVENTS` changes, rewrite the set (the coverage test lists missing events), then
> freeze it before the pilot.

## What v1 contains

Four rounds (win, loss, win with a personal best, loss):

| | Count |
|-|-------|
| Major game events (may get an AI reply) | 10: `close_call` ×3, `streak` ×2, `win` ×2, `loss` ×2, `new_best` ×1 |
| Minor game events (templates) | 22 |
| Player messages | 14, two of most categories |

Every player message has a `note` starting with its category, so raters know what kind of
input a reply was answering:

| Category | Example |
|----------|---------|
| `greeting` | "hey chat, we're live! let's get this first win" |
| `question` | "is this level always this hard?" |
| `advice-request` | "which way do I go, left path or the bridge?" |
| `reaction` | "I was ONE hit from dying there" (right after a close call) |
| `thanks` | "thank you chat, you guys carried me" |
| `banter` | "ok chat, who jinxed that? be honest" |
| `irrelevant` | "anyone else hungry? I could go for some noodles" |
| `minimal` | "😤😤", "lol" |

## Coverage rules (enforced by the test)

- Every step is a valid game or chat event. Malformed input belongs in edge-case
  scenarios, not here.
- Every event in the catalog appears at least once.
- At least 8 major events, 12 minor events and 12 player messages.
- Every player message is categorized, and every category is used.
- Major events are at least 3 s apart, so coalescing can't swallow events the study
  samples from.
- Two to five minutes long.

## Running it

```bash
npm run harness -- eval/event-set-v1.json --condition ai       --pipeline <pipeline> --json > runs/ai.json
npm run harness -- eval/event-set-v1.json --condition scripted --pipeline <pipeline> --json > runs/scripted.json
```

Play it at normal speed (no `--speed max`) so event spacing, and anything that depends on
it, is the same as in a live session. Each record stores the set's `sha256`, the condition
and the seed. The evaluation report must state those for every run, and keep local-model
and hosted-API runs apart (proposal: "results from the two modes will not be combined
without distinction").

Linking for raters: every reply carries `eventId`, which is the step id
(`event-set-v1-017`). That gives the triggering event or message, and its note, for each
sampled reply.

## Versioning

1. A set is `draft` while it can still change.
2. Before the first pilot run, set its manifest entry to `"status": "frozen"` with its
   `sha256` (printed in the harness record under `scenario.file.sha256`). From then on the
   test fails if the file changes.
3. Never edit a frozen set. Copy it to `event-set-v2.json`, add a manifest entry, and say
   in the report which version each result used.
