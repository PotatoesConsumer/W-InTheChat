# Final demo video (W12)

A short video of the prototype for the defense: about 2 minutes, a person playing,
AI chat on, with narration. Record it after the participant sessions (Prin's W10), so
any fixes from them are in.

## Draft clip

There's a silent 75 s draft, recorded headless: the benchmark bot plays
(`?condition=ai&bot=0.75&seed=11`) with `qwen2.5:3b` warm on the RTX 4050 laptop. AI
replies came in at 261 / 445 ms p50 / p95 over 10 replies. Use it to agree on what to
show; it isn't the final video (the top bar says `BOT`, and nobody types in chat by hand).
It isn't in the repo, since video files don't belong in git: ask Shapphanyu for
`W-InTheChat-demo-draft.mp4`.

## Before recording

1. `npm run service` (AI chat) and `npm run dev`, then open <http://localhost:5173>.
   The home page is a good first shot; **Watch and play** opens the stream.
2. Warm the model first: the first load took **84 s** on the laptop. Play one wave and
   wait for an AI reply before you start recording.
3. Don't open the study panel (F2) on camera. Sound on (top bar; M toggles it).
4. Screen recording: Win+Alt+G (Xbox Game Bar) or OBS, with the browser window only.

Donations are rare (a big moment brings one by chance). For a shot of the alert, type
`witc.testAlert(50)` in the console during a wave: the $20+ alert with confetti. It
doesn't change the stats or chat.

## Shot list (about 2 minutes)

| Time | Show | Say |
|------|------|-----|
| 0:00 | The game hub; pick Wave Survival | What the project is: a streamer simulator where a local model plays the chat |
| 0:15 | Wave 1: shoot slimes, chat reacts to kills | Minor events get instant template lines; big moments get a model reply |
| 0:35 | Clear a wave: the "WAVE CLEARED!" banner, an AI line types in, followers go up | The four personas (Fan, Hater, Backseat Gamer, Lurker), each in its own color |
| 0:55 | Type a question in chat ("which way do I go?") | The player's line (ADMIN), then a persona answers it |
| 1:10 | A donation: the alert by the cam, the gold chat line | Donations come from big moments, mostly a few dollars |
| 1:25 | The shop and the coin store: buy a pack, donations go down | The game reads stream stats; the model never changes them |
| 1:40 | Point at the top bar's reply p50 / p95 | Latency measured live; the W09 benchmark numbers |
| 1:50 | Get hit until low HP and clear a wave: "CLOSE CALL!" | Ends on a reaction |

The scripted baseline (F2) is for the study, not the video. If you show it, show both
conditions with the same moment so the difference is clear.
