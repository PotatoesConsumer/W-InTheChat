# Full pipeline benchmark (W09)

The Rundown's W09 task for Sittipon: the full pipeline, event to first text and to
completion at p50/p95, and peak GPU memory, with the game running in Chrome. These are
the latency numbers for the report; the limits came from the laptop pilot
(`docs/pilot-w08.md`).

## How it was run

The real game in Chrome, played by the bot, through the real service and model:

1. `npm run service` and `npm run dev`.
2. `npm run benchmark -- --minutes 10`. It restarts the service's pipeline so the stats
   start fresh, prints the bot URL, waits for the first reply, then samples the GPU with
   nvidia-smi every 250 ms while the bot plays, and reads the service's stats at the end.
3. Open the URL it prints in Chrome and keep the tab in front (a hidden tab pauses the
   game). The bot, `src/game/shooter/bot.js`, plays through the game's own input path,
   the same one the keyboard and mouse use. It's the same bot as the pilot's: it aims at
   the nearest enemy, backs away from close ones, shops for 6 s between waves, and types
   a player message every 25 s. When it's done, the page logs `witc.benchmark()`: the
   browser's own numbers, from sending each event to its reply arriving over SSE.

`npm run benchmark -- --idle-test` calls the model with the same prompt after 0, 1, 3,
6 and 12 s idle, and reads the GPU's clock and power state just before each call.

Laptop: RTX 4050 6 GB, Ryzen 7, 32 GB, Windows 11, on AC power, model warm. qwen2.5:3b
through Ollama 0.40.13, limits from `PIPELINE_DEFAULTS` (`replyTimeoutMs` 3000,
`maxTokens` 32). Run on 2026-11-01.

## Results: 10 minutes in Chrome

Bot skill 0.6, seed 1. It played 600 s of game in 618 s of wall time (no throttling),
reached wave 5, died along the way, and sent 24 player messages.

| | p50 | p95 | max | n |
|---|---|---|---|---|
| **AI reply**, browser: event sent to reply received | **507 ms** | **721 ms** | 808 ms | 67 |
| AI reply, service: event ts to reply sent | 502 ms | 719 ms | 804 ms | 67 |
| Template line, browser | 6 ms | 17 ms | 32 ms | 179 |
| Template line, service | 2 ms | 7 ms | 12 ms | 179 |

- **First text = completion**: replies are sent whole, once checked
  (`streamPartials: false`), so the time to first text is the time to the whole reply.
  The game then types the line in, about 22 ms a character, at most 1.1 s
  (`typeInDelay`); that is display, not waiting, and isn't counted.
- **No failures**: 0 fallbacks, 0 timeouts, nothing rejected. The slowest reply used
  27% of the 3 s timeout.
- 181 events were coalesced (no message); 246 got one.
- **GPU memory: 2165 of 6141 MiB at p50, p95 and max**, the same as the headless pilot.
  The model takes 2063 MiB. Chrome added nothing measurable on the RTX: this laptop also
  has an integrated GPU, and the browser most likely draws on that. Not confirmed here.
- GPU use p50 0%, p95 75%; graphics clock p50 210 MHz, p95 2610 MHz.

## Why replies here are slower than in `npm run e2e`

The pilot found replies at about 500 ms p50 in the game against 211–269 ms in
`npm run e2e`, and guessed the idle GPU was the cause. The idle test confirms it.
8 calls per gap, the Fan on `win`:

| Idle before the call | Call ms p50 / p95 | ms per token p50 / p95 | GPU clock before (MHz) | Power state |
|---|---|---|---|---|
| 0 s | 199 / 264 | 13 / 15 | 2610 | P0 (P8 once) |
| 1 s | 209 / 410 | 13 / 14 | 2610 | P0 |
| 3 s | 448 / 510 | 30 / 32 | 525 | P4 |
| 6 s | 510 / 552 | 34 / 42 | 210 | P5, P8 |
| 12 s | 482 / 593 | 29 / 41 | 210 | P8 |

After about 2 s with nothing to do, the GPU drops to a low-power state and its clock to
210–525 MHz. The next reply then runs about 2.4× slower per token. The e2e test sends
an event every 1.5 s, so the GPU never slows down; the game calls the model about
every 8 s (the pilot measured 6.6–8.2 calls a minute), so almost every reply starts on
a slow GPU.

**What it means for the study:** ~500 ms p50 / ~720 ms p95 is the honest number for this
game on this laptop, and it's well inside the 3 s timeout. Ways to get the faster
numbers, for the team to decide (W10), none of them done here. **Decided in W10:
accept ~500 ms**, with the NVIDIA setting as an optional setup step
(`docs/team-status.md`, "Decisions already made"):

- Set the NVIDIA power setting for Ollama to "prefer maximum performance". It's a
  per-machine system setting, so it would go in the setup docs (W12), and every study
  laptop would need it.
- Keep the GPU busy with a tiny model request every second or so. It costs power and
  heat, and the warm-up calls would queue with real replies (one generation at a time).
- Accept ~500 ms. Templates cover minor events instantly, and the game types each reply
  in over up to a second anyway.

## For the report

- **Event to AI reply in chat, in Chrome with the game running: 507 ms p50, 721 ms p95**
  (n=67, 10 min). Templates: 6 ms p50.
- Peak GPU memory 2.2 of 6 GB, so a 6 GB laptop has plenty of room.
- Replies are about 2.4× slower when the GPU has been idle, and in this game it almost
  always has been.

## What this doesn't cover

- A bot, not a person. Prin's W09 pilot session with people should check that the event
  rate and the chat feel the same.
- One laptop, one 10-minute run, English chat. The p95 from 67 replies is a rough figure.
- The Chrome measured is the app's built-in browser pane (Chromium). Desktop Chrome is
  expected to behave the same; rerun the benchmark there for the final report.
