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

`--condition` is only the starting condition. The game's study panel (F2) switches it
while the service runs (`POST /condition`, below). Switching to `ai` loads the model
first and is refused if Ollama isn't running; the scripted condition never needs it.
Each switch prints the p50/p95 of the condition it replaced.

## Transport

POST in, Server-Sent Events out, as proposed in [docs/events.md](events.md#transport).
Node's `http` module only; no dependencies.

| Endpoint | |
|----------|-|
| `POST /events` | One event as JSON. `202 {ok: true}`, `400 {ok: false, errors}` (schema errors from `bus.publish`, or a body that isn't JSON), `413` over 8 KB. |
| `GET /stream` | SSE. Each `chat_message` update is one `event: chat_message` frame with the message as JSON `data`. A `: ping` comment every 15 s keeps it open. |
| `GET /health` | `{ok: true, clients}` |
| `GET /stats` | The pipeline's reply counts, failure reasons and p50/p95 latency |
| `GET /condition` | `{ok: true, condition, conditions}` |
| `POST /condition` | `{condition: "ai" \| "scripted"}`. Restarts the pipeline in that condition, so stats and latency start fresh; replies still in flight are dropped. `200 {ok: true, condition}`; `400` for an unknown condition; `503` if the model couldn't be loaded and `409` if the pipeline can't start (both keep the old condition running). |

**Localhost only.** The server binds `127.0.0.1`, refuses requests whose `Host` isn't
localhost (DNS rebinding), and only answers cross-origin requests from `localhost` /
`127.0.0.1` pages, such as the game's dev server on port 5173.

In the game:

```js
import { connectToService } from "./src/service/client.js";

const chat = connectToService({
  onMessage: (message) => overlay.push(message), // every valid chat_message update
  onStatus: (status) => console.log(status), // connected | reconnecting | closed
});
chat.send(createGameEvent("win", { score: 12 })); // never rejects
```

## What the pipeline does

| Event | ai condition | scripted condition |
|-------|--------------|--------------------|
| Repeat of a recent same-name event (or the same player message) | coalesced: no message | coalesced: no message |
| Minor game event | `template` line (Fan) | `template` line (Fan) |
| Major game event | model reply, persona from the selector | `scripted` line, persona from the selector |
| Player message | model reply, persona from the selector | `scripted` line, persona from the selector |
| Model times out, fails, or its reply is rejected | `fallback` line | (model never called) |

- **At most one reply per event**, always linked by `eventId`.
- **Choices come first.** Persona, viewer name and the fixed line are drawn from
  `deps.random` when the event arrives, before the model runs: three draws per event,
  coalesced or not. The same seed and events give the same chat whatever the model
  returns.
- **Persona selector** ([`selector.js`](../src/service/selector.js)): a weighted draw per
  event, weights in `PERSONA_WEIGHTS` (for example a loss leans to the Hater and the
  Backseat Gamer, a win to the Fan; the Lurker only answers major game events, never
  chat). Only personas in `aiPersonas` can be picked; all four are, the Hater since the
  safety filter (W07). The scripted condition uses the same selector, roll and
  `aiPersonas`, so the same seed and events give **the same persona labels in both
  conditions** (proposal: same events and persona labels); only the text differs. Its
  lines are `SCRIPTED_LINES` in `templates.js`, per persona and event, written to the
  voice and safety rules in `docs/personas.md`. Minor-event templates stay in the Fan's
  voice in both conditions.
- **Coalescing** ([`coalesce.js`](../src/service/coalesce.js)): same-name game events, or
  player messages with the same text (case and spacing ignored), less than
  `coalesceWindowMs` apart form a run. Different player messages are never repeats of
  each other, so a quick follow-up question is still answered. The first of a run is
  answered, then every `repeatReplyEvery`-th, at most `maxRepliesPerRun` in all; the rest
  get no message (`coalesced` in `/stats`). Runs are measured with **the events' own
  timestamps**, never with the pipeline's state, so this doesn't route on timing in the
  sense of the decision below: the same events are coalesced the same way however fast
  the model is. At real speed the evaluation set has no same-name events under 2 s apart,
  so nothing in it is coalesced.
- **Rate limit** ([`pacer.js`](../src/service/pacer.js)): at most `maxMessagesPerSecond`
  new messages in any second. Over that, lines wait their turn in order. Nothing is
  dropped and no text changes, so pacing moves when a line appears, never which lines
  appear.
- **One generation at a time, first in, first out.** Model replies wait in a queue
  (`maxGenerationsInFlight: 1`, one 6 GB GPU). Each reply's deadline counts from when its
  event arrived, so time in the queue uses it up. A reply whose turn comes with less than
  `minGenerationMs` left gets a fallback without calling the model (`queue_timeout` in
  `/stats`). Nothing is routed on "is the model busy right now": that made the same
  events get different replies run to run. Bursts are handled by coalescing and the
  rate limit above.
- **Whole replies, checked first.** See [Showing replies](#showing-replies).
- **Only `ctx.facts` reach the model** (via the context builder). Chat history is
  supported but off (`historySize: 0`): in the first runs qwen2.5:3b copied the history's
  `viewer: text` format and invented follow-ups from it.

### Showing replies

A model reply is sent as **one `chat_message` update, once it's complete and has passed
the reply check** (`streamPartials: false`). The game types the line in
(`typeInDelay` in `src/ui/chatOverlay.js`, about 22 ms a character, at most 1.1 s a
line) so chat still appears progressively, as the proposal asks.

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

### Reply check and safety filter

[`replyCheck.js`](../src/service/replyCheck.js) rejects replies that are empty, over 200
characters, talk as an AI ("As an AI…", "I cannot…") or are structured data (`{…}`,
`[…]`), and anything the safety filter blocks (`unsafe` in `/stats` failures). The shared
persona parser first keeps only the first real line and strips quotes, code fences, `**`
and a copied speaker label (`Player:`). A rejected reply gets a fallback line; none of
its text is shown.

**Safety filter** ([`safetyFilter.js`](../src/service/safetyFilter.js), W07). The Hater
mocks plays, never people, so the filter lets harsh criticism of a play ("my grandma aims
better than this") and in-game violence ("nice kill!") through, and blocks what's aimed
at the person:

| Category | Examples of what's blocked |
|----------|----------------------------|
| `slur`, `profanity` | words in the hashed blocklist ([`blocklist.js`](../src/service/blocklist.js)) |
| `threat` | "watch your back", "I'm going to find you", swatting |
| `self_harm` | "kys", "go die", "nobody would miss you" |
| `privacy` | real names, addresses, doxxing |
| `sexual` | requests for pics, remarks about the body |
| `protected_group` | "like a girl", "your country / religion / race …" |
| `personal_attack` | name-calling ("idiot", "loser", "you're clueless"), looks, worth, family |

Before matching it undoes leetspeak next to letters (`n00b`), joins spaced-out letters
(`k y s`) and squeezes repeated letters. The blocklist holds salted SHA-256 hashes, not
the words, so slurs never sit in the repo; add one with
`node scripts/blocklist-hash.js <word> <category>`.

It passes all 13 `block` and all 16 `allow` cases in `eval/safety-cases-v1.json` (contract
suite) and its own unit tests. With qwen2.5:3b (`npm run ai:personas -- --repeats 3`,
132 replies from all four personas, 2026-11-01) it blocked none of the other personas'
replies; it caught the Hater's "losers", "you must be blind" and "my bot", which became
unit tests. Known gaps: English patterns only (Thai replies aren't checked yet), and
regexes miss what's said indirectly, so keep reviewing the logged replies.

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
| `aiPersonas` | fan, hater, backseat, lurker |
| `coalesceWindowMs` (same as `QA_LIMITS`) | 2000 |
| `repeatReplyEvery` | 5 |
| `maxRepliesPerRun` (`QA_LIMITS.maxMessagesPerEvent` is 3) | 3 |
| `maxMessagesPerSecond` (`QA_LIMITS` allows 5) | 4 |

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
