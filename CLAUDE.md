# W-InTheChat

Browser streamer simulator (KMUTT CS senior project). Viewers in the chat are generated live by a
local LLM reacting to game events and player messages. The spec is the proposal
(`CS-project-proposal 1.docx`). `StreamerSimPresent 1.pdf` is an earlier pitch deck and
is out of date (Qwen3, vision model, Vercel deploy); where it disagrees, the proposal wins.

The MVP needs a switch to a scripted-chat baseline: the evaluation compares AI chat against it
on the same events.

**Before starting a task, read `docs/team-status.md`.** It says what changed recently, what
each of us is doing next, and which design decisions are settled (whole replies instead of
streamed partials, one generation at a time, no timing-based routing). When a task changes
any of that, update the file in the same PR.

## Setup

- Ollama must be running (`http://localhost:11434`) with the model pulled:
  `ollama pull qwen2.5:3b`
- Node >= 20, then `npm install`. Dev dependencies only (ESLint, Prettier); the runtime
  code has no dependencies.
- Model weights are never committed (Qwen Research License).
- `OLLAMA_HOST` / `OLLAMA_MODEL` are read from the shell environment. Nothing loads `.env`
  yet, so copying `.env.example` to `.env` has no effect.

## Commands

- `npm run ai:demo`: sends sample events through the Fan persona, prints the replies and
  p50/p95 latency.
- `npm run ai:personas`: the persona prompt trial: every persona on fixed events with the
  real model, replies flagged for known weaknesses, counts and p50/p95. Guide:
  `docs/personas.md`.
- `npm run service`: the chat service on `http://127.0.0.1:8787` with the real model
  (`--condition scripted` for the baseline). `npm run e2e`: end-to-end latency over HTTP + SSE.
  Guide: `docs/service.md`.
- `npm test`: runs `test/**/*.test.js` with Node's built-in test runner. Doesn't need Ollama.
- `npm run lint` / `npm run format`: ESLint and Prettier.
- `npm run check`: lint + format check + tests, the same as CI. Run it before opening a PR.
- `npm run harness -- <scenario>`: plays a scenario into the pipeline headless with a fake
  model (no game, no Ollama). `--list` shows scenarios. Guide: `docs/harness.md`.
- `npm run pilot`: the W08 laptop pilot: a bot plays the wave shooter into the pipeline
  with the real model at real time; latency, reply length, chat rate, GPU memory, checks
  and rejected replies. Results and the limits set from them: `docs/pilot-w08.md`.
- `npm run benchmark -- --minutes 10`: the W09 benchmark: with `npm run service` and
  `npm run dev` running, it prints a `?bot=` URL to open in Chrome, then samples the GPU
  with the browser drawing and reads the service's latency. `--idle-test`: model calls
  after 0-12 s idle. Results: `docs/benchmark-w09.md`.
- `npm run regression [-- --model]`: full regression pass (static checks, every scenario ×
  fake-model mode × condition through the registered pipeline, comparisons, optionally the
  real model). Writes `docs/regression/<date>.md`, exits 1 on a regression. Run it before
  demos. Guide: `docs/regression/README.md`.

## Model

- Use only `qwen2.5:3b`. Do not switch to Qwen3: it runs a thinking step before every
  reply that `/no_think` and `think:false` did not turn off, so it misses the latency budget.
- A cold model load can take longer than the client's 15 s timeout. Warm the model with a
  request first before measuring latency.
- A hosted LLM API is a documented fallback only. Don't implement it unless asked; if it is
  added it must be off by default and require player consent.

## Layout

- `src/ai/ollamaClient.js`: Ollama REST wrapper (health, retry/backoff, timeout, model select)
- `src/ai/contextBuilder.js`: `buildPrompt(ctx, {persona, streamerName, history})`, the
  context payload -> `{system, prompt}` for one persona reply. Uses only `ctx.facts`.
- `src/ai/personas/`: one file per persona (system prompt), registered in `index.js` with
  the shared parser from `parse.js`. Voice and safety rules: `docs/personas.md`. All four
  are in the service's `aiPersonas`; every reply passes the safety filter first.
