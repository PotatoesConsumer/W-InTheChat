# Chat service and pipeline (v1)

The service is the local process between the game and the model. The game posts events,
the pipeline decides how the chat answers, and replies come back to the browser over SSE.

```
game ──POST /events──▶ bus ──▶ pipeline ──▶ context builder ──▶ qwen2.5:3b (Ollama)
 ▲                                  │                                  │ reply text
 └──────GET /stream (SSE)◀── chat_message updates ◀── reply check ◀────┘
```

| Piece | Code |
|-------|------|
| HTTP + SSE server | [`src/service/server.js`](../src/service/server.js) |
| Pipeline (routing, queue, fallback) | [`src/service/pipeline.js`](../src/service/pipeline.js) |
| Reply check | [`src/service/replyCheck.js`](../src/service/replyCheck.js) |
| Template, scripted and fallback lines | [`src/service/templates.js`](../src/service/templates.js) |
| Browser client for the game | [`src/service/client.js`](../src/service/client.js) |
| Context builder | [`src/ai/contextBuilder.js`](../src/ai/contextBuilder.js) |

## Running it

```bash
npm run service                         # ai condition, http://127.0.0.1:8787
npm run service -- --condition scripted # scripted baseline, never calls the model
npm run service -- --streamer Pu        # how prompts name the streamer
npm run e2e                             # latency run over HTTP + SSE with the real model
npm run e2e -- --rounds 5 --gap 1500
```

Both load the model before serving, because a cold load can take longer than a reply
timeout. `npm run service` logs every finished reply; Ctrl+C prints p50/p95.

## Transport

POST in, Server-Sent Events out, as proposed in [docs/events.md](events.md#transport).
Node's `http` module only; no dependencies.

| Endpoint | |
|----------|-|
| `POST /events` | One event as JSON. `202 {ok: true}`, `400 {ok: false, errors}` (schema errors from `bus.publish`, or a body that isn't JSON), `413` over 8 KB. |
| `GET /stream` | SSE. Each `chat_message` update is one `event: chat_message` frame with the message as JSON `data`. A `: ping` comment every 15 s keeps it open. |
| `GET /health` | `{ok: true, clients}` |
| `GET /stats` | The pipeline's reply counts, failure reasons and p50/p95 latency |

**Localhost only.** The server binds `127.0.0.1`, refuses requests whose `Host` isn't
localhost (DNS rebinding), and only answers cross-origin requests from `localhost` /
`127.0.0.1` pages, such as the game's dev server on port 5173.

In the game:

```js
import { connectToService } from "./src/service/client.js";

const chat = connectToService({
  onMessage: (message) => overlay.apply(message), // every valid chat_message update
  onStatus: (status) => console.log(status), // connected | reconnecting | closed
});
chat.send(createGameEvent("win", { score: 12 })); // never rejects
```

## What the pipeline does

| Event | ai condition | scripted condition |
|-------|--------------|--------------------|
| Minor game event | `template` line | `template` line |
| Major game event | Fan reply from the model | `scripted` line |
| Player message | Fan reply from the model | `scripted` line |
| Model times out, fails, or its reply is rejected | `fallback` line | (model never called) |

- **One reply per event**, always linked by `eventId`.
- **Choices come first.** Persona, viewer name and the fixed line are drawn from
  `deps.random` when the event arrives, before the model runs. The same seed and events
  give the same chat whatever the model returns.
- **One generation at a time, first in, first out.** Model replies wait in a queue
  (`maxGenerationsInFlight: 1`, one 6 GB GPU). Each reply's deadline counts from when its
  event arrived, so time in the queue uses it up. A reply whose turn comes with less than
  `minGenerationMs` left gets a fallback without calling the model (`queue_timeout` in
  `/stats`). Nothing is routed on "is the model busy right now": that made the same
  events get different replies run to run. Bursts are the router's job (coalescing, W06).
- **Whole replies, checked first.** See [Showing replies](#showing-replies).
- **Only `ctx.facts` reach the model** (via the context builder). Chat history is
  supported but off (`historySize: 0`): in the first runs qwen2.5:3b copied the history's
  `viewer: text` format and invented follow-ups from it.

### Showing replies

A model reply is sent as **one `chat_message` update, once it's complete and has passed
the reply check** (`streamPartials: false`). The game should animate the line in (type
it out) so chat still appears progressively, as the proposal asks.

Why not stream partial text: a line can't be taken back once it's on screen. If a reply
times out, fails or turns out unsafe after part of it was shown, the edge-case contract
(`docs/pipeline-contract.md`) requires a fallback and that none of that generation's text
was shown, which streamed partials can't guarantee. A filter can't judge a sentence
before it ends either ("nobody would care if you…"). Replies take about 200 ms at p50, so
waiting for the whole line costs little.

`streamPartials: true` still works for experiments. Partials then appear once they have
`minStreamChars` (12) characters and pass the reply check, and only if they extend what's
shown; if the reply goes bad later, the line ends at the part already shown. The
`chat_message` contract and the game's chat log both handle streamed updates either way.

### Reply check (v1)

[`replyCheck.js`](../src/service/replyCheck.js) rejects replies that are empty, over 200
characters, talk as an AI ("As an AI…", "I cannot…") or are structured data (`{…}`,
`[…]`). The Fan parser first keeps only the first real line and strips quotes, code fences
and `**`.

**It is not the safety filter.** Abusive or unsafe text still passes. The safety filter
and its test set are W07 and plug in here as another rejection reason. Until then only
the Fan persona exists, so there is no Hater output to filter.

### Limits

Provisional, in `PIPELINE_DEFAULTS`; the laptop pilot (W08) sets the real values.

| Limit | Value |
|-------|-------|
| `replyTimeoutMs` (from event arrival, queue time included) | 5000 |
| `maxGenerationsInFlight` | 1 |
| `minGenerationMs` | 500 |
| `maxTokens` (Ollama `num_predict`) | 48 |
| `streamPartials` | false |
| `minStreamChars` (only with `streamPartials`) | 12 |
| `historySize` | 0 (off) |

## Latency

`npm run e2e` measures on the client side, from each event's `ts` to the first SSE frame
for it and to the frame with `done: true`. The pipeline also measures from `ts` to the
moment it emits (`GET /stats`). Neither includes drawing in the browser.

On the RTX 4050 laptop (qwen2.5:3b loaded, 2 rounds, 16 events, 1.5 s apart), whole
replies (the default):

| Path | Reply shown p50 / p95 |
|------|-----------------------|
| Model (major events + player chat, n=10) | 211 / 430 ms |
| Templates (minor events, n=6) | 1–4 ms |

No fallbacks. For comparison, with `streamPartials` on, the first partial text showed at
92 / 379 ms and the completed line at 200 / 480 ms (same setup), and at 78 / 134 ms and
178 / 289 ms with events 600 ms apart.

These are short runs, not the pilot benchmark (W08/W09). Earlier, the cold model load
took about 60 s.

## Not built yet

| What | Task |
|------|------|
| Hater, Backseat Gamer and Lurker prompts | W05 |
| Persona selector, coalescing, event-rate limits (`burst` edge case still fails) | W06 |
| Safety filter (`unsafe` edge case still fails) | W07 |
| Full scripted baseline (scripts, UI switch) | W07 |
| Hooking the game up (replace `devChatFeed.js` with `connectToService`, type lines in) | after the game PR merges |
