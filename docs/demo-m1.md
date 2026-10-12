# Month-1 demo

How to run the Month-1 demo, what the clip should show, and what the bug bash found.
The milestone (proposal, M1): **the game loop with chat overlay running end to end, with
the Fan persona answering game events and the player's chat.**

## Run it

Two terminals, with Ollama running and `qwen2.5:3b` pulled:

```bash
npm run service
```

```bash
npm run dev
```

Open <http://localhost:5173> in Chrome. The top-right pill turns to **chat live** once the
game is connected to the service; the round starts then ("here we go" in chat).

| Key | Event | Goes to |
|-----|-------|---------|
| Space | `kill` | template line (minor) |
| 1 | `win` | Fan reply from the model |
| 2 | `loss` | Fan reply |
| 3 | `close_call` | Fan reply |
| 4 | `streak` | Fan reply |
| 5 | `new_best` | Fan reply |
| Enter, type, Enter | player chat | Fan reply |

These keys are placeholders until the mini-game is chosen and emits the events itself.

In the browser console, `witc.latency()` gives p50/p95 from the game's send to the reply
(overall and by source), `witc.rows()` the raw rows and `witc.stats()` the current stats.
The service prints its own p50/p95 when you stop it with Ctrl+C.

For the scripted baseline, run `npm run service -- --condition scripted` instead: same
game, scripted lines, no model calls.

## Shot list for the clip

About a minute, screen recording of the browser window (Win+Alt+R with Xbox Game Bar, or
OBS):

1. Both terminals running, then the game with **chat live**.
2. Move the box, Space a few times: template lines appear at once.
3. 1 (win): the Fan line types in, the streamer's face cheers, followers go up with a
   "+N" pop-up, the hype meter fills.
4. 3 (close call) and 2 (loss): different replies, the face reacts (shocked, sad), hype
   drops on the loss.
5. 4 and 5 until hype passes 50: donations start coming in.
6. Type a message to chat ("chat was that boss hard?"): the player line with the ADMIN
   badge, then a Fan reply to it.
7. Point at the latency readout in the top bar (p50/p95).
8. Optional: stop the service; the pill turns to **chat offline** and the game keeps
   running. Start it again; it reconnects on its own.

## Bug bash (2026-10-12)

Run in Chrome against `npm run service` with `qwen2.5:3b` on the RTX 4050 laptop.

Measured from the game (send to finished reply, `witc.latency()`, one session of 11
events with 1.5 s gaps): model replies **267 / 515 ms** p50 / p95 (n=7), templates 7 ms
p50 (n=4). Three major events sent at once queue behind each other (one generation at a
time), so the last one lands after about 1.2 s.

| Found | Fix |
|-------|-----|
| The "+N" follower and "+$N" donation pop-ups covered the next stat's label | Wider gaps between stats, pop-ups placed right of the value |
| The top bar wrapped onto two lines under about 1000 px (title, status pill) | Top bar stays on one line; the latency readout hides under 1100 px |
| Typed-in replies crawled in a background tab (timers throttled to once a second) | Typing follows elapsed time, not timer ticks |
| An emoji could show half a character while typing in | Typing goes by code point |
| `docs/service.md` called `overlay.apply()`, which doesn't exist | Now `overlay.push()` |

Known, not fixed:

- Fan replies to player chat sometimes talk about "the next player" instead of the
  streamer. Prompt work, W05.
- Every reply is the Fan; the other personas come in W05/W06.
- Pressing the same key several times within one frame counts once (the input sees one
  press per frame). Not noticeable at 60 fps.
- If the service stops between connecting and the round starting, that `round_start`
  is lost (the game doesn't resend events).