- `src/ai/demo.js`: latency smoke test
- `src/ai/personaTrial.js`: the persona trial's inputs and weakness checks (CLI in
  `scripts/persona-trial.js`)
- `src/events/`: the event contract, spec in `docs/events.md`
  - `schema.js`: inbound game + chat events, catalog, validation. The game catalog is a draft
    until the mini-game is chosen.
  - `context.js`: `toContext(event)`, the context builder's input. Only its `facts` may go
    into a prompt.
  - `bus.js`: in-process event bus (validates on publish, synchronous dispatch)
  - `chatMessage.js`: outbound service -> UI chat messages (persona, source, streamed updates)
- `src/service/`: the chat service, spec in `docs/service.md`
  - `pipeline.js`: bus -> chat_message updates. Repeats are coalesced, minor events get
    templates, major events and player chat get a model reply from the persona the selector
    picks (sent whole, once checked; the game types it in), failures get a fallback. Model
    replies run one at a time from a FIFO queue, with deadlines from event arrival. No
    timing-based routing: the same seed and events must give the same chat.
  - `selector.js`: weighted persona choice per event (`PERSONA_WEIGHTS`)
  - `coalesce.js`: runs of repeated events, measured with the events' own timestamps.
    Player messages count as repeats only when the text is the same.
  - `pacer.js`: the chat rate limit; delays lines, never drops them
  - `server.js`: POST /events, GET /stream (SSE), /health, /stats, GET/POST /condition
    (the baseline switch: restarts the pipeline in ai or scripted). Localhost only.
  - `client.js`: browser side for the game (`connectToService`)
  - `replyCheck.js`: rejects malformed replies and anything the safety filter blocks
  - `safetyFilter.js`: the output safety filter (slurs, threats, self-harm, doxxing,
    sexual, protected groups, personal attacks; play criticism and game violence pass).
    `blocklist.js` holds salted hashes, never the words; add one with
    `node scripts/blocklist-hash.js <word> <category>`.
  - `templates.js`: template / scripted / fallback lines and viewer names. Needs lines for
    every `GAME_EVENTS` name, and scripted lines per persona for every major one (tests
    check). Scripted replies use the same persona selector as ai ones.
- `src/game/`: browser game (`index.html` loads `main.js`)
  - `main.js`: wires it together. Every event goes on the local bus (stats, HUD and
    facecam react) and to the chat service through `connectToService`; replies come back
    over SSE into the overlay. `?service=<url>` changes the service URL. Runs the hub,
    one keymap per game plus the menu keys, and the mouse. `?bot=<skill>` (with
    `&seed=`, `&minutes=`) lets `shooter/bot.js` play Wave Survival through the same
    input path, for the benchmark only; `witc.benchmark()` reports the run.
  - `hub.js`: the game hub and pause menu as plain state (tested), and **the game
    module interface** every mini-game implements. `hubView.js` draws them;
    `games.js` lists the games. More games are planned: add one there.
  - `shooter/`: Wave Survival (W08), a top-down wave shooter. `index.js` is the hub
    module (keys, mouse, drawing); `game.js` the state and rules with no DOM (tested;
    seeded random), which says which catalog event fires when; `waves.js` makes each
    wave harder; `shop.js` upgrades and the coin store (donations buy coin packs and
    are spent: `coin_purchase`); `view.js` draws it and the shop's click layout.
  - `loop.js`: fixed-timestep loop (injectable clock/rAF for tests)
  - `input.js`: keyboard -> actions; ignores keys typed into the chat box
  - `donations.js`: viewer donations: which big moments bring one, the amount (mostly
    under $10, $20+ rare) and the donor's message, seeded from the event id so the stats
    stay deterministic. Shown in chat as UI-only `kind: "donation"` lines. `random.js`:
    the seeded random and string hash.
  - `stats.js`: followers / donations / hype as a pure reducer (`stats.initial/reduce`),
    registered in the contract tests. The model's replies never reach it.
  - `streamer.js`: the facecam avatar; mood from events (tested), `draw()` on the canvas
  - `effects.js`: stream reactions over any game: a banner on big moments, a shake on a
    hit, donation alerts by the facecam (state tested, `draw()` on the canvas).
    `sound.js`: Web Audio sound effects per event, no audio files; M or the top-bar
    button mutes.
  - `expression.js` + `camera.js`: the optional camera (W11), off until the player opts
    in with the top-bar button and a consent prompt. MediaPipe Face Landmarker (loaded
    from a CDN, pinned, only when turned on; CPU, not the GPU) gives blendshape scores in
    the tab; only one word (smiling / surprised / frowning) leaves it, as the minor,
    `optional` catalog event `expression`. The facecam shows the live camera (this
    screen only); frames are never saved or sent.
    `witc.camera()` shows live scores for tuning `EXPRESSION_RULES`.
  - `replyLatency.js`: p50/p95 from the game's send to the reply, shown in the top bar
    and in the console as `witc.latency()`
