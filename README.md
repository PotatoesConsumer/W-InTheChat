# W-InTheChat

A web-based streamer simulator with a real-time, AI-powered audience.

Instead of scripted/random chat messages, viewers are driven by a local LLM
(`qwen2.5:3b` via [Ollama](https://ollama.com)) that reacts to key in-game events
and to messages the player types, through distinct viewer personas: **Fan**,
**Hater**, **Backseat Gamer**, and **Lurker**. A scripted-chat baseline mode is
included for comparison.

## Status

Early-stage senior project (KMUTT, Computer Science). The spec is the
[proposal](<CS-project-proposal 1.docx>). The
[pitch deck](<StreamerSimPresent 1.pdf>) is from an earlier plan and is out of
date; where it disagrees with the proposal, the proposal wins.

## Requirements

- [Ollama](https://ollama.com) installed locally, with the model pulled:
  ```bash
  ollama pull qwen2.5:3b
  ```
  Model weights are not included in this repo (Qwen Research License).
- Node.js >= 20
- Google Chrome

## Running

```bash
npm run dev
```

Serves the game on <http://localhost:5173> (open it in Chrome). The scene is a
placeholder until the mini-game is chosen: WASD/arrows move, Space sends a kill, keys 1–5
send the major events (win, loss, close call, streak, new best), Enter focuses the chat
box and Escape leaves it. The top bar shows followers, donations, the hype meter and the
reply latency.

```bash
npm run service
```

Runs the local chat service on <http://127.0.0.1:8787>, which the game talks to: it posts
events to `/events` and reads replies from `/stream`. Run it next to `npm run dev`; without
it the game still runs but chat stays empty ("chat offline" in the top bar).
`npm run e2e` measures end-to-end latency with the real model. See
[docs/service.md](docs/service.md) and, for the Month-1 demo, [docs/demo-m1.md](docs/demo-m1.md).

```bash
npm run ai:demo
```

Sends sample events through the Fan persona and prints the replies with p50/p95
latency. Send one request first if the model isn't loaded yet; a cold load can
exceed the client's 15 s timeout.

```bash
npm install
npm run check
```

Installs the dev tools, then runs lint, the format check and the unit tests (no Ollama needed).
The event schema is documented in [docs/events.md](docs/events.md). See
[CONTRIBUTING.md](CONTRIBUTING.md) for branch and PR conventions.

## Tech stack

- HTML5 Canvas + JS for the game loop, running in Chrome on localhost
- Ollama REST API (`http://localhost:11434`) for chat generation
- Optional extensions (opt-in, off by default): MediaPipe Face Landmarker for
  expression signals from the webcam, Chrome Web Speech for voice input

## Team

- Sittipon Pimparat (67130500867)
- Shapphanyu Phaniphat (67130500866)
- Prin Phakanon (67130500845)
