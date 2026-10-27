# Team status and handoff

Last updated 2026-10-12, for the Month-1 demo branch (`feature/m1-demo`): the game is
connected to the service, with stats, HUD and facecam. #11 (chat pipeline and service) and
#12 (game loop and chat overlay) are merged.

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
- **The game talks to the service** (`feature/m1-demo`): `npm run service` + `npm run dev`
  is the Month-1 demo. Whole replies are typed in; the top bar has followers, donations,
  the hype meter and the reply p50/p95; a facecam avatar reacts to events. Keys 1–5 send
  the major events. `devChatFeed.js` is gone. Run guide, clip shot list and bug bash:
  `docs/demo-m1.md`.
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

1. **Your W01–W04 is done** (#12, plus `feature/m1-demo`, which Sittipon wrote with the
   team's OK; please review it, it's your area). Start new work from `master` on a
   `feature/...` branch; `tawan` is no longer needed. What's in it:
   - `src/game/stats.js`: followers / donations / hype as a pure reducer, registered in
     `statsModels`, so `stats-valid` and `same-stats` run. The numbers are a first pass;
     tune `STAT_RULES` once the mini-game is chosen.
   - `src/ui/statsHud.js`: counters with "+N" pop-ups and the hype meter, in the top bar.
   - `src/game/streamer.js`: the facecam avatar, mood from events.
   - `src/ui/chatOverlay.js`: whole replies are typed in (`typeInDelay`); streamed
     updates still work.
   - `src/game/main.js`: events go to the stats and to the service; keys 1–5 are dev
     shortcuts for the major events.
2. **The mini-game.** When it's chosen, emit its events from the game instead of keys
   1–5, and replace the placeholder box scene. The facecam can stay.
3. **Scripted baseline switch (W07):** the service already has the condition:
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

Still open on your side: **record the Month-1 demo clip (W04).** The game is connected
now; `docs/demo-m1.md` has the run steps, a shot list and the first bug bash (fixed bugs
and known issues). Add anything else you find there.

## Sittipon (backend / AI): what's next

| Task | What's left |
|------|-------------|
| W05 | Done on `feature/personas`: Hater, Backseat Gamer and Lurker prompts, registered; rules, trials and known weaknesses in `docs/personas.md` |
| W06 | Persona selector (today every reply is the Fan), coalescing and rate limits. Then remove `burst` from `pending` |
| W07 | The output safety filter in `src/service/replyCheck.js`. It must block all 13 `block` cases and allow all 16 `allow` cases in `eval/safety-cases-v1.json`. Register it in `filters`, then remove `unsafe` from `pending`. Needed before the Hater goes live. |
| W08 | Laptop pilot: set `replyTimeoutMs`, `maxTokens`, event rate and message caps from measured p50/p95 and peak GPU memory |

## Waiting on someone

| What | Waiting on |
|------|------------|
| Choosing the mini-game (fixes the event catalog and the game scene) | the whole team |
| Reviewing `feature/m1-demo` (game ↔ service, stats, HUD, facecam) | Shapphanyu |
| Recording the Month-1 demo clip | Prin (or anyone) |
