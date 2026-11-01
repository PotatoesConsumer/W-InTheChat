# Pipeline contract and deterministic checks (draft)

The proposal asks for "deterministic checks [covering] event routing, persona selection,
statistics updates, response limits, and fallback behavior". This doc lists the rules the
real pipeline and stats model must meet. Each rule is a check in
[`src/harness/checks.js`](../src/harness/checks.js), which judges a harness run record.

> **Status: proposal for review.** The pipeline (persona selector, coalescing, output
> filter) is Sittipon's W06–W07 work, and the stats model is Shapphanyu's
> (`src/game/stats.js`, registered in `statsModels`). The interfaces below are what the
> checks need. Change them in review if they don't fit; the checks will follow.

## Where the checks run

| Where | How |
|-------|-----|
| Every harness run | `npm run harness -- <scenario> --pipeline <file>` prints PASS/FAIL per check and exits 1 on a failure |
| Contract tests | [`test/contracts/`](../test/contracts): every registered implementation, on every bundled scenario and the evaluation set, in both conditions |
| Unit tests | [`test/harness/checks.test.js`](../test/harness/checks.test.js) and [`edgeCaseChecks.test.js`](../test/harness/edgeCaseChecks.test.js): each check against a clean record and one defect at a time |

Until an implementation is registered, `npm test` lists its checks as **TODO**. To register
one, add it to [`test/contracts/implementations.js`](../test/contracts/implementations.js):

```js
import startPipeline from "../../src/service/pipeline.js";
export const pipelines = [{ name: "service pipeline", start: startPipeline }];
```

A pipeline can list edge cases it doesn't handle yet as `pending: { <id>: "reason" }`
(ids are in `edgeCases.contract.test.js`). Those show as TODO with the reason instead of
failing, so it can be registered before W06/W07 are done. The service pipeline is
registered with nothing pending: `burst` passes since W06 and `unsafe` since the W07
safety filter. The filter is registered in `filters` too, so its contract runs on its own.

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

**Output filter**: `check(text)` returns `{ ok, reason? }` (or a promise of it). `ok: false`
means the text must not be shown, and the pipeline sends a `fallback` instead.

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
| `same-choices` | Same scenario, seed and fake output, twice | Identical chat: same replies, personas, sources and text. Compared in event order: when replies to different events overlap, the order they finish in depends on timers (coarse on Windows) and isn't a choice. |
| `persona-independent-of-model` | `normal` vs `garbage` fake output | The persona answering an event is the same. Pick the persona before generating, and keep it for the fallback. |
| `same-stats` | `normal` vs `unsafe` fake output | Identical stats after every event: the model never changes them |

## Limits

`QA_LIMITS` in `checks.js` are **provisional**. The laptop pilot (W08,
[`docs/pilot-w08.md`](pilot-w08.md)) measured the slowest reply at 933 ms and at most 3 new
messages in a second, and set the pipeline's own `replyTimeoutMs` to 3000 ms; these check
limits are Prin's to tighten:

| Limit | Provisional value | Used by |
|-------|-------------------|---------|
| `maxMessagesPerEvent` | 3 | `response-limits`, `repeat-coalescing` |
| `replyTimeoutMs` (+ `timeoutGraceMs`) | 10 000 ms (+ 500 ms) | `reply-timeout`, `fallback-on-failure` |
| `maxGenerationsInFlight` | 1 (one 6 GB GPU) | `generation-concurrency` |
| `maxMessagesPerSecond` | 5 | `burst-rate` |
| `coalesceWindowMs` | 2 000 ms | `repeat-coalescing` |

## Edge cases (W07)

The proposal lists the failure and edge cases the specification must cover, each with an
expected outcome. Each one maps to a way of producing it and to the checks that judge it.
[`test/contracts/edgeCases.contract.test.js`](../test/contracts/edgeCases.contract.test.js)
runs them all against every registered pipeline, and every check must pass in each.

