# W-InTheChat

Browser streamer simulator (KMUTT CS senior project). Viewers in the chat are generated live by a
local LLM reacting to game events and player messages. The spec is proposal v2
(`W-InTheChat_proposal_2.docx`, 2026-09-30; not in the repo yet). It overrides the older
`CS-project-proposal 1.docx` / `StreamerSimPresent 1.pdf` wherever they disagree.

The MVP needs a switch to a scripted-chat baseline: the evaluation compares AI chat against it
on the same events.

## Setup

- Ollama must be running (`http://localhost:11434`) with the model pulled:
  `ollama pull qwen2.5:3b`
- Node >= 20. No dependencies yet.
- Model weights are never committed (Qwen Research License).
- `OLLAMA_HOST` / `OLLAMA_MODEL` are read from the shell environment. Nothing loads `.env`
  yet, so copying `.env.example` to `.env` has no effect.

## Commands

- `npm run ai:demo`: sends sample events through the Fan persona, prints the replies and
  p50/p95 latency.

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

Current practice: work on `feature/*` branches and open a PR into `master`. Prin owns the
branch conventions, so follow theirs once written.
