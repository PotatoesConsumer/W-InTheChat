# Laptop pilot (W08)

The Rundown's W08 task for Sittipon: set the message cap, output length, event rate and
timeout from measured p50/p95 on the target laptop, before the W09 benchmark and the
study. The proposal asks the team to "benchmark the complete game pipeline on the target
laptop before setting a numerical latency acceptance threshold".

## How it was run

`npm run pilot` plays the wave shooter into the chat pipeline at real time:

1. **A bot plays the game** (`src/harness/shooterBot.js`): the real game logic from
   `src/game/shooter/`, headless. It aims at the nearest enemy (less accurately at lower
   skill), backs away from enemies that get close, spends 6 s in the shop between waves,
   restarts 4 s after dying, and types a player message every 25 s (lines from the
   evaluation set). The same seed gives the same game.
2. **Every event goes into the registered pipeline** (`test/contracts/implementations.js`)
   with **qwen2.5:3b through Ollama**, at real time, through the harness runner, so all 16
   checks judge the run.
3. **nvidia-smi samples the GPU** every 250 ms.

Laptop: RTX 4050 6 GB, Ryzen 7, 32 GB, on AC power, model warm. Ollama 0.40.13,
Windows 11.

```bash
npm run pilot -- --minutes 5 --seed 2 --skill 0.9
```

Options: `--minutes`, `--seed`, `--skill` (0–1), `--chat-every` (seconds),
`--set key=value` to try a different `PIPELINE_DEFAULTS` limit, `--out` to save the
report. The report lists any model reply the reply check or the safety filter rejected.

## Results (2026-11-01)

Three 5-minute runs with the old limits (`replyTimeoutMs` 5000, `maxTokens` 48,
`minGenerationMs` 500). Runs 1 and 3 are the same game (seed 1); only `maxTokens` differs.

| | Run 1: bot skill 0.6 | Run 2: bot skill 0.9 | Run 3: as run 1, `maxTokens` 32 |
|---|---|---|---|
| Events | 202 (40/min): 21 major, 12 chat, 169 minor; wave 5 | 242 (48/min): 29 major, 12 chat, 201 minor; wave 6 | as run 1 |
| Model calls | 33 (6.6/min) | 41 (8.2/min) | 33 |
| Model call time p50 / p95 / max | 541 / 781 / 803 ms | 491 / 651 / 694 ms | 467 / 675 / 754 ms |
| Event to AI reply shown, p50 / p95 / max (queue included) | 576 / 803 / 925 ms | 518 / 673 / 860 ms | 489 / 755 / 933 ms |
| Tokens per reply p50 / p95 / max | 17 / 24 / 24 | 15 / 23 / 25 | 16 / 21 / 23 |
| Replies that hit `maxTokens` | 0 | 0 | 0 |
| Fallbacks | 0 | 1 (the safety filter blocked a reply) | 0 |
| Chat lines: template / AI | 87 / 33 | 76 / 40 | 87 / 33 |
| Coalesced (no message) | 82 | 125 | 82 |
| Peak new messages in 1 s | 3 | 3 | 3 |
| GPU memory, max | 2165 of 6141 MiB (model 2063) | same | same |
| Checks | 16/16 | 16/16 | 16/16 |

## Limits set from it

In `PIPELINE_DEFAULTS` (`src/service/pipeline.js`):

| Limit | Was | Now | Why |
|-------|-----|-----|-----|
| `replyTimeoutMs` | 5000 | **3000** | The slowest of 107 replies took 933 ms from the event, queue time included. 3 s is over 3× that, which leaves room for Chrome drawing the game on the same GPU, and a stuck reply now falls back after 3 s instead of 5 s. |
| `minGenerationMs` | 500 | **800** | Model calls took up to 781 ms at p95. A reply with less time left than that would most likely time out, so it gets its fallback at once. |
| `maxTokens` | 48 | **32** | The longest reply was 25 tokens; none came near 48. 32 cuts nothing and still stops a runaway reply sooner. Run 3 was not faster because of it: no reply reached either cap, so the difference from run 1 is run-to-run variation. |

Kept as they are:

| Limit | Value | Why |
|-------|-------|-----|
| `maxMessagesPerSecond` | 4 | The peak was 3 new lines in a second, so the pacer never had to hold one back. |
| `coalesceWindowMs`, `repeatReplyEvery`, `maxRepliesPerRun` | 2000 ms, 5, 3 | They keep the chat to about 24 lines a minute (15–17 template, 7–8 AI) at 40–48 events a minute. See the first finding. |
| `maxGenerationsInFlight` | 1 | GPU memory stayed at 2.2 of 6.1 GB, so a second model isn't the limit; one generation at a time is a settled decision for determinism, not memory. |

### Confirmation run with the new limits

Run 2's game (seed 2, bot skill 0.9, the busiest) again with the new defaults, 5 min:

| | Run 2, old limits | Confirmation, new limits |
|---|---|---|
| Model call time p50 / p95 / max | 491 / 651 / 694 ms | 457 / 658 / 709 ms |
| Event to AI reply shown, p50 / p95 / max | 518 / 673 / 860 ms | 485 / 709 / 903 ms |
| Tokens per reply max; hit `maxTokens` | 25; 0 | 25; 0 of 41 |
| Fallbacks | 1 (safety filter) | 0; no reply rejected |
| Peak new messages in 1 s | 3 | 3 |
| Checks | 16/16 | 16/16 |

The slowest reply (903 ms) used under a third of the new 3000 ms timeout.

## Findings for the team

1. **About half of the minor events get no chat line.** Kills come 1–2 s apart, so most
   of a wave is one run of repeats: 82 of 169 minor events in run 1 and 125 of 201 in
   run 2 were coalesced. The chat still gets a line every 2–3 s. If it feels quiet during
   waves in the study, raise `repeatReplyEvery` (more lines per run, up to the QA cap of
   3) rather than shortening the window. *Team decision before the study.*
2. **Model replies are slower here than in the e2e test** (p50 about 500 ms against
   211–269 ms in `npm run e2e`). The GPU sits idle between the game's sparse model calls
   (GPU use p50 0%) while the e2e test keeps it busy. A GPU that slows down when idle
   would explain it, but that's a guess; the W09 benchmark should measure it. All
   replies are still well inside the new 3 s timeout.
3. **The safety filter worked live once**: 1 of 41 replies in run 2 was blocked and a
   fallback shown. The pilot now lists rejected replies in its report, so the next run
   shows what was blocked.
4. **GPU memory has plenty of headroom**: 2.2 of 6.1 GB, the model 2.1 of it. That was
   headless; Chrome drawing the game uses more.
5. **`QA_LIMITS` in `src/harness/checks.js` are still provisional** (Prin's). With these
   numbers, `replyTimeoutMs` could come down from 10 000 ms. Mind that a burst of
   fallbacks is paced at 4 a second, so a check limit right at 3000 ms could fail on
   pacing alone. *Prin to decide.*

## What this pilot doesn't cover

- **A bot is not a person.** It shops for exactly 6 s and types every 25 s. The W09
  benchmark and the pilot session with people (Prin's W09) should check the event rate.
- **Headless:** no browser drew the game. Chrome on the same GPU may slow replies.
- **One laptop, English chat only.** Thai replies aren't checked by the filter yet.
