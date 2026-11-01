# Month-2 demo

How to prepare and run the Month-2 demo, how far each part of the milestone is, and what
the W08 regression pass found. Milestone M2 (the Rundown, SEG 02): **four personas live
behind the safety filter, the mini-game playable start to finish, and the scripted
baseline switch running on the same events.**

## Where the milestone stands

Checked on 2026-10-29 against `master` after #17, in the game (Chrome pane, real model)
and with `npm run regression`.

| Part of M2 | State | What works | What's missing | Owner |
|------------|-------|------------|----------------|-------|
| Four personas live behind the safety filter | ✅ | Prompts for all four (#15). The selector picks any of the four for model replies (#17, #19). Every reply passes the output safety filter (`src/service/safetyFilter.js`, #19) first; the `unsafe` edge case passes. | Nothing for the milestone. The filter is English only (`docs/service.md`). | Sittipon, W07 |
| Mini-game playable start to finish | ⬜ | The placeholder box scene, with keys 1–5 for the major events | **Choosing the mini-game**, then emitting its events and replacing the scene | Whole team, then Shapphanyu W08 |
| Scripted baseline switch on the same events | ✅ | The study panel (F2) or `?condition=` switches the game and the service (`POST /condition`) without a restart. Scripted lines per persona, picked by the same selector, so both conditions show the same persona labels (findings 2 and 4). | Nothing for the milestone. | Shapphanyu W07 |

## Before the demo

1. `git pull` and `npm ci` on the demo laptop.
2. Run `npm run regression -- --model` with Ollama running. The only known gaps should be
   the ones in the table above. Anything ❌ is a regression; fix it or leave that part out
   of the demo.
3. Close other GPU-heavy apps (a browser with video, games). One generation runs at a time
   on the 6 GB GPU, and other apps slow it down.
4. Chrome window at least 1100 px wide; the latency readout hides below that.
5. Dry run of the shot list once, with the screen recorder on.

## Run it

Two terminals, Ollama running with `qwen2.5:3b` pulled:

```bash
npm run service
```

```bash
npm run dev
```

Open <http://localhost:5173> in Chrome and wait for **chat live**. Keys are the same as the
Month-1 demo (`docs/demo-m1.md`): Space for a kill, 1–5 for win, loss, close call, streak and
new best, Enter to type to chat.

For the scripted condition, stop the service (Ctrl+C) and start it again with
`npm run service -- --condition scripted`. The game reconnects on its own.

## Shot list

About two minutes. Items marked *once ready* wait on the missing parts above.

1. **AI condition.** Both terminals, then the game with **chat live**.
2. Space a few times: template lines appear at once.
3. 1, 3, 4, leaving 2 s between keys: model replies from **different personas** (the
   avatar letter: F, B, L). Followers and hype react.
4. Type a message to chat, then a different one right after: both get a reply (finding 1,
   fixed in #19). Sending the same message again within 2 s counts as a repeat.
5. Point at the latency readout (p50/p95 in the top bar).
6. **Safety:** run
   `npm run harness -- basic-session --pipeline src/service/pipeline.js --mode unsafe --speed 20`.
   The fake model answers with threats and attacks from the safety test set; the output
   should show every one replaced by a fallback and all checks passing. This shows the
   filter working without making the real model say something bad on camera.
7. A Hater line in the game (H avatar): press 1–5 until the selector picks it.
8. **Scripted condition.** F2 opens the study panel; pick Scripted chat. Same keys:
   scripted lines from the same personas, instantly, no model. F2 again to go back to AI.
9. *Once ready:* the mini-game from start to finish, with chat reacting to its real events.
10. The regression report for the day (`docs/regression/`): no regressions.

## W08 regression pass and smoke test (2026-10-29)

Full report: [`docs/regression/2026-10-29.md`](regression/2026-10-29.md). In short:
no regressions. Every scenario passes every check in both conditions under every
fake-model failure mode, except the `unsafe` runs, a known gap until the filter lands.

Smoke test in the game with the real model, both conditions: kill, win, close call, typed
chat, stats, HUD, facecam, the service's p50/p95, and the scripted condition all worked.
No console errors.

Played at real time, the evaluation set gets a reply for **10 of 10 major events and 14 of
14 player messages**. 20 of 22 minor events get a template; the other two are kills 2 s
apart, coalesced as intended.

> Latency seen here (model replies 208 / 344 ms p50 / p95 in the game, n=3) was measured
> on an **RTX 4060** laptop, not the RTX 4050 the proposal targets. Indicative only.

### Findings

| # | Found | Owner | Suggestion |
|---|-------|-------|------------|
| 1 | **Fixed in #19.** **The player's quick follow-up messages get no reply.** All player messages share one coalescing key (`chat` in `pipeline.js` / `coalesce.js`), so different messages less than 2 s apart count as repeats. In the game: "ok chat", then a question a second later; the question was ignored. In `player-chat` at real time, 3 of 6 valid messages got a reply. The evaluation set isn't affected (its messages are at least 3 s apart). | Sittipon | Coalesce player messages by their (normalized) text, so spam like "LETS GO" ×5 still collapses, and let the pacer spread out different messages. Repro: `npm run harness -- player-chat --pipeline src/service/pipeline.js` |
| 2 | **Fixed in `feature/baseline-switch`.** **The scripted condition only speaks as the Fan.** On the evaluation set: 14 of 14 scripted lines are Fan, while the AI condition mixes Fan, Backseat and Lurker. The proposal says both conditions use "the same ... persona labels", so persona identification in the study would be one-sided. The pipeline already lists persona lines for the scripted baseline as W07 work. | Sittipon | Scripted lines per persona, chosen with the same selector, so both conditions show the same labels for the same events |
| 3 | **Template lines (minor events) are all Fan**, in both conditions (20 of 20 on the evaluation set). Fine if intended; worth deciding before the study, since raters see persona labels. | Sittipon | Decide, and note it in `docs/personas.md` |
| 4 | **Fixed in `feature/baseline-switch`.** **Switching condition means restarting the service.** Fine for a demo; the study needs a switch the facilitator can use between conditions. | Shapphanyu | The game's switch (W07) |
| 5 | **Reply quality, from the real-model run** (`docs/regression/2026-10-29.md`, samples): the Fan invented a score after a win ("15-14 now!" when the event said 14), and the Lurker answered a 5-kill streak with just "hi". Not check failures; things raters would mark down. | Sittipon | Add both to the known weaknesses in `docs/personas.md` for the prompt pass (W10) |

Known and expected at the time: the Hater never appears and unsafe output isn't filtered
yet. Both done in #19.
