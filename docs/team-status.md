# Team status and handoff

Last updated 2026-10-27, after #13 (team status), #14 (Month-1 demo) and #15 (persona
prompts) merged. Merged feature branches are deleted; only `master` and `tawan` remain.

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
- **The game talks to the service** (#14): `npm run service` + `npm run dev`
  is the Month-1 demo. Whole replies are typed in; the top bar has followers, donations,
  the hype meter and the reply p50/p95; a facecam avatar reacts to events. Keys 1–5 send
  the major events. `devChatFeed.js` is gone. Run guide, clip shot list and bug bash:
  `docs/demo-m1.md`.
- **All four personas have prompts** (#15): Hater, Backseat Gamer and Lurker join the
  Fan, with voice and safety rules in `docs/personas.md` and a trial,
  `npm run ai:personas`. The service still answers as the Fan until the selector (W06).
- **The mini-game hasn't been chosen.** The event catalog (`GAME_EVENTS` in
  `src/events/schema.js`) is still a placeholder until it is.

## Week by week

Each of us numbers our own board tasks W01, W02, …, so the same week can hold different
work per person. Built from the W-tags in commits and docs and checked against the code;
the board itself isn't in the repo, so weeks with no tag anywhere are marked "not in
repo". Fill those in when you know them.

✅ done · ⬜ not started · ❓ not in repo

| Week | Sittipon (backend / AI) | Prin (QA / tooling) | Shapphanyu (frontend / game) |
|------|-------------------------|---------------------|------------------------------|
| W01 | ✅ Ollama client wrapper (#1, #2) | ✅ Event schema (#3), lint/format/CI (#5) | ✅ Game loop and input (#12) |
| W02 | ✅ Context builder (#9) | ✅ Event bus and chat message contract (#4) | ✅ Stats model (#14, written by Sittipon) |
| W03 | ✅ Fan persona and latency demo (first commit, tagged W01–W04) | ✅ Mock-event harness (#6) | ✅ Chat overlay (#12) |
| W04 | ✅ Chat pipeline, service, e2e latency (#11); game connected to the service (#14) | ⬜ Month-1 demo clip (run guide and shot list in `docs/demo-m1.md`) | ✅ Stats HUD, facecam, Month-1 demo (#14) |
| W05 | ✅ Hater, Backseat Gamer and Lurker prompts, trial (#15) | ✅ Evaluation event set (#7) | ❓ Probably the mini-game, blocked until it's chosen |
| W06 | ⬜ Persona selector, coalescing, rate limits (`burst` edge case is TODO) | ✅ Deterministic checks (#8) | ❓ |
| W07 | ⬜ Safety filter (`unsafe` edge case and both filter tests are TODO); full scripted baseline | ✅ Edge-case checks and safety test set (#10) | ⬜ Scripted-baseline switch in the game |
| W08 | ⬜ Laptop pilot: limits from measured p50/p95 and GPU memory | ❓ | ❓ |

The 4 TODO tests in `npm test` are all Sittipon's W06–W07.

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

1. **Your W01–W04 is done** (#12, plus #14, which Sittipon wrote with the team's OK; it's
   your area, so read through it). Start new work from `master` on a `feature/...`
   branch. `tawan` is fully merged into `master` but still on GitHub; say if it can be
   deleted. What's in #14:
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
| W05 | Done (#15). Known weaknesses for a later prompt pass are in `docs/personas.md`; the Backseat Gamer's advice can name real actions once the mini-game is chosen |
| W06 | Persona selector (today every reply is the Fan), coalescing and rate limits. Then remove `burst` from `pending` |
| W07 | The output safety filter in `src/service/replyCheck.js`. It must block all 13 `block` cases and allow all 16 `allow` cases in `eval/safety-cases-v1.json`. Register it in `filters`, then remove `unsafe` from `pending`. Needed before the Hater goes live. |
| W08 | Laptop pilot: set `replyTimeoutMs`, `maxTokens`, event rate and message caps from measured p50/p95 and peak GPU memory |

## Waiting on someone

| What | Waiting on |
|------|------------|
| Choosing the mini-game (fixes the event catalog and the game scene) | the whole team |
| Whether `tawan` can be deleted (fully merged) | Shapphanyu |
| Recording the Month-1 demo clip | Prin (or anyone) |
