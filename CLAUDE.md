# W-InTheChat

Browser streamer simulator (KMUTT CS senior project). Viewers in the chat are generated live by a
local LLM reacting to game events and player messages. The spec is the proposal
(`CS-project-proposal 1.docx`). `StreamerSimPresent 1.pdf` is an earlier pitch deck and
is out of date (Qwen3, vision model, Vercel deploy); where it disagrees, the proposal wins.

The MVP needs a switch to a scripted-chat baseline: the evaluation compares AI chat against it
on the same events.

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
- `npm test`: runs `test/**/*.test.js` with Node's built-in test runner. Doesn't need Ollama.
- `npm run lint` / `npm run format`: ESLint and Prettier.
- `npm run check`: lint + format check + tests, the same as CI. Run it before opening a PR.
- `npm run harness -- <scenario>`: plays a scenario into the pipeline headless with a fake
  model (no game, no Ollama). `--list` shows scenarios. Guide: `docs/harness.md`.

## Model

- Use only `qwen2.5:3b`. Do not switch to Qwen3: it runs a thinking step before every
  reply that `/no_think` and `think:false` did not turn off, so it misses the latency budget.
- A cold model load can take longer than the client's 15 s timeout. Warm the model with a
  request first before measuring latency.
- A hosted LLM API is a documented fallback only. Don't implement it unless asked; if it is
  added it must be off by default and require player consent.

## Layout

- `src/ai/ollamaClient.js`: Ollama REST wrapper (health, retry/backoff, timeout, model select)
- `src/ai/personas/`: one file per persona (system prompt, prompt builder, response parser).
  Only `fan.js` exists; Hater, Backseat Gamer and Lurker are still to come.
- `src/ai/demo.js`: latency smoke test
- `src/events/`: the event contract, spec in `docs/events.md`
  - `schema.js`: inbound game + chat events, catalog, validation. The game catalog is a draft
    until the mini-game is chosen.
  - `context.js`: `toContext(event)`, the context builder's input. Only its `facts` may go
    into a prompt.
  - `bus.js`: in-process event bus (validates on publish, synchronous dispatch)
  - `chatMessage.js`: outbound service -> UI chat messages (persona, source, streamed updates)
- `src/harness/`: mock-event harness (Node only). `scenario.js` (format), `runner.js`
  (plays a scenario, returns a JSON run record), `fakeGenerator.js` (OllamaClient stand-in
  with normal/slow/error/garbage/unsafe modes), `stubPipeline.js` (deliberately naive
  stand-in until the real pipeline exists; never use it in the game), `checks.js`
  (deterministic checks over a run record; rules in `docs/pipeline-contract.md`),
  `scenarios/*.json`.
  CLI in `scripts/harness.js`.
- `eval/`: fixed evaluation event sets (scenario format) + `manifest.json` (draft/frozen,
  sha256). Never edit a frozen set; make a new version. Guide: `docs/evaluation.md`.
- `test/`: unit tests, mirroring `src/`. `test/contracts/` runs the checks against the real
  pipeline / stats model once they're registered in `implementations.js` (TODO until then).

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