- `src/ui/`: chat overlay and HUD. `chatLog.js` is the DOM-free state (streamed updates by
  id), `chatOverlay.js` renders it (textContent only, persona avatar tags, sticky scroll,
  whole replies typed in), `statsHud.js` the follower/donation counters and hype meter,
  `studyPanel.js` the researcher's condition switch (F2, hidden by default; reloads with
  `?condition=ai|scripted`).
  The player's own lines are UI-only entries (`kind: "player"`, name "Player", ADMIN badge),
  not chat_messages. No login or name setting yet.
- `scripts/serve.js`: `npm run dev` static server on localhost:5173 (no dotfiles/node_modules)
- `src/harness/`: mock-event harness (Node only). `scenario.js` (format), `runner.js`
  (plays a scenario, returns a JSON run record), `fakeGenerator.js` (OllamaClient stand-in
  with normal/slow/error/garbage/unsafe modes), `stubPipeline.js` (deliberately naive
  stand-in until the real pipeline exists; never use it in the game), `checks.js`
  (deterministic checks over a run record; rules in `docs/pipeline-contract.md`),
  `edgeCases.js` (the proposal's edge cases, shared by the contract suite and the
  regression pass), `shooterBot.js` (plays the wave shooter headless and records its
  events as a scenario, for the pilot), `regression.js` (regression matrix, verdicts, report),
  `scenarios/*.json`.
  CLI in `scripts/harness.js`.
- `eval/`: fixed evaluation event sets (scenario format), the output filter test set
  `safety-cases-v1.json` (no slurs in the repo: the filter tests its own blocklist), and
  `manifest.json` (draft/frozen, sha256). Never edit a frozen set; make a new version.
  Guides: `docs/evaluation.md`, `docs/pipeline-contract.md`.
- `test/`: unit tests, mirroring `src/`. `test/contracts/` runs the checks against what's
  registered in `implementations.js`: the service pipeline (nothing `pending` now), the
  stats model and the safety filter. A new gap can be listed in `pending` until it's done.

## Rules from the proposal

- Write the event schema before implementing the context builder or event routing.
- Hater mocks plays, never people: no slurs, threats or attacks on protected groups.
  Generated text is filtered before display, and a safe template replaces anything that
  is rejected or times out.
- The model only gets the event/message context it needs. No file access, and it never
  changes game state or stats.
- Camera and mic features are optional extensions: off by default, opt-in, and raw
  frames or audio are never stored or sent to a model.
- Latency is reported as p50/p95.

## Team tracks

- Sittipon: backend / AI (`src/ai/`)
- Shapphanyu: frontend / game (Canvas loop, overlay, stats)
- Prin: multimodal / QA (repo tooling, event bus contract, mock-event harness)

## Git

Follow `CONTRIBUTING.md`: branch as `feature/` / `fix/` / `docs/` / `chore/` from `master`,
never push to `master`, run `npm run check`, then open a PR for a teammate to review.
