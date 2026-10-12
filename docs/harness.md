# Mock-event harness

The harness drives the chat pipeline **headless**: no game, no browser, no Ollama. It plays
a scripted list of events (a *scenario*) onto the event bus, feeds the pipeline a fake
model, and records everything that came out. Use it to see how the pipeline behaves on
bursts, bad input or a broken model without setting any of that up by hand.

```bash
npm run harness -- --list                          # bundled scenarios
npm run harness -- basic-session                   # real time
npm run harness -- player-chat --speed max         # no waiting between steps
npm run harness -- basic-session --mode error      # Ollama "down"
npm run harness -- basic-session --json > run.json # full record
npm run harness -- my-scenario.json --pipeline src/service/pipeline.js
```

| Option | Meaning |
|--------|---------|
| `--mode` | Fake model: `normal`, `slow` (answers after 15 s), `error` (rejects), `garbage` (empty, markdown, multi-line, too long, "As an AI…"), `unsafe` (text the filter must block) |
| `--condition` | `ai` or `scripted`, passed to the pipeline |
| `--pipeline` | Module whose default export (or `start`) is the pipeline. Default: the naive stub, see below. |
| `--speed` | Playback speed. `max` publishes every step at once. |
| `--seed` | Seed for the pipeline's random choices, so runs are reproducible |
| `--settle` | Longest wait (ms) for replies still in flight after the last step |
| `--json` | Print the run record instead of the readable report |

Code: [`src/harness/`](../src/harness), CLI: [`scripts/harness.js`](../scripts/harness.js).

## Scenarios

JSON files in [`src/harness/scenarios/`](../src/harness/scenarios). Any other file can be
passed by path.

```json
{
  "name": "basic-session",
  "description": "One ordinary round.",
  "steps": [
    { "at": 0, "game": "round_start", "data": { "round": 1 } },
    { "at": 8000, "chat": "that was way too close", "note": "player reacts" },
    { "at": 9000, "raw": { "kind": "game", "name": "headshot" } }
  ]
}
```

- `name`: lowercase kebab-case. It must match the file name for bundled scenarios.
- `at`: ms from the start of the run, never decreasing.
- One of:
  - `game` (+ optional `data`): checked against the catalog **when the file loads**, so typos
    fail immediately. Use `raw` for deliberately bad game events.
  - `chat`: sent the way the UI would send it (trimmed, not validated), so empty or
    oversized input reaches the bus and is rejected there.
  - `raw`: published exactly as written.
- `note`: optional explanation for whoever reads the scenario or the results.

Each step gets a fixed id, `<name>-<index>` (e.g. `basic-session-004`), so the same step can
be found across runs. `ts` is set when the step is published.

| Bundled | What it covers |
|---------|----------------|
| `basic-session` | An ordinary round: minor and major events, player chat, a win, a loss |
| `player-chat` | Typed input: greeting, question, irrelevant, emoji, empty, whitespace, 200 and 201 chars |
| `malformed` | Nine malformed events the bus must drop, then one valid event that must still get a reply |

## Pipeline contract

The harness starts a pipeline the same way the game starts its dev chat feed:

```js
export default function start(bus, emit, deps) {
  const off = bus.subscribe("*", (event) => { /* … emit(chatMessage) … */ });
  return { stop: off, idle: () => promiseThatResolvesWhenNothingIsInFlight };
}
```

| Argument | |
|----------|-|
| `bus` | The event bus (`src/events/bus.js`). Only valid, frozen events reach subscribers. |
| `emit(message)` | Send a `chat_message` (see `docs/events.md`). Each streamed update is one call. |
| `deps.generate(prompt, {signal, onText})` | The model. Same shape as `OllamaClient.generate`: resolves `{text, …}`. `signal` aborts the call, `onText` gets the growing text. |
| `deps.condition` | `"ai"` or `"scripted"` |
| `deps.random` | Seeded `Math.random` replacement. Use it for every random choice so runs are reproducible. |

Return a stop function, or `{ stop, idle }`. `idle()` lets the harness finish as soon as
replies are done. Without it, the harness waits the full `--settle` time.

### The stub pipeline

Until the real pipeline exists, the harness runs
[`stubPipeline.js`](../src/harness/stubPipeline.js): templates for minor events, one
generated reply for everything else. It is **deliberately naive**: no coalescing, no output
filter, no timeout, no limits. Running the edge-case scenarios against it shows exactly the
failures the real pipeline has to handle. It is not used by the game.

## The run record

`--json` prints the record that the report and the checks are built from:

| Field | Contents |
|-------|----------|
| `scenario` | `name`, `description`, and `file` (`path`, `sha256` of the exact file played) |
| `condition`, `seed`, `generatorMode` | How the run was configured |
| `events[]` | One per step: `id`, `kind`, `t`, `accepted`, then `event` + `importance` or `errors` |
| `messages[]` | Every emitted update in order: `t` and the `message` |
| `generatorCalls[]` | `prompt`, `start`, `end`, `outcome` (`ok` / `error` / `aborted`), `text` or `error`, `unsafe` |
| `handlerErrors[]` | Pipeline handlers that threw |
| `lateMessages` | Messages emitted after the run ended (they are not recorded) |

`t` is ms since the run started. Every event and message also has `seq`, one counter across
both, which gives the exact order even within a millisecond.

Latency in the report is measured from when the harness published an event to its first
reply and to its completed reply (`done: true`), as p50/p95. Against the fake model this
measures the pipeline only; model latency comes from Sittipon's laptop pilot.
