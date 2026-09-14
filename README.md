# W-InTheChat

A web-based streamer simulator with a real-time, AI-powered audience.

Instead of scripted/random chat messages, viewers are driven by a local LLM
(Qwen 2.5 / Qwen3 via [Ollama](https://ollama.com)) that reacts in real time to
the player's in-game actions, voice (Web Speech API), and facial expression
(webcam + a vision model), through distinct viewer personas: **Fan**, **Hater**,
**Backseat Gamer**, and **Lurker**.

## Status

Early-stage senior project (KMUTT, Computer Science). See
[`CS-project-proposal 1.docx`](<CS-project-proposal 1.docx>) and
[`StreamerSimPresent 1.pdf`](<StreamerSimPresent 1.pdf>) for the full proposal
and pitch deck.

## Requirements

- [Ollama](https://ollama.com) installed locally, with a model pulled, e.g.:
  ```bash
  ollama pull qwen2.5:3b
  ollama pull moondream   # for facial/vision reactions
  ```
- Google Chrome (for Web Speech API support)
- Node.js
- A webcam and microphone (for voice/vision features)

## Tech stack

- HTML5 Canvas + JS for the game loop
- Ollama REST API (`http://localhost:11434`) for chat generation
- Web Speech API for speech-to-text
- A local vision model (e.g. Moondream2) for facial reaction analysis
- Deploy target: Vercel / GitHub Pages

## Team

- Sittipon Pimparat (67130500867)
- Shapphanyu Phaniphat (67130500866)
- Prin Phakanon (67130500845)
