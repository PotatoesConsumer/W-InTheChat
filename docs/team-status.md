# Team status and handoff

Last updated 2026-11-11, for `feature/w09-w12-polish` (Shapphanyu's W09–W12 overlay
polish, study panel fix, sound and effects, optional camera, draft demo clip). Before
that: #13 (team status), #14 (Month-1 demo), #15 (persona prompts), #17 (persona
selector, coalescing, rate limit), #18 (W08 regression pass and Month-2 demo guide), #19
(safety filter, the Hater live, player-chat coalescing fix), #20 (scripted baseline
switch), #21/#22 (wave shooter, game hub, coin store), #23 (W08 laptop pilot, limits),
#24 (W09 full pipeline benchmark, `docs/benchmark-w09.md`) and #25 (status) merged.
Merged branches are deleted, `tawan` included.

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
- **The game opens on a game hub**, since we plan more than one mini-game
  (#21, merged through #22). The first is **Wave Survival**, a top-down wave shooter
  (Shapphanyu's pick): waves that get harder, a shop between waves, and a coin store
  where donations buy coin packs. It sends the catalog events itself; the old names
  are kept with phrases that describe the shooter, plus one new event,
  `coin_purchase` (`docs/events.md`).

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
| W07 | ✅ Output safety filter, the Hater live (#19); fallbacks (#11) | ✅ Scripted baseline switch: study panel (F2) and `?condition=`, `POST /condition`, scripted lines per persona (#20) | ✅ Edge-case checks and safety test set (#10) |
| W08 | ✅ Laptop pilot: `npm run pilot`, limits set from it (#23, `docs/pilot-w08.md`) | ✅ Wave shooter wired to AI reactions and the 3 stats (#21, #22) | ✅ Month-2 demo prep, full regression pass (#18): `npm run regression`, `docs/demo-m2.md` |

**SEG 03, Study & Report (W09–W12).** Milestone M3: a locally runnable prototype, AI vs
scripted chat compared with real participants, p50/p95 reported, report ready to defend.
Sittipon's W09 benchmark (#24) and Shapphanyu's W09 polish are done, and Shapphanyu has
started W10–W12; Prin's study work and Sittipon's W10–W12 haven't started.

| Week | Sittipon (backend / AI) | Shapphanyu (frontend / game) | Prin (multimodal / QA) |
|------|-------------------------|------------------------------|------------------------|
| W09 | ✅ Full pipeline benchmark in Chrome: AI reply 507 / 721 ms p50 / p95, GPU 2.2 of 6 GB; the idle GPU explains the slower replies (#24, `docs/benchmark-w09.md`) | ✅ Overlay polish (`feature/w09-w12-polish`): **the study panel showed at startup** (fixed, see below), coin store layout, Lurker lines dimmed | ⬜ Study materials (questionnaire, consent, counterbalanced order); pilot session |
| W10 | ⬜ Prompt tuning from pilot logs (hosted API only if local is still too slow) | 🟡 Sound and reaction effects done (`feature/w09-w12-polish`); fixes from Prin's pilot session once it has run | ⬜ Participant sessions, about 15–20 people, both conditions |
| W11 | ⬜ Variety metrics (repeat rate, distinct-2), latency and failure analysis | 🟡 Optional camera done (`feature/w09-w12-polish`): opt-in MediaPipe expression signal, tested with Chrome's fake camera; thresholds to tune on a real face | ⬜ Blind rating: relevance 1–5, persona identification, confusion matrix |
| W12 | ⬜ Setup docs: Ollama install, model pull, prompt versions | 🟡 Draft clip and shot list (`docs/demo-final.md`); the final video after the participant sessions | ⬜ Evaluation report, defense rehearsal |

So far: 25 done, 4 started (Prin's W04 demo clip, Shapphanyu's W10–W12), 7 not started.
SEG 02 is complete; SEG 03 has started. `npm test` has no TODO
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

0. **W09–W12 in `feature/w09-w12-polish`:**
   - **Bug, important for the study: the study panel (AI chat / Scripted chat) was visible
     at startup** since #20. `.study-panel { display: flex }` beat the `hidden`
     attribute, so participants could see their condition. Fixed with a global
     `[hidden] { display: none !important }` in `overlay.css`, and a test guards it.
     **Prin: check this before the pilot session**; any session run on `master` before
     this merge showed the panel.
   - Reaction effects (`src/game/effects.js`): "WAVE CLEARED!" / "CLOSE CALL!" /
     "NEW BEST!" / "N KILL STREAK!" banners, a screen shake on a hit, and a donation
     alert by the facecam. Sound (`src/game/sound.js`): Web Audio blips per event and a
     donation chime, no audio files; M or the top-bar button mutes. Both react to bus
     events, so the same events give the same effects in both conditions.
   - Coin store: the pack price buttons overlapped "Back to the shop"; fixed. Lurker
     lines are dimmer than the rest of chat (per-persona styling).
   - W12: a 75 s draft clip and the shot list for the real video (`docs/demo-final.md`).
     **Warm the model before recording: the first load took 84 s.**
   - **W11, the optional camera:** a "camera off" button in the top bar asks for
     consent, then MediaPipe Face Landmarker reads the webcam in the tab (CPU, so the
     model keeps the GPU) and turns blendshapes into one word: smiling, surprised or
     frowning (`src/game/expression.js`, `camera.js`). The facecam copies it, and at
     most every 8 s it goes to chat as a new **minor** catalog event, `expression`.
     Minor on purpose: chat answers with fixed lines, so the model (and the Hater)
     never comments on the streamer's real face. The facecam shows the live camera
     on this screen only; frames are never saved or sent. If the camera drops (Iriun),
     the button says so; it's off on every page load. **Team calls:** MediaPipe loads from a CDN
     (pinned 0.10.14, about 6 MB, only when turned on), an exception to "no runtime
     dependencies"; and it's marked `optional`, so the evaluation set leaves it out:
     keep it off in the study. Thresholds are a first guess: tune `EXPRESSION_RULES`
     with `witc.camera()` on a real face.

1. **Your W01–W04 is done** (#12, plus #14, which Sittipon wrote with the team's OK; it's
   your area, so read through it). Start new work from `master` on a `feature/...`
   branch. `tawan` was fully merged and has been deleted, with your OK. What's in #14:
   - `src/game/stats.js`: followers / donations / hype as a pure reducer, registered in
     `statsModels`, so `stats-valid` and `same-stats` run. The numbers are a first pass;
     tune `STAT_RULES` once the mini-game is chosen.
   - `src/ui/statsHud.js`: counters with "+N" pop-ups and the hype meter, in the top bar.
   - `src/game/streamer.js`: the facecam avatar, mood from events.
   - `src/ui/chatOverlay.js`: whole replies are typed in (`typeInDelay`); streamed
     updates still work.
   - `src/game/main.js`: events go to the stats and to the service; keys 1–5 are dev
     shortcuts for the major events.
2. **The mini-game (W08), merged (#21, #22)**: a top-down wave shooter in
   `src/game/shooter/`. Keys 1–5 and the box scene are gone.
   - Each wave has more enemies, spawning faster, with more HP and speed; bats from
     wave 3, brutes from wave 5 (`waves.js`).
   - The shop between waves (`shop.js`): six items for coins. Enemies drop coins. The
     coin store sells coin packs for donations like a mobile currency store ($10 = 25
     up to $100 = 330, bigger packs give a bonus). **Donations are now a balance:**
     a purchase sends `coin_purchase {pack, dollars, coins}` and `stats.js` takes the
     dollars off (never below 0).
   - **Game hub and pause menu** (`hub.js`, `hubView.js`, `games.js`): the stream
     opens on the hub; Esc or P pauses (resume, restart run, quit to hub), and so
     does leaving the window. `hub.js` documents the module interface a new game
     implements; `shooter/index.js` is the example.
   - Events (`game.js`): a cleared wave is `close_call` on low HP (40% of max or less),
     else `new_best` when a run first passes an earlier run's best wave, else `win`;
     `streak` every 10 kills without a hit; `loss` on death; `item_pickup` for a
     purchase; `round_start` per wave.
   - **Everyone: the catalog phrases changed** to describe waves (`src/events/schema.js`),
     so prompts now say "cleared a wave" instead of "won the round". Sittipon: the
     persona trial's `lossAsWin` check now keys on the event name. Prin: the
     evaluation set is still a draft; its `data` (score, round) could use the
     shooter's fields (wave, hp, maxHp) before it's frozen. I added one
     `coin_purchase` step to it (at 42 s), since the set must cover every event.
   - **Donations are rarer and smaller** (`src/game/donations.js`): a big moment brings
     one by chance (15–50%, by hype; none below 30), mostly $1–9, $20+ about 1 in 50,
     each with a donor name and a fixed message shown in chat. Drawn from a random
     seeded with the event id, so `same-stats` still holds. Not sent to the chat
     service yet, so the AI doesn't react to donations.
   - The rest of `STAT_RULES` is untouched; tune it after playing (every kill adds 4 hype).
3. **Scripted baseline switch (W07), #20 from `feature/baseline-switch`:**
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
| W06 | Done (#17): persona selector, coalescing by event timestamps, and a rate limit that delays lines instead of dropping them. Since #19, player messages only coalesce when the same text repeats (a quick follow-up question used to get no reply, #18 finding 1) |
| W07 | Done: the safety filter (#19), `src/service/safetyFilter.js`, registered in `filters`, the Hater in `aiPersonas`. Scripted lines per persona came with Shapphanyu's switch (#20, #18 finding 2) |
| Prompt pass | From #18's real-model samples: the Fan invented a score, the Lurker answered a 5-kill streak with "hi". Also decide whether template lines stay all-Fan (#18 finding 3) |
| W08 | Done (#23): `npm run pilot` (a bot plays the shooter into the real model) and `replyTimeoutMs` 3000, `minGenerationMs` 800, `maxTokens` 32 from its numbers (`docs/pilot-w08.md`) |
| W09 | Done (#24): `npm run benchmark` with the bot in Chrome (`?bot=`): AI reply 507 / 721 ms p50 / p95, templates 6 ms, GPU 2.2 of 6 GB. Idle test: after ~2 s idle the GPU clocks down and replies run 2.4× slower per token, which is why the game is slower than `npm run e2e` (`docs/benchmark-w09.md`) |
| W10 | Prompt tuning from pilot logs, plus a team decision on the idle GPU (NVIDIA power setting, keeping it warm, or accepting ~500 ms; `docs/benchmark-w09.md`) |

## Waiting on someone

| What | Waiting on |
|------|------------|
| A look at the wave shooter before the catalog and evaluation set are frozen | the whole team |
| OK for W11's CDN exception, and keeping the camera off in the study | the whole team |
| Fixes from the pilot session with people (W10) | Prin's W09 pilot, then Shapphanyu |
| Whether half the kills going without a chat line is fine for the study (`docs/pilot-w08.md`, finding 1) | the whole team |
| Tightening `QA_LIMITS` with the pilot's numbers (`docs/pilot-w08.md`, finding 5) | Prin |
| Recording the Month-1 demo clip | Prin (or anyone) |
| W08 findings 3 and 5 (template lines all Fan, reply quality) in `docs/demo-m2.md`; 1 was fixed in #19, 2 and 4 in #20 | Sittipon |
