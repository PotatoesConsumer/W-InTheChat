# Team status and handoff

Last updated 2026-11-01, for `feature/baseline-switch` (Shapphanyu's W07 scripted
baseline switch, merged with `master`). Before that: #13 (team status), #14 (Month-1
demo), #15 (persona prompts), #17 (persona selector, coalescing, rate limit), #18 (W08
regression pass and Month-2 demo guide) and #19 (safety filter, the Hater live,
player-chat coalescing fix) merged. Merged feature branches are deleted; only `master` and `tawan` remain.

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
  `npm run ai:personas`. The selector picks one per event (#17). **The Hater is live**
  since the output safety filter (W07): every reply is filtered before display, and a
  fallback replaces anything blocked (`docs/service.md`, "Reply check and safety filter").
- **The mini-game hasn't been chosen.** The event catalog (`GAME_EVENTS` in
  `src/events/schema.js`) is still a placeholder until it is.

## Week by week

The plan is 12 weeks in three segments of four, with one task per person each week. It's
the "W-InTheChat Rundown" (https://claude.ai/artifact/CAzFSbKuLLS5tV6Y2on9sK, ask Sittipon
for access); the state below is checked against the code and PRs, not just the Rundown's
ticks. Lanes are a suggested split, so swap tasks if that suits you better.

✅ done · 🟡 started or in a PR · ⬜ not started

**SEG 01, Core Engine (W01–W04).** Milestone M1: the Fan reacts live to gameplay, with
p50/p95 measured on the RTX 4050.

