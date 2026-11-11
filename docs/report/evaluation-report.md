# W-InTheChat: evaluation report (draft)

> **Status: draft (W12).** Sections 1–4 are measured and filled in. Sections 5–7 wait for
> the participant sessions and the blind raters. Paste the tables from
> `npm run study:analyze -- --out study-logs/results.md` where it says **[results]**, then
> write the interpretation. Don't describe a null or mixed result as a success
> (proposal, risks table).

The proposal asks this report to document the questionnaire, the prompt versions, the
event set, the hardware configuration, anonymized aggregate results and failure cases,
and to say whether the AI condition used local generation or the API fallback.

## 1. What was compared

- **AI chat:** four personas (Fan, Hater, Backseat Gamer, Lurker) written by `qwen2.5:3b`
  running locally through Ollama. Major game events and player messages get a model
  reply from the persona the selector picks. Minor events get template lines.
- **Scripted chat (baseline):** the same game, events, interface, persona selector and
  persona labels. The model replies are replaced by fixed lines per persona
  (`SCRIPTED_LINES` in `src/service/templates.js`). Minor events get the same template
  lines as in the AI condition.
- **Generation mode: local only.** The hosted-API fallback was never needed or built.
  No player text left the laptop.
- **Prompt version:** git commit **[fill in: the version printed by
  `npm run study:analyze`]**. History: `docs/setup.md`, "Prompt versions". Before/after
  trial of the final prompt pass: `docs/personas.md`.
- **Event set:** `eval/event-set-v1.json`, sha256 **[fill in once frozen,
  `eval/manifest.json`]**.

## 2. Hardware and setup

RTX 4050 Laptop 6 GB, Ryzen 7, 32 GB RAM, Windows 11, on AC power. Ollama 0.40.13,
`qwen2.5:3b`, Node 22, Chrome. Setup steps: `docs/setup.md`. The NVIDIA power setting was
left at its default (`docs/setup.md`, "Optional").

Reply limits, set from the W08 laptop pilot (`docs/pilot-w08.md`): reply timeout 3000 ms,
32 tokens at most, one generation at a time, at most 4 chat lines a second. Repeated
events are coalesced over 2 s.

## 3. Performance (measured, W08–W09)

Full game in Chrome, played by a bot for 10 minutes, real model (`docs/benchmark-w09.md`):

| | p50 | p95 | max | n |
|---|---|---|---|---|
| Event to AI reply in chat (browser) | 507 ms | 721 ms | 808 ms | 67 |
| Event to template line (browser) | 6 ms | 17 ms | 32 ms | 179 |

- Replies are shown whole once they pass the checks, so first text = completion. The
  game then types the line in over at most 1.1 s, which is display, not waiting.
- No timeouts or fallbacks in 10 minutes. The slowest reply used 27% of the timeout.
- Peak GPU memory: 2165 of 6141 MiB, of which the model is 2063 MiB.
- **The idle GPU explains most of the latency.** After about 2 s idle, the GPU clocks
  down and the next reply runs 2.4× slower per token: about 200 ms when warm against
  about 500 ms when idle. The game calls the model every few seconds, so most replies
  start on an idle GPU. The team accepted this (`docs/team-status.md`).

During the participant sessions: **[results: the "Sessions" table, model reply first
text and completion p50/p95, per condition]**.

## 4. Safety (measured)

- The output safety filter passes all 13 `block` and all 16 `allow` cases in
  `eval/safety-cases-v1.json` (`docs/service.md`). Every model reply goes through it
  before display, and a fallback line replaces anything rejected.
- Persona trial, 44 replies per persona on the final prompts: no reply check failures,
  no Hater name-calling (`docs/personas.md`). Earlier trials found "you idiot" once in 44
  Hater replies, which is why the filter is required, not optional.
- During the participant sessions: **[results: "Filtered by the reply check / safety
  filter" and "Failures" per condition, and any line a participant or researcher
  reported. List each case.]**

## 5. Relevance and persona identifiability (blind raters)

Method: `npm run eval:runs` played the fixed event set into both conditions (seeds 1
and 2). Every line answering a major event or a player message went on a shuffled sheet
with only the trigger and the message. **[n]** raters from outside the team scored
relevance 1–5 and named the persona (`docs/study/rating.md`).

**[results: the "Blind ratings" table and both confusion matrices]**

Interpretation: **[relevance: compare the distributions, not just the means. Persona:
accuracy against 25% chance; which personas get confused. Rater agreement.]**

## 6. Variety

Repeat rate and distinct-2, per session over its first 5 minutes, averaged per
condition. Read them alongside relevance: a chat can be varied and off-topic.

**[results: the variety rows of the "Sessions" table]**

Known going in: the Lurker is meant to repeat ("gg", "rip"), and the scripted baseline
draws from a fixed set of lines.

## 7. Engagement (participants)

**[n]** participants, each played both conditions for 5 minutes in a counterbalanced
order (`docs/study/protocol.md`), and rated both on the same 1–5 items
(`docs/study/questionnaire.md`).

**[results: the "Questionnaire" table, preferences and the order check]**

Interpretation: **[paired differences and how many participants rated which higher.
Report the exact Wilcoxon p as supporting detail only. This is a small exploratory
study.]**

Comments: **[a few representative ones per condition, anonymized]**

## 8. Failure cases

**[From the session logs: every fallback, timeout and filtered line, with its trigger.
Also anything that broke during sessions (the protocol's incident notes).]**

## 9. Limitations

- One laptop, one model, English only.
- A small exploratory study: **[n]** participants, volunteers from **[where]**.
- Sessions were 5 minutes per condition. Long-session effects (repetition fatigue) aren't
  measured.
- The rating set comes from the fixed event set, not from the participants' own
  sessions, so the triggers are the same in both conditions.
- Participants could still guess which condition was AI (for example from response
  timing). **[note what the debrief showed]**
- The camera (expression signal) was an optional extension and was off in the study.

## 10. Conclusion

**[Answer the primary question: does AI chat improve perceived engagement and contextual
relevance over the scripted baseline, without unacceptable latency or unsafe output? Say
plainly if the result is null or mixed.]**
