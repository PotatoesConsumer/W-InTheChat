# Event schema (v1, draft)

Everything that can make the chat react enters the pipeline as an **event**. The game
(browser) creates events. The local service validates them, then coalesces, routes and
answers them. The proposal requires this schema to exist before the context builder or
event routing is written.

Code: [`src/events/schema.js`](../src/events/schema.js). The game and the service import the
same file, so there is one definition.

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
| `validateEvent(x)` | Check anything that crossed a boundary (e.g. parsed from a request). Returns `{ok: true}` or `{ok: false, errors: [{path, message}]}` and never throws. |
| `importanceOf(gameEvent)` | `"minor"` or `"major"` from the catalog. |

Pass fixed `id` and `ts` to get reproducible event sets (mock harness, evaluation event set).
Created events are frozen. Nothing downstream may change them.

## Edge cases (from the proposal)

| Case | Where it's handled |
|------|--------------------|
| Malformed event, unknown name | Schema: `validateEvent` rejects it, and it is dropped. |
| Empty / whitespace player input | Schema: rejected. |
| Oversized input | Schema: length and key limits. |
| Rapid bursts, repeated events | Router: coalescing (not part of the schema). |
| Irrelevant player input | Router / persona: it's valid input, so the schema accepts it. |
| Delayed generation, malformed or unsafe output | Service: timeout, filter, safe template. |

## Limits

`LIMITS` in the code: chat 200 chars, `data` 8 keys, `data` strings 80 chars, id 64 chars.
These are provisional and will be revisited after the laptop pilot, alongside the generation
limits.

## Open questions for the team

1. **Which mini-game?** That decides the real catalog.
2. **Stat milestones.** Should follower or donation milestones be game events (the Fan "donates
   at milestones")? Stats stay owned by the game and service, and the model never changes them.
3. **Outbound contract.** Service → UI chat messages: persona, text, source
   (`ai` / `template` / `scripted`), triggering event id, streamed segments. This is the next
   schema to write.
4. **Transport.** How events get from the browser to the service: HTTP POST or WebSocket.
5. **Camera signal.** If the optional extension happens, it would add a third kind (a coarse
   expression signal as text). It is deliberately not in v1.
