# Defense rehearsal

A checklist for the W12 rehearsal: the demo, who says what, and the questions we're
likely to get, each with where the answer is. Rehearse once with a timer and once with
someone outside the team asking the questions.

## The demo (5 minutes)

1. Start Ollama, `npm run service`, `npm run dev` **before** the defense. The first model
   load can take over a minute.
2. Open <http://localhost:5173>: the home page. **Watch and play** opens the stream's
   hub, then Wave Survival with AI chat: clear a wave, die once, type a question to
   chat. If a display name is set on the profile page, chat calls you by it.
3. F2 → Scripted chat: the same game and personas, fixed lines.
4. Show `witc.latency()` in the console, or the top bar's p50/p95.
5. Backup: the recorded demo video (`docs/demo-final.md`) in case the laptop misbehaves.

## Who presents what

| Part | Who |
|---|---|
| Problem, proposal, related work | **[name]** |
| Pipeline: events, coalescing, persona selector, local model, safety filter, fallback | Sittipon |
| Game, overlay, stats, effects, optional camera | Shapphanyu |
| Study design, harness and checks, results | Prin |
| Limitations and conclusion | **[name]** |

## Questions to expect

| Question | Short answer | Where |
|---|---|---|
| Why a 3B model and not something bigger? | It fits a 6 GB laptop GPU next to the game and replies in ~500 ms. Qwen3 couldn't turn its thinking step off and missed the budget | `CLAUDE.md`, `docs/benchmark-w09.md` |
| Why not stream the reply as it's written? | A line can't be taken back once shown, so we only show text that has passed the safety filter. The game types it in instead | `docs/service.md`, "Showing replies" |
| How do you stop the Hater being abusive? | Prompt rules, then an output filter on every reply (blocks slurs, threats, attacks on the person), then a safe fallback line. Tested on a fixed safety set | `docs/personas.md`, `docs/service.md` |
| How do you know the scripted chat is a fair baseline? | Same game, events, selector and persona labels; only the reply source differs. Minor events get the same templates in both | `docs/evaluation.md` |
| Is it deterministic? | Routing never depends on timing: the same seed and events give the same chat choices. Checked by the harness's `same-choices` | `docs/pipeline-contract.md` |
| What's the latency, honestly? | 507 / 721 ms p50/p95 in the full game. About 200 ms with a warm GPU; the GPU clocks down when idle | `docs/benchmark-w09.md` |
| Does the model see the player's camera? | No. The camera is optional and off by default; only a word like "smiling" leaves the browser, as a minor event that gets template lines | `docs/events.md`, `src/game/camera.js` |
| What does the model get to see? | Only the event's facts or the player's message, the persona prompt and a one-paragraph game description. No files, no game state, no stats | `src/ai/contextBuilder.js`, `docs/events.md` |
| The home, profile and Go live pages aren't in the proposal. Isn't the profile an "analytics screen", which you put out of scope? | They're extras for the demo, listed in the report's deviations. The profile is a short summary kept in the browser (no charts, nothing about the model), and the study never shows them: `?session=` links go straight to the stream, always live, with no name or history | `docs/report/evaluation-report.md`, "Deviations" |
| Does the player's name change what the model sees? | Only the name, which `docs/events.md` allows, checked so it can't carry instructions. The study sends none, so both conditions' prompts are unchanged | `src/ai/contextBuilder.js` (`STREAMER_NAME`), `docs/service.md` |
| Your study is small. What can you claim? | It's exploratory: paired differences with n, not a general claim about all players | `docs/report/evaluation-report.md` |
| What would you do next? | **[decide as a team]** | |

## Before the day

- [ ] `npm run regression -- --model` passes on the demo laptop
- [ ] The report's **[results]** placeholders are all filled
- [ ] The video is on the laptop and on a USB stick
- [ ] Each of us has rehearsed their part with a timer
