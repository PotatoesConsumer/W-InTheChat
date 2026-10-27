# Team status and handoff

Last updated 2026-10-12, after PR #11 (chat pipeline and service) and PR #12 (game loop and
chat overlay) were merged.

Written for the three of us **and for the AI assistants we work with**. AI assistant:
read this before starting a task, then check it against the code and `git log`. If
something here no longer matches the code, trust the code and say so.

## Where things stand

- `master` has the event contract, harness, evaluation set, deterministic and edge-case
  checks (Prin, #3–#8, #10), and the context builder (Sittipon, #9).
- The real chat pipeline and the local service are merged (#11): events in over HTTP,
  replies out over SSE, using `qwen2.5:3b`. End to end without the browser (`npm run e2e`),
  model replies reach the client in 211 / 430 ms at p50 / p95 on the RTX 4050.
- The game loop, input and chat overlay are merged (#12, Shapphanyu's work from `tawan`).
  `npm run dev` serves it on `localhost:5173`. It still answers chat with the placeholder
  `devChatFeed.js`; **connecting the game to the service is the main thing between us and
  the Month-1 demo.**
- **The mini-game hasn't been chosen.** The event catalog (`GAME_EVENTS` in
  `src/events/schema.js`) is still a placeholder until it is.

## Decisions already made

Don't change these without talking to the team first. The reasons are in the linked docs.

| Decision | Why | Details |
|----------|-----|---------|
| `qwen2.5:3b` only, no Qwen3 | Qwen3's thinking step couldn't be turned off and missed the latency budget | `CLAUDE.md` |
| The service sends each model reply **whole, once checked** (`streamPartials: false`); the game types it in | A line can't be taken back once shown, so streamed partials can't guarantee failed or unsafe text never appears | `docs/service.md`, "Showing replies" |
| Model replies run **one at a time** from a first-in, first-out queue, with deadlines counted from event arrival | One 6 GB GPU; and routing on "is the model busy" made the same events get different chat | `docs/service.md` |
| No routing decision may depend on timing | The same seed and events must give the same chat (`same-choices`) | `docs/pipeline-contract.md` |
| Chat history is not sent to the model (`historySize: 0`) | The model copied the history's format and invented follow-ups | `docs/service.md` |

## Shapphanyu (frontend / game): what's next

1. **Your W01 and W03 work is on `master`** (#12). Start new work from `master` on a
   `feature/...` branch; `tawan` is no longer needed.
2. **Connect the game to the service.** Replace `src/game/devChatFeed.js` with
   `connectToService` from `src/service/client.js` (example in `docs/service.md`). Run
   `npm run service` next to `npm run dev`; the service already allows the
   `localhost:5173` origin.
3. **Type replies in.** Each model reply now arrives as **one** `chat_message` update with
   `done: true`. Animate the text in (typewriter) so chat still "appears progressively",
   as the proposal asks. Keep handling multi-update messages too; the contract allows them.
4. **Player messages:** send what the player types with `chat.send(createChatEvent(text))`.
   The service answers it. The player's own line can stay a UI-only entry, as it is now.
5. **Stats model (W02/W04):** followers / donations / hype as a pure reducer,
   `{ initial, reduce }` (interface in `docs/pipeline-contract.md`). Register it in
   `statsModels` in `test/contracts/implementations.js` so the stats checks run.
6. **Scripted baseline switch (W07):** the service already has the condition:
   `npm run service -- --condition scripted`. The game needs a way to pick it.

## Prin (multimodal / QA): what changed in your area

These changes are on `master` (merged in #11):

1. **`same-choices` compares replies in event order** (`choices()` in
   `src/harness/checks.js`). When replies to different events overlap, the order they
   finish in depends on timers; on Windows that failed about 3 runs in 10 with identical
   chat. Now 10/10 locally. Unit test added in `test/harness/checks.test.js`.
2. **Edge cases can be `pending`** in `test/contracts/edgeCases.contract.test.js`. Each
   edge case has an `id`; a registered pipeline can list
   `pending: { <id>: "reason" }`, and those show as TODO with the reason. Unknown ids fail
   a test, so typos are caught.
3. **The service pipeline is registered** in `test/contracts/implementations.js`, with
   `unsafe` (needs the W07 filter) and `burst` (needs W06 coalescing) pending. Everything
   else passes: all scenarios, both conditions, slow / down / garbage model, bad input,
   malformed events.

Still open on your side: the Month-1 demo clip (W04) needs the game connected to the
service first.

## Sittipon (backend / AI): what's next

| Task | What's left |
|------|-------------|
| W05 | Hater, Backseat Gamer and Lurker prompts with written voice and safety rules; add them to `src/ai/personas/index.js` |
| W06 | Persona selector (today every reply is the Fan), coalescing and rate limits. Then remove `burst` from `pending` |
| W07 | The output safety filter in `src/service/replyCheck.js`. It must block all 13 `block` cases and allow all 16 `allow` cases in `eval/safety-cases-v1.json`. Register it in `filters`, then remove `unsafe` from `pending`. Needed before the Hater goes live. |
| W08 | Laptop pilot: set `replyTimeoutMs`, `maxTokens`, event rate and message caps from measured p50/p95 and peak GPU memory |

## Waiting on someone

| What | Waiting on |
|------|------------|
| Choosing the mini-game (fixes the event catalog, unblocks the M1 demo) | the whole team |
| Connecting the game to the service (M1 demo) | Shapphanyu |
