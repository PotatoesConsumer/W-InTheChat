# Setup

Everything runs on one laptop: the game in Chrome, the chat service in Node, and the
model in Ollama. Nothing goes to the internet once it's installed. This is the setup
used for every number in the report.

## What you need

| | Used for the report | Minimum |
|---|---|---|
| Laptop | RTX 4050 Laptop 6 GB, Ryzen 7, 32 GB RAM, Windows 11, on AC power | An NVIDIA GPU with 4 GB free. The model takes about 2.1 GB of VRAM (`docs/benchmark-w09.md`) |
| Ollama | 0.40.13 | A recent version |
| Model | `qwen2.5:3b` | The same model. Don't use Qwen3: its thinking step can't be turned off and misses the latency budget (`CLAUDE.md`) |
| Node.js | 22.14 | 20 or newer |
| Browser | Chrome | Chrome or another Chromium browser |

## Install (once)

1. **Ollama.** Install it from <https://ollama.com>. It runs in the background after
   installing (tray icon on Windows). Check that it's up:
   ```bash
   ollama list
   ```
2. **The model,** about 1.9 GB:
   ```bash
   ollama pull qwen2.5:3b
   ```
   The weights are under the Qwen Research License and are never committed to the repo.
3. **The project:**
   ```bash
   git clone https://github.com/PotatoesConsumer/W-InTheChat.git
   cd W-InTheChat
   npm install
   ```
   `npm install` brings only dev tools (ESLint, Prettier). The game and the service use
   no runtime packages. The only exception is the optional camera, which loads
   MediaPipe from a CDN when it's turned on; the study keeps it off.
4. **Check it:**
   ```bash
   npm test
   npm run e2e
   ```
   `npm test` doesn't need Ollama. `npm run e2e` sends events through the real model
   and prints p50/p95. Expect about 200–450 ms on an RTX 4050.

`OLLAMA_HOST` (default `http://localhost:11434`) and `OLLAMA_MODEL` (default
`qwen2.5:3b`) are read from the shell environment. Nothing reads a `.env` file.

## Run

Two terminals:

```bash
npm run service
```

```bash
npm run dev
```

Then open <http://localhost:5173> in Chrome. The service warms the model before it
listens. **The first load after a reboot can take over a minute** (84 s once), so start
the service before anything you're timing or recording. For the study, run the service
as `npm run service -- --log study-logs` and follow `docs/study/protocol.md`.

The scripted baseline doesn't need Ollama: `npm run service -- --condition scripted`.

## Optional: faster replies with the NVIDIA setting

After about 2 s with nothing to do, the GPU drops to a low-power clock, and the next
reply runs about 2.4× slower: ~500 ms instead of ~200 ms (`docs/benchmark-w09.md`). The
game calls the model every few seconds, so most replies start on a slow GPU. The team
accepted ~500 ms (`docs/team-status.md`, "Decisions already made"), so this step is
optional, and **the study runs without it** so all participants get the same setup.

To try it: NVIDIA Control Panel → Manage 3D settings → Program Settings → add Ollama
from its install folder → Power management mode: **Prefer maximum performance**. This
hasn't been tested on the study laptop. Measure before and after with:

```bash
npm run benchmark -- --idle-test
```

Ollama may run the model in a separate process from its install folder, which might need
the setting too. If the idle test doesn't change, that's the likely reason.

## Prompt versions

The prompts are code: `src/ai/personas/` (one file per persona, plus `game.js`, the game
description they share). A prompt version is the git commit. Every evaluation run
(`npm run eval:runs`) and every session log (`npm run service -- --log`) records it,
and `npm run study:analyze` prints it per condition. A version ending in `+changes`
means the prompts had uncommitted edits: don't use those runs in the report.

| Version | Date | What changed | Trial |
|---|---|---|---|
| Fan only | 2026-10-12 | The Fan persona (#11, #14) | `npm run ai:demo` |
| Four personas | 2026-10-27 | Hater, Backseat Gamer and Lurker, voice and safety rules (#15); the Hater went live behind the safety filter (#19) | `docs/personas.md`, "Trials with qwen2.5:3b" |
| Wave shooter | 2026-11-11 | Every prompt describes the shooter; the Fan answers questions; the Backseat names real actions and is cut at 15 words (#29) | `docs/personas.md`, "Prompt pass for the wave shooter" |

Freeze the prompts before the participant sessions (`docs/study/protocol.md`). After
that, a change is a new version, reported apart.

## When something's wrong

| Symptom | Cause and fix |
|---|---|
| `Ollama not reachable` when the service starts | Ollama isn't running. Start it from the Start menu, or `ollama serve` |
| `Model "qwen2.5:3b" not found` | `ollama pull qwen2.5:3b` |
| "chat offline" in the game's top bar | The service isn't running, or is on another port. Start `npm run service`; the page reconnects by itself |
| The first replies are fallback lines | The model was still loading. Wait for the service's ready line, and warm it before timing anything |
| `EADDRINUSE` on 8787 or 5173 | Something else has the port. Close it, or `npm run service -- --port 8788` and open the game with `?service=http://127.0.0.1:8788` |
| Replies take ~500 ms instead of ~200 ms | The idle GPU (above). Expected |
| The study panel shows at startup | You're on a version from before #26. Pull `master` |
