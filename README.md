# W-InTheChat

A web-based streamer simulator with a real-time, AI-powered audience.

Instead of scripted/random chat messages, viewers are driven by a local LLM
(`qwen2.5:3b` via [Ollama](https://ollama.com)) that reacts to key in-game events
and to messages the player types, through distinct viewer personas: **Fan**,
**Hater**, **Backseat Gamer**, and **Lurker**. A scripted-chat baseline mode is
included for comparison.

## Status

Early-stage senior project (KMUTT, Computer Science). The current spec is
[`W-InTheChat_proposal_2.docx`](W-InTheChat_proposal_2.docx). The original
[`CS-project-proposal 1.docx`](<CS-project-proposal 1.docx>) and
[`StreamerSimPresent 1.pdf`](<StreamerSimPresent 1.pdf>) are kept for reference;
where they disagree with v2, v2 wins.

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
npm run ai:demo
```

Sends sample events through the Fan persona and prints the replies with p50/p95
latency. Send one request first if the model isn't loaded yet; a cold load can
exceed the client's 15 s timeout.

## Tech stack

- HTML5 Canvas + JS for the game loop, running in Chrome on localhost
- Ollama REST API (`http://localhost:11434`) for chat generation
- Optional extensions (opt-in, off by default): MediaPipe Face Landmarker for
  expression signals from the webcam, Chrome Web Speech for voice input

## Team

- Sittipon Pimparat (67130500867)
- Shapphanyu Phaniphat (67130500866)
- Prin Phakanon (67130500845)
