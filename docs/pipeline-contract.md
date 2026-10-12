# Pipeline contract and deterministic checks (draft)

The proposal asks for "deterministic checks [covering] event routing, persona selection,
statistics updates, response limits, and fallback behavior". This doc lists the rules the
real pipeline and stats model must meet. Each rule is a check in
[`src/harness/checks.js`](../src/harness/checks.js), which judges a harness run record.

> **Status: proposal for review.** The pipeline (persona selector, coalescing, output
> filter) is Sittipon's W06–W07 work, and the stats model is Shapphanyu's. The interfaces
> below are what the checks need. Change them in review if they don't fit; the checks will
> follow.

## Where the checks run

| Where | How |
|-------|-----|
| Every harness run | `npm run harness -- <scenario> --pipeline <file>` prints PASS/FAIL per check and exits 1 on a failure |
| Contract tests | [`test/contracts/`](../test/contracts): every registered implementation, on every bundled scenario and the evaluation set, in both conditions |
| Unit tests | [`test/harness/checks.test.js`](../test/harness/checks.test.js): each check against a clean record and one defect at a time |

Until an implementation is registered, `npm test` lists its checks as **TODO**. To register
one, add it to [`test/contracts/implementations.js`](../test/contracts/implementations.js):

```js
import startPipeline from "../../src/service/pipeline.js";
export const pipelines = [{ name: "service pipeline", start: startPipeline }];
```

## Interfaces

**Pipeline**: the shape from `docs/harness.md`, `start(bus, emit, deps)`, returning `stop`
or `{ stop, idle }`. The real pipeline gets `deps.generate` (an `OllamaClient` or the
fake), `deps.condition` (`"ai"` / `"scripted"`) and `deps.random` (seeded).

**Stats model**: a pure reducer, so the same events always give the same stats and the
model has no way to change them:

```js
export const stats = {
  initial: () => ({ followers: 0, donations: 0, hype: 0 }),
  reduce: (state, event) => newState, // event: a valid, frozen bus event
};
```

## Checks on one run

| Check | Rule | Proposal source |
|-------|------|-----------------|
| `messages-valid` | Every update is a valid `chat_message` (persona, source, length, fields) | Response limits |
| `stream-integrity` | Updates of one message keep `eventId`, `persona`, `viewer` and `source`; the text only grows; nothing after `done: true`; every message ends with `done: true` | Streamed responses |
| `replies-link-to-events` | Every reply answers an accepted event from the same run, and comes after it. Rejected input never gets a reply. | Malformed input is ignored |
| `routing` | Minor events never get `ai` or `fallback` replies. The AI condition never uses `scripted`. The scripted condition never uses `ai` / `fallback` and **never calls the model**. | "routes minor events to templates"; same events, same interface |
| `response-limits` | No event gets more than `maxMessagesPerEvent` messages | "number of generated messages per event will be capped" |
| `prompt-boundary` | Prompts contain no event ids, timestamps or envelope fields (`eventId`, `"ts"`, `"kind"`, `"v"`) | AI boundary: only the context needed |
| `no-handler-errors` | No pipeline or stats handler throws | Failure cases have defined outcomes |
| `stats-valid` | After every event, each stat is a finite, non-negative number (skipped when the run has no stats model) | Statistics stay consistent |

## Checks across two runs

| Comparison | Runs compared | Rule |
|------------|---------------|------|
| `same-choices` | Same scenario, seed and fake output, twice | Identical chat: same replies, personas, sources and text |
| `persona-independent-of-model` | `normal` vs `garbage` fake output | The persona answering an event is the same. Pick the persona before generating, and keep it for the fallback. |
| `same-stats` | `normal` vs `unsafe` fake output | Identical stats after every event: the model never changes them |

## Limits

`QA_LIMITS` in `checks.js` are **provisional** until the laptop pilot (Sittipon's W08) sets
the real numbers:

| Limit | Provisional value |
|-------|-------------------|
| `maxMessagesPerEvent` | 3 |

The W07 edge-case checks (timeouts, bursts, unsafe output) add more limits here.

## Deliberately not checked

- **Whether a major event gets a reply.** Coalescing may legitimately answer a run of
  events once. The evaluation set keeps major events 3 s apart so this doesn't eat study
  data.
- **Which persona fits which event.** That's part of the persona voice rules (Sittipon's
  W05). Once they're written, rules like "the Lurker only speaks at big moments" can
  become checks.
- **Reply quality.** Relevance and persona clarity are rated by people, on the
  evaluation set.