| Week | Sittipon (backend / AI) | Shapphanyu (frontend / game) | Prin (multimodal / QA) |
|------|-------------------------|------------------------------|------------------------|
| W01 | ✅ Ollama client wrapper (#1, #2) | ✅ Canvas loop and input (#12) | ✅ Repo scaffold, lint/format, CI, branch rules (#5) |
| W02 | ✅ Context builder (#9) | ✅ Streamer avatar, followers / donations / hype model (#14) | ✅ Event schema and bus contract (#3, #4) |
| W03 | ✅ Fan persona prompt and parser (first commit) | ✅ Chat overlay (#12) | ✅ Mock-event harness (#6) |
| W04 | ✅ Pipeline end to end, p50/p95 logged (#11, #14) | ✅ Hype meter, follower and donation counters (#14) | 🟡 Bug bash done (#14); the Month-1 demo clip isn't recorded yet |

**SEG 02, Four Personas & Baseline (W05–W08).** Milestone M2: four personas live behind
the safety filter, the mini-game playable start to finish, and the scripted baseline
switch running on the same events.

| Week | Sittipon (backend / AI) | Shapphanyu (frontend / game) | Prin (multimodal / QA) |
|------|-------------------------|------------------------------|------------------------|
| W05 | ✅ Hater, Backseat Gamer, Lurker prompts with voice and safety rules (#15) | ✅ Typed player chat into the pipeline (#14) | ✅ Fixed evaluation event set (#7) |
| W06 | ✅ Persona selector, coalescing, rate limit (#17); minor events to templates (#11) | ✅ Replies typed in whole, once checked (#14) | ✅ Deterministic checks (#8) |
| W07 | ✅ Output safety filter, the Hater live (#19); fallbacks (#11) | ✅ Scripted baseline switch: study panel (F2) and `?condition=`, `POST /condition`, scripted lines per persona (this branch) | ✅ Edge-case checks and safety test set (#10) |
| W08 | ⬜ Laptop pilot: message cap, output length, event rate, timeout from p50/p95 | ⬜ Mini-game wired to AI reactions and the 3 stats; **blocked until the team picks the mini-game** | ✅ Month-2 demo prep, full regression pass (#18): `npm run regression`, `docs/demo-m2.md` |

**SEG 03, Study & Report (W09–W12).** Milestone M3: a locally runnable prototype, AI vs
scripted chat compared with real participants, p50/p95 reported, report ready to defend.
Nothing here has started.

| Week | Sittipon (backend / AI) | Shapphanyu (frontend / game) | Prin (multimodal / QA) |
|------|-------------------------|------------------------------|------------------------|
| W09 | ⬜ Full pipeline benchmark: first text and completion p50/p95, peak GPU memory | ⬜ Overlay and stats polish, per-persona styling | ⬜ Study materials (questionnaire, consent, counterbalanced order); pilot session |
| W10 | ⬜ Prompt tuning from pilot logs (hosted API only if local is still too slow) | ⬜ Fixes from the pilot; sound and reaction effects | ⬜ Participant sessions, about 15–20 people, both conditions |
| W11 | ⬜ Variety metrics (repeat rate, distinct-2), latency and failure analysis | ⬜ Optional: MediaPipe expression signal behind an opt-in | ⬜ Blind rating: relevance 1–5, persona identification, confusion matrix |
| W12 | ⬜ Setup docs: Ollama install, model pull, prompt versions | ⬜ Short demo video, final UI fixes | ⬜ Evaluation report, defense rehearsal |

So far: 21 done, 1 started, 14 not started (counting this branch). `npm test` has no TODO
tests left.

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
3. **Scripted baseline switch (W07), in a PR from `feature/baseline-switch`:**
   - The game: **F2** opens a study panel (hidden from participants) with AI chat /
     Scripted chat. Picking one reloads with `?condition=...`, so stats and chat start
     fresh; the game sets that condition on the service before the round starts.
   - The service: `GET`/`POST /condition` restarts the pipeline in the other
     condition (`src/service/server.js`); switching to ai loads the model first.
   - The scripted baseline now uses **the same persona selector** as the ai condition,
     with per-persona lines (`SCRIPTED_LINES` in `src/service/templates.js`). Before,
     every scripted line was the Fan's, so the two conditions didn't show the same
     persona labels. **Sittipon: please review the `pipeline.js` / `server.js` part.**

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
3. **The service pipeline is registered** in `test/contracts/implementations.js`, and
   now nothing is `pending`: `burst` passes since W06 and `unsafe` since the safety
   filter, which is also registered in `filters` (13/13 block, 16/16 allow). Your
   regression pass (#18) should show those as passing, not ⏸ known.

Still open on your side: **record the Month-1 demo clip (W04).** The game is connected
now; `docs/demo-m1.md` has the run steps, a shot list and the first bug bash (fixed bugs
and known issues). Add anything else you find there.

**W08 is done (#18).** Run `npm run regression` (add `-- --model` with Ollama running)
before every demo and after big merges; reports go in `docs/regression/`. Next up: W09
study materials.

## Sittipon (backend / AI): what's next

| Task | What's left |
|------|-------------|
| W05 | Done (#15). Known weaknesses for a later prompt pass are in `docs/personas.md`; the Backseat Gamer's advice can name real actions once the mini-game is chosen |
| W06 | Done (#17): persona selector, coalescing by event timestamps, and a rate limit that delays lines instead of dropping them. Since this branch, player messages only coalesce when the same text repeats (a quick follow-up question used to get no reply, #18 finding 1) |
| W07 | Done: the safety filter (#19), `src/service/safetyFilter.js`, registered in `filters`, the Hater in `aiPersonas`. Scripted lines per persona came with Shapphanyu's switch (this branch, #18 finding 2) |
| Prompt pass | From #18's real-model samples: the Fan invented a score, the Lurker answered a 5-kill streak with "hi". Also decide whether template lines stay all-Fan (#18 finding 3) |
| W08 | Laptop pilot: set `replyTimeoutMs`, `maxTokens`, event rate and message caps from measured p50/p95 and peak GPU memory |

## Waiting on someone

| What | Waiting on |
|------|------------|
| Choosing the mini-game (fixes the event catalog and the game scene) | the whole team |
| Whether `tawan` can be deleted (fully merged) | Shapphanyu |
| Recording the Month-1 demo clip | Prin (or anyone) |
| W08 findings 3 and 5 (template lines all Fan, reply quality) in `docs/demo-m2.md`; 1 was fixed in #19, 2 and 4 on this branch | Sittipon |
