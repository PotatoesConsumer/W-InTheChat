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
game is connected to the service. The stream opens on the **game hub**: pick a game
(arrows or A/D, then Space, or click it), then Space starts the run ("here we go" in
chat). **Esc** or **P** pauses (resume, restart the run, quit to the hub); switching
to another window pauses too.

The first game is **Wave Survival** (W08, `src/game/shooter/`), a top-down wave shooter.
Each wave has more, tougher and faster enemies; bats join from wave 3 and brutes from
wave 5. Between waves the shop sells upgrades for coins. Enemies drop coins, and the
**coin store** sells coin packs for donations, like a mobile game's currency store:
$10 = 25, $25 = 70, $50 = 150, $100 = 330 coins. Donations spent there are gone from
the top bar.

| Control | What it does |
|---------|--------------|
| Space | Start the run (title screen), next wave (shop), go again (game over) |
| WASD | Move |
| Arrow keys, or hold the left mouse button | Shoot (arrows: 8 directions; mouse: at the cursor) |
| 1-6 or click | Buy an item in the shop |
| C or click | Open / close the coin store; there, 1-4 or click buys a pack |
| Esc or P | Pause menu (Esc first closes the coin store) |
| Enter, type, Enter | Player chat |
| F2 | Study panel (AI chat / scripted chat) |
| M or the top-bar button | Sound on / off (remembered in this browser) |

**Donations** come like on a real stream: a cleared wave, a close call, a streak or a new
best sometimes brings one (more likely when hype is high, never below 30 hype). Most are
$1–9, $20 or more is rare (about 1 in 50). Each shows in chat as a gold line, e.g.
"pixel_pal donated $5: i love your stream". In a 4–5 wave run that's usually $5–70 in
all; the balance carries over between runs. Rules: `src/game/donations.js`.

The game sends the catalog events itself:

| Event | When the game sends it | Goes to |
|-------|------------------------|---------|
| `round_start` | a wave starts | template line (minor) |
| `kill` | an enemy dies | template line (minor, coalesced when they come fast) |
| `damage_taken` | the player is hit | template line (minor) |
| `item_pickup` | something is bought in the shop | template line (minor) |
| `coin_purchase` | a coin pack is bought; the stats take the dollars off donations | template line (minor) |
| `win` | a wave is cleared | model reply: the selector picks the persona |
| `close_call` | a wave is cleared on low HP (2 of 5 hearts or less) | model reply |
| `new_best` | the first wave in a run past the best of earlier runs | model reply |
| `streak` | every 10 kills in a row without being hit | model reply |
| `loss` | the player dies | model reply |

Since W06, the same event again within 2 s counts as a repeat and is coalesced: the 1st,
5th and 10th of a run get a reply, the others nothing. That's why a fast string of kills
only gets a few chat lines.

In the browser console, `witc.latency()` gives p50/p95 from the game's send to the reply
(overall and by source), `witc.rows()` the raw rows and `witc.stats()` the current stats.
The service prints its own p50/p95 when you stop it with Ctrl+C.

For the scripted baseline, press **F2** in the game and pick **Scripted chat** (or start
with `npm run service -- --condition scripted`, or open the game with
`?condition=scripted`): same game, same persona labels, scripted lines, no model calls.

## Shot list for the clip

About a minute, screen recording of the browser window (Win+Alt+R with Xbox Game Bar, or
OBS):

1. Both terminals running, then the game with **chat live**.
2. Space to start, shoot a few slimes: template lines appear at once.
3. Clear wave 1 (win): a model line types in, the streamer's face cheers, followers go
   up with a "+N" pop-up, the hype meter fills.
4. In the shop: open the coin store (C), buy a pack (donations drop in the top bar),
   buy an upgrade, Space for wave 2. Esc for the pause menu.
5. Clear a wave on low HP (close call), then die (loss): different replies, the face
   reacts (shocked, sad), hype drops on the loss.
6. Type a message to chat ("chat was that boss hard?"): the player line with the ADMIN
   badge, then a reply to it.
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
- ~~Every reply is the Fan~~: since W06 the selector picks Fan, Backseat Gamer or
  Lurker. The Hater waits for the safety filter (W07).
- Pressing the same key several times within one frame counts once (the input sees one
  press per frame). Not noticeable at 60 fps.
- If the service stops between connecting and the round starting, that `round_start`
  is lost (the game doesn't resend events).
