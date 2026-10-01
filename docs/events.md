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
| Browser ↔ service | (not built yet) | [Transport](#transport-proposed) |

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

## Game event catalog

`GAME_EVENTS` is the single source of each event's importance. The emitter does not choose
it, so the same event always routes the same way in both the AI and scripted conditions.

- **major**: may trigger one AI persona response
- **minor**: goes to a template (and is a candidate for coalescing)

`phrase` completes "&lt;streamer&gt; just ___" and is used by prompts and templates.

> **Draft.** The mini-game isn't chosen yet. These entries are placeholders based on the pitch
> deck's loop ("scores a kill, takes damage, finds loot"). Replace them once the game is fixed.

| Name | Importance | Phrase |
|------|-----------|--------|
| `round_start` | minor | started a new round |
| `kill` | minor | took out an enemy |
| `damage_taken` | minor | took a hit |
| `item_pickup` | minor | picked up an item |
| `win` | major | won the round |
| `loss` | major | lost the round |
| `streak` | major | went on a streak |
| `close_call` | major | barely survived |
| `new_best` | major | beat their personal best |

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
//   facts: { event: "won the round", details: { score: 12 } }
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

**`source`** is logged for the evaluation, which reports these separately:

- `ai`: generated by the model and passed the output filter
- `template`: a routine template (minor events)
- `scripted`: the scripted-chat baseline condition
- `fallback`: a safe template, used because generation was rejected or timed out

Text the filter rejected is never sent. The service sends a `fallback` message instead.

## Transport (proposed)

This isn't built yet. The proposal is **HTTP POST in, Server-Sent Events out**, because
both sides then need nothing beyond Node's built-in `http` module and the browser's
`fetch`/`EventSource`, keeping the repo dependency-free. Node has no built-in WebSocket
server.

| Direction | Endpoint | Body |
|-----------|----------|------|
| browser → service | `POST /events` | One event as JSON. `202 {ok: true}` or `400 {ok: false, errors}` (from `bus.publish`). |
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
3. **Transport.** Confirm POST + SSE (above), or pick something else before the service is built.
4. **Camera signal.** If the optional extension happens, it would add a third event kind (a
   coarse expression signal as text). It is deliberately not in v1.
