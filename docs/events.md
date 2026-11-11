# Event schema and bus contract (v1, draft)

Everything that can make the chat react enters the pipeline as an **event**. The game
(browser) creates events. The local service validates them, then coalesces, routes and
answers them. The proposal requires this contract to exist before the context builder or
event routing is written.

```
game / chat input ──event──▶ bus ──▶ router ──▶ toContext() ──▶ persona prompt / template
   (browser)                (service)                                   │
chat overlay ◀──────────────────────── chat_message ◀───────────────────┘
```

| Piece | Code | Section |
|-------|------|---------|
| Inbound events | [`src/events/schema.js`](../src/events/schema.js) | [Envelope](#envelope) to [API](#api) |
| Context payload | [`src/events/context.js`](../src/events/context.js) | [Context payload](#context-payload) |
| Event bus | [`src/events/bus.js`](../src/events/bus.js) | [Event bus](#event-bus) |
| Outbound chat messages | [`src/events/chatMessage.js`](../src/events/chatMessage.js) | [Chat messages](#chat-messages) |
| Browser ↔ service | [`src/service/server.js`](../src/service/server.js), [`client.js`](../src/service/client.js) | [Transport](#transport) |

All of these are plain JS with no Node-only APIs, so the game and the service import the
same files.

## Envelope

Every event is a flat JSON object:

| Field  | Type    | Notes |
|--------|---------|-------|
| `v`    | `1`     | Schema version. Bump it on breaking changes. |
| `id`   | string  | Unique, max 64 chars. Generated (UUID) unless passed in. |
| `kind` | `"game"` \| `"chat"` | See below. |
| `ts`   | integer | Milliseconds since epoch at emission. Latency is measured from here. |

Unknown fields are rejected, so typos fail loudly instead of being ignored.

## Kinds

### `game`: something happened in the mini-game

```js
createGameEvent("win", { score: 12 })
// { v: 1, id: "…", kind: "game", ts: 1727760000000, name: "win", data: { score: 12 } }
```

- `name` must be a key of `GAME_EVENTS` (below).
- `data`: optional details. Flat object, max 8 keys. Values are strings (≤ 80 chars),
  finite numbers or booleans. No nesting.

`data` is the **only** game context the model ever sees (proposal: "AI boundary"), so keep it
to what a viewer could see on screen. No player identity, file paths or internal state.

### `chat`: the player typed a message to chat

```js
createChatEvent("  gg chat  ")
// { v: 1, id: "…", kind: "chat", ts: …, text: "gg chat" }
```

- `text` is trimmed, must not be empty, max 200 chars.
- Chat events have no importance. Every valid player message is eligible for a response.
- `spoken: true` marks something the player **said out loud** (the optional voice input,
  `createChatEvent(text, { spoken: true })`), not typed. Typed messages have no `spoken`
  field at all; when present it must be `true`. The context payload's facts carry it
  (`{ playerMessage, spoken: true }`), and the prompt says "said on stream" instead of
  "typed in chat". Spoken messages don't show as chat lines (the streamer's speech isn't
  chat); the game shows them as subtitles. The study never sends them (voice is off for
  `?session=` links).

## Game event catalog

`GAME_EVENTS` is the single source of each event's importance. The emitter does not choose
it, so the same event always routes the same way in both the AI and scripted conditions.

- **major**: may trigger one AI persona response
- **minor**: goes to a template (and is a candidate for coalescing)

`phrase` completes "&lt;streamer&gt; just ___" and is used by prompts and templates.

The mini-game is a top-down wave shooter (`src/game/shooter/game.js`). The names are kept
from the first draft, so the evaluation set and harness scenarios still apply; the phrases
describe the shooter. A cleared wave sends exactly one major event: `close_call` on low HP,
else `new_best` the first time a run passes the best wave of earlier runs, else `win`.

| Name | Importance | Phrase |
|------|-----------|--------|
| `round_start` | minor | started a new wave |
| `kill` | minor | took out an enemy |
| `damage_taken` | minor | took a hit |
| `item_pickup` | minor | bought an upgrade in the shop |
| `coin_purchase` | minor | spent chat's donations on coins |
| `expression` | minor | reacted on camera (optional camera, W11: `{expression}`) |
| `win` | major | cleared a wave |
| `loss` | major | died and lost the run |
| `streak` | major | went on a kill streak without getting hit |
| `close_call` | major | barely survived a wave on low health |
| `new_best` | major | reached their furthest wave yet |

To add an event: add an entry to `GAME_EVENTS`, add a row here and run `npm test`.

## API

| Function | Use |
|----------|-----|
| `createGameEvent(name, data?, {id?, ts?})` | Emit a game event. Throws `EventValidationError` if invalid. |
| `createChatEvent(text, {id?, ts?})` | Emit a player message. Throws if empty or too long. |
| `validateEvent(x)` | Check an event's shape. Returns `{ok: true}` or `{ok: false, errors: [{path, message}]}` and never throws. |
| `parseEvent(x)` | Like `validateEvent`, but on success also returns a frozen copy: `{ok: true, event}`. Use it on anything that crossed a boundary (e.g. parsed from a request). |
| `importanceOf(gameEvent)` | `"minor"` or `"major"` from the catalog. |

Pass fixed `id` and `ts` to get reproducible event sets (mock harness, evaluation event set).
Created events are frozen. Nothing downstream may change them.

## Context payload

`toContext(event)` turns a valid event into what the context builder receives:

```js
toContext(createGameEvent("win", { score: 12 }))
// {
//   eventId: "…", ts: 1727760000000, kind: "game",
//   name: "win", importance: "major",
//   facts: { event: "cleared a wave", details: { wave: 3, hp: 4, maxHp: 5 } }
// }

toContext(createChatEvent("is this boss hard?"))
// {
//   eventId: "…", ts: …, kind: "chat",
//   name: null, importance: null,
//   facts: { playerMessage: "is this boss hard?" }
// }
```

- **`facts` is the only part that may go into a prompt.** That is the proposal's AI boundary:
  the model gets the event or typed message, and nothing else.
- `eventId`, `ts`, `kind`, `name` and `importance` are for the service. They're used for
  routing, choosing templates, linking the reply back to its event (`chat_message.eventId`),
  and measuring latency from `ts`.
- `facts.event` is the catalog phrase, so it plugs straight into the existing persona
  prompts: `buildFanPrompt({ event: ctx.facts.event })`.
- The context builder, `buildPrompt(ctx, {persona, streamerName, history})` in
  [`src/ai/contextBuilder.js`](../src/ai/contextBuilder.js), turns the payload into the
  persona's system prompt and the user prompt.

The context builder may add things that aren't part of the event, such as the persona,
streamer name or recent chat history. Those are its own inputs, not part of this payload.

## Event bus

`createEventBus()` is the single way events enter the pipeline inside the service and the
mock harness.

```js
const bus = createEventBus({ onError: (err, event) => log(err, event) });
const off = bus.subscribe("game", (event) => router.handle(event)); // "game" | "chat" | "*"
bus.publish(rawEventFromBrowser); // -> {ok: true, event} | {ok: false, errors}
off();
```

- `publish` validates first. Invalid input is returned with its errors and never reaches a
  subscriber, which is how malformed events get dropped.
- Subscribers receive a **frozen copy**, never the caller's object.
- Dispatch is **synchronous**, in subscription order: kind-specific handlers first, then `"*"`.
  That keeps tests and harness runs deterministic. Handlers must not block. They should start
  async work such as generation and return.
- If a handler throws, the error goes to `onError` and the other handlers still run.

Coalescing and rate limits belong to the router (a subscriber), not to the bus.

## Chat messages

The service sends the UI `chat_message` objects (`createChatMessage`, `validateChatMessage`):

| Field | Type | Notes |
|-------|------|-------|
| `v` | `1` | Same schema version as events. |
| `id` | string | Message id. **Every streamed update of one message reuses it.** |
| `kind` | `"chat_message"` | |
| `ts` | integer | When this update was sent. |
| `eventId` | string \| `null` | The event this replies to, or `null` for ambient chat. |
| `persona` | `"fan"` \| `"hater"` \| `"backseat"` \| `"lurker"` | Used in both conditions (the proposal keeps persona labels the same). The UI uses it for avatar tags. |
| `viewer` | string | Display name, max 25 chars. |
| `source` | `"ai"` \| `"template"` \| `"scripted"` \| `"fallback"` | See below. |
| `text` | string | **Full text so far**, max 200 chars. Never empty. |
| `done` | boolean | `false` while a streamed message is still growing. |

**Streaming.** One message arrives as several updates with the same `id`, each carrying the
full text so far (not a delta). The UI shows the first update as a new line and replaces its
text on later ones. A dropped update can't garble the line, and the one with `done: true` is
final.

The service currently sends each model reply as a single update once it has been checked
(`streamPartials` off, see [docs/service.md](service.md#showing-replies)), so most messages
are one update with `done: true`. The UI should still handle several.

**`source`** is logged for the evaluation, which reports these separately:

- `ai`: generated by the model and passed the output filter
- `template`: a routine template (minor events)
- `scripted`: the scripted-chat baseline condition
- `fallback`: a safe template, used because generation was rejected or timed out

Text the filter rejected is never sent. The service sends a `fallback` message instead.

## Transport

Built in [`src/service/`](../src/service); details and the browser client in
[docs/service.md](service.md). **HTTP POST in, Server-Sent Events out**, because
both sides then need nothing beyond Node's built-in `http` module and the browser's
`fetch`/`EventSource`, keeping the repo dependency-free. Node has no built-in WebSocket
server.

| Direction | Endpoint | Body |
|-----------|----------|------|
| browser → service | `POST /events` | One event as JSON. `202 {ok: true}` or `400 {ok: false, errors}` (from `bus.publish`, or a body that isn't JSON). `413` over 8 KB. |
| service → browser | `GET /stream` (SSE) | `event: chat_message` with `data: <chat_message JSON>`, one per update. |

Everything runs on localhost.

## Edge cases (from the proposal)

| Case | Where it's handled |
|------|--------------------|
| Malformed event, unknown name | Schema: `validateEvent` rejects it, and it is dropped. |
| Empty / whitespace player input | Schema: rejected. |
| Oversized input | Schema: length and key limits. |
| Rapid bursts, repeated events | Router: coalescing (not part of the schema). |
| Irrelevant player input | Router / persona: it's valid input, so the schema accepts it. |
| Delayed generation, malformed or unsafe output | Service: timeout, filter, then a `fallback` chat message. |
| A subscriber crashes | Bus: reported to `onError`, other subscribers still run. |

## Limits

Events (`LIMITS`): chat 200 chars, `data` 8 keys, `data` strings 80 chars, id 64 chars.
Chat messages (`MESSAGE_LIMITS`): text 200 chars, viewer name 25 chars. These are provisional
and will be revisited after the laptop pilot, alongside the generation limits.

## Open questions for the team

1. **Which mini-game?** That decides the real catalog.
2. **Stat milestones and donations.** Should follower or donation milestones be game events,
   and how does a Fan donation reach the UI (a field on `chat_message`, or its own outbound
   kind)? Either way, the service decides the amount, never the model, and stats stay owned by
   the game and service.
3. **Transport.** Built as POST + SSE (above). Speak up in review if the game needs something else.
4. **Camera signal.** Done as an opt-in extension (W11): a catalog event, `expression`,
   with one word (`smiling`, `surprised`, `frowning`), not a third event kind, so nothing
   downstream changed. It's minor on purpose: chat answers it with fixed lines, so the
   model (and the Hater) never comments on the streamer's real face. Marked `optional`,
   so the evaluation set leaves it out. Raw frames never leave the browser tab.
