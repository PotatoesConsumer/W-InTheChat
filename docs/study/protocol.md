# Study protocol

How to run the participant study from the proposal: every participant plays Wave
Survival with **AI chat** and with the **scripted chat** baseline, 5 minutes each, in a
counterbalanced order. They answer the same questions after each half. Run the **pilot
first** (W09) with 2 people, fix what it finds, then run the 15–20 participant sessions
(W10).

| File | What |
|------|------|
| [`consent.md`](consent.md) | Consent form, printed and signed before anything starts |
| [`questionnaire.md`](questionnaire.md) | The questions after each half and at the end, plus the debrief |
| [`responses-template.csv`](responses-template.csv) | Where the answers are typed in, one row per participant per half |
| `npm run study:order` | The counterbalanced schedule: participant ids, order, game URLs |
| `npm run service -- --log study-logs` | The chat service, logging each half to its own file |

## Before the first session

- [ ] **Merge everything first.** The study panel must stay hidden at startup (fixed in
      #26): check that the AI chat / Scripted chat panel doesn't show until F2 is pressed.
- [ ] **Freeze the evaluation event set** (`docs/evaluation.md`, "Versioning") before
      the pilot, and note its sha256.
- [ ] Note the prompt version: `git rev-parse --short HEAD` on the study laptop. Don't
      change the code between participants. If you must, start a new version and say
      so in the report. Every session log records it too (`version` in its first line).
- [ ] **Review sample outputs and failure cases** (the proposal asks for this before the
      sessions). Run `npm run eval:runs` and `npm run study:rating-sheet` and read the
      sheet's messages. After the pilot, run `npm run study:analyze -- --include-pilot`
      and read its "Failure cases": each fallback, timeout and filtered reply, with
      what the model wrote and the filter rejected. Fix or note anything wrong before
      the first participant.
- [ ] Print the schedule: `npm run study:order -- --participants 20` (`--csv` for a
      spreadsheet). For the pilot: `npm run study:order -- --participants 2 --prefix T`.
      Participants get the next free ID in arrival order.
- [ ] Print the consent forms and questionnaires, one set per participant.

## Setting up the laptop (every study day)

1. Plug the laptop in (AC power). Close other GPU-heavy apps.
2. Start Ollama, then the service with logging, then the game:
   ```bash
   npm run service -- --log study-logs
   npm run dev
   ```
   The service warms the model before it listens. Wait for `Chat service (ai) on ...`.
   (The first load after boot took up to 84 s.)
3. Open Chrome (desktop Chrome, not a preview pane), full screen, sound on at a
   comfortable level.
4. **Leave the camera off.** It's an optional extension and off on every page load. The
   study doesn't use it.
5. Do a 1-minute check run with `?condition=ai&session=CHECK`: AI lines appear in chat
   and the top bar shows reply latency. Then delete the `CHECK-*` files in `study-logs/`.

## One participant (about 25 minutes)

Look up the participant's row in the schedule. Say nothing about which half is AI.

1. **Consent (3 min).** Hand over the form, answer questions, collect the signature.
   Write the participant ID on the form and on their questionnaire.
2. **Instructions (1 min).** Read this out:
   > "You're a streamer playing a wave shooter. WASD moves, hold the mouse or use the
   > arrow keys to shoot, and 1–6 buy items in the shop between waves. Your chat is on
   > the right. Please talk to your chat now and then, the way a streamer would. You'll
   > play twice for 5 minutes each, and I'll ask a few questions after each one."
3. **Half 1 (5 min).** Open the schedule's *First URL*, for example
   `http://localhost:5173/stream.html?condition=ai&session=P01`. Pick Wave Survival in the hub.
   Start a 5-minute timer when the first wave starts. When it ends, press Esc to pause.
4. **Questions 1–5** for half 1 (2 min).
5. **Half 2 (5 min).** Open the *Second URL* (same session, other condition). This
   reloads the page, so stats and chat start fresh and the service starts a new log
   file. Same timer, then Esc.
6. **Questions 1–5** for half 2, then **6–8** (3 min).
7. **Debrief (1 min)** from `questionnaire.md`.
8. **Type the answers** into `study-logs/responses.csv` (a copy of
   `responses-template.csv`): two rows per participant. Fill `preferred`,
   `preferred_why` and `watches_streams` on the half 2 row only.

If a participant dies early, they just start another run from the hub. Play time counts
from the first wave of half 1, not per run.

## If something goes wrong

| Problem | What to do |
|---------|------------|
| "chat offline" in the top bar | The service stopped. Restart it (same command); the page reconnects and sets the condition and session again. Note the participant ID and the time |
| Long pauses, then fallback lines | Check Ollama and GPU temperature. Note it; the log records fallbacks and timeouts |
| A chat line that's offensive or about the participant as a person | Stop the session, apologize, debrief. Keep the log and report it as a failure case |
| The participant wants to stop | Stop. Ask whether to keep or delete what was recorded so far |
| The wrong URL was opened | Finish the half anyway and note it. The log's `start` line records the actual condition |

## What's recorded, and where

`study-logs/` is git-ignored and the dev server won't serve it. Each half is one file,
`P01-ai-<time>.jsonl`, with:

- every game event and every message the participant typed;
- every chat line shown, with persona and source (`ai`, `template`, `scripted`,
  `fallback`);
- the latency of every reply and why any reply failed;
- what the model wrote when the reply check or the safety filter rejected it (never
  shown to the participant; kept so the team can review failures);
- the pipeline's counts and p50/p95 at the end, and the peak GPU memory during the half;
- the code version (which pins the prompts) and the model.

These logs, `responses.csv` and the schedule stay on the study laptop. Copy them to one
team member's drive for the analysis and nowhere else. Only aggregates go in the report.
Delete the logs once the project is graded, as the consent form says.

## The pilot (W09)

Run the whole protocol with 2 people (T01, T02), one in each order. Pilot data is not
part of the results. After the pilot, note:

- whether 5 minutes is long enough to see several waves and type a few messages;
- whether any question was unclear;
- anything that broke, or that gave away which half is AI (bugs for Shapphanyu, W10);
- reply latency from the service's end-of-half stats, compared with W09's 507 / 721 ms.

Fix what it finds, then run the participant sessions.

## After the sessions

1. **Rating set** (any day, with Ollama running): `npm run eval:runs`, then
   `npm run study:rating-sheet`. Give 2–3 raters from outside the team the sheet and
   [`rating.md`](rating.md); they must not have seen the key. Put the filled sheets in
   `study-logs/rating/filled/`, one CSV per rater.
2. **Analysis:** `npm run study:analyze -- --out study-logs/results.md`. It reads the
   session logs (pilot `T…` and `CHECK` files left out), `study-logs/responses.csv`,
   the key and the filled sheets, and writes the Markdown tables the evaluation report
   uses:
   - per condition: latency p50/p95, failures, filtered lines, and variety (repeat
     rate and distinct-2 over each session's first 5 minutes);
   - the blind ratings: relevance, persona accuracy and the confusion matrix;
   - the questionnaire: paired differences, the exact Wilcoxon signed-rank test,
     preferences and an order check.

   Parts with no input yet say so.