| Edge case | Produced by | Expected outcome | Checks |
|-----------|-------------|------------------|--------|
| Rapid event bursts | `burst` scenario at real-time speed | Repeats coalesced, chat rate-limited, one generation at a time | `burst-rate`, `repeat-coalescing`, `generation-concurrency` |
| Empty or oversized player input | `player-chat` scenario | Rejected by the schema, no reply | `replies-link-to-events` |
| Malformed events | `malformed` scenario | Dropped; the next valid event still gets a reply | `replies-link-to-events`, `no-handler-errors` |
| Delayed generation | fake model `slow` | A `fallback` within the timeout; the late reply is never shown | `reply-timeout`, `fallback-on-failure`, `ai-text-from-model` |
| Model unavailable | fake model `error` | A `fallback` | `fallback-on-failure`, `no-handler-errors` |
| Malformed model output | fake model `garbage` | Cleaned up into one plain line, or replaced by a `fallback` | `messages-valid`, `plain-text` |
| Unsafe output | fake model `unsafe` | Blocked and replaced by a `fallback` | `unsafe-blocked`, `fallback-on-failure`, `ai-text-from-model` |

### Edge-case checks

| Check | Rule |
|-------|------|
| `reply-timeout` | Every reply, fallback included, completes within `replyTimeoutMs` (+ grace) of its event |
| `fallback-on-failure` | If any generation failed, was aborted, ran past the timeout or was unsafe, at least one `fallback` was sent |
| `ai-text-from-model` | Every `ai` reply is text from a generation that succeeded and wasn't unsafe. Light cleanup (quotes, punctuation, case) is fine. |
| `unsafe-blocked` | No update ever contains the text of an unsafe generation (compared ignoring case and punctuation) |
| `plain-text` | Chat text is one line: no newlines, markdown, JSON, or "as an AI" disclosures |
| `generation-concurrency` | At most `maxGenerationsInFlight` generations at once |
| `burst-rate` | At most `maxMessagesPerSecond` new messages in any second. Streamed updates don't count. |
| `repeat-coalescing` | The same game event repeated within `coalesceWindowMs` gets at most `maxMessagesPerEvent` messages in total |

`burst-rate` and `repeat-coalescing` only apply to real-time runs (`--speed 1`). On a
sped-up run every scenario is a burst, so they report **SKIP** rather than a meaningless
PASS or FAIL.

Against the harness stub, the slow, garbage, unsafe and burst cases all fail. That's the
point: the stub has no timeout, filter or coalescing. Those failures (pinned in
`edgeCaseChecks.test.js`) are what the real pipeline has to fix.

### Output filter test set

[`eval/safety-cases-v1.json`](../eval/safety-cases-v1.json) sets the bar for Sittipon's
filter. The contract suite requires the filter to:

- **block** all 13 `block` cases: threats, self-harm encouragement, attacks on the person,
  attacks on protected groups, sexual harassment, and doxxing
- **allow** all 16 `allow` cases: harsh criticism of plays ("my grandma aims better than
  this"), in-game violence ("nice kill!"), hype, backseating. These catch a filter that
  blocks the Hater entirely or bans words like "kill".

The `review` cases are borderline ("uninstall the game"). People judge them; the tests
don't. The fake model's `unsafe` mode answers with the `block` cases, so the edge-case
suite tests the filter inside the pipeline as well as on its own.

**Slurs are deliberately not in the repo.** The filter needs a slur blocklist, and that
list should be tested by the filter's own unit tests, next to the list. Copying it into
a test set only spreads it.

## Deliberately not checked

- **Whether a major event gets a reply.** Coalescing may legitimately answer a run of
  events once. The evaluation set keeps major events 3 s apart so this doesn't eat study
  data.
- **Which persona fits which event.** The voice rules are in `docs/personas.md` (W05)
  and the selector's weights in `src/service/selector.js` (W06), unit tested there. A
  rule like "the Lurker never answers player chat" could become a run check here.
- **Reply quality.** Relevance and persona clarity are rated by people, on the
  evaluation set.
