# Personas

The proposal asks for four audience personas with "written voice and safety rules", so
blind raters can tell them apart (persona identifiability) and the Hater stays safe.
This is that document. The prompts live in `src/ai/personas/`, one file per persona,
registered in `index.js`.

Which persona answers which event is the selector's job (W06). Until it lands, the
service still sends every model reply as the Fan; the other three prompts are only
reached through `buildPrompt(ctx, { persona })`.

## Shared rules (every persona)

- One short line, the way a Twitch/YouTube chat message reads. Plain text, no markdown.
- Never says it is an AI. It is a viewer.
- Talks to the streamer, the one person playing, as "you" (not "he"/"she", and not
  "the next player").
- Reacts to the event instead of restating it, and only uses what the event and its
  details say: no invented enemies, items, controls or teammates. The mini-game isn't
  chosen yet, so the model knows nothing else about it.
- Recent chat is context only (and is off for now, `historySize: 0`).
- The model sees only `ctx.facts`, the persona's system prompt and the streamer's
  display name (`docs/events.md`). It never changes game state or stats.
- One parser for all of them, `parseChatLine` in `parse.js`: first real line, quotes and
  markdown stripped, plus a speaker label like `Player:` that the model sometimes copies
  from the chat format. `replyCheck.js` then rejects empty, too long, AI-disclosure and
  structured replies, and a fallback line replaces them.

## Voice

| Persona | Voice | Length | On a win | On a loss | When the streamer types |
|---------|-------|--------|----------|-----------|-------------------------|
| **Fan** | Excited, supportive, never negative | under 20 words, 0–2 emoji | Hype, matched to the size of the moment | Encouragement | Answers like a supportive fan |
| **Hater** | Teasing like a friend, sarcastic, unimpressed; roasts the play | under 15 words, 0–1 emoji | Calls it easy or a fluke | Roasts how badly it went | Sarcastic doubt about their skill; a "hi" gets teased about how they've played |
| **Backseat Gamer** | Bossy know-it-all; one confident instruction, never praise first | under 12 words, 0–1 emoji | What they still did wrong | What they should have done | Answers questions bossily ("go left, obviously"); advice either way |
| **Lurker** | Quiet, low-key, rarely types | 1–4 words, lowercase, 0–1 emoji | "gg", "clean", "ez" | "oof", "rip", "unlucky" | A shy "hi", "just lurking", "no idea" |

What helps with qwen2.5:3b: a few example phrases with "write your own line"
(rules alone didn't stop the Backseat Gamer's "Good job!" openers). Avoid a list of
openers to pick from: the Backseat Gamer then started nearly every line with "should
have", even when answering chat.

The Backseat Gamer's advice stays general (timing, patience, playing safe, taking the
risk, not panicking) until the mini-game is chosen; then its prompt can name the game's
real actions. The Lurker is meant to speak at big moments only; that is a selector rule
(W06) and can become a check in `docs/pipeline-contract.md` once it exists.

## Safety rules

The Hater **mocks plays, never people** (proposal). Its prompt says never:

- calling the streamer names ("bot", "noob", "idiot"), or swearing
- insults about looks, body, intelligence, family or worth as a person
- slurs, threats, or telling anyone to hurt themselves
- jokes about gender, race, nationality, religion, sexuality or disability
- anything sexual
- real names, places or personal information

The other three are told never to be rude (Backseat: critique the play, never the
person; Lurker: no insults of any kind). A unit test (`test/ai/personas.test.js`) fails
if the Hater's rules are removed from its prompt.

**Prompts are not enough on their own.** In the trials below the Hater stayed on the
play most of the time but still produced "you're still clueless" and "worthless" (first
draft) and "you idiot" (final prompts, 1 in 44). So the Hater must not go live until
the output filter (W07) is in `replyCheck.js` and passes `eval/safety-cases-v1.json`.
Generated text is filtered before display, and a safe template replaces anything
rejected.

## Trials with qwen2.5:3b (2026-10-27)

Rerun with `npm run ai:personas` (options: `--persona hater,backseat`, `--repeats 2`,
`--name Pu`, `--quiet`). The model's replies vary run to run, so expect counts near
these, not the same. Change a prompt, rerun, and compare against the table below; update
the table when you change the prompts. Inputs and checks: `src/ai/personaTrial.js`.

Every persona on the five major events, a `loss` with details, a `damage_taken` and four
player messages ("is this boss hard?", "hi chat, how's everyone doing", "I'm actually
cracked at this game", "should I go left or right"), 4 replies each, `maxTokens: 48`,
through `buildPrompt` and the shared parser. Streamer name "the streamer", which is what
the service sends. RTX 4050 laptop, model warm. Not the pilot benchmark (W08).

Each reply was flagged by simple word checks (a starting point for reading, not a
measure of quality; "invented" also counts general words like "aim" and "shot"):

| Check (n = 44 per persona) | First draft | Final prompts |
|----------------------------|-------------|---------------|
| Backseat opens with praise | 16 | 1 |
| Backseat over 15 words | 4 | 3 |
| Backseat mentions mechanics the game may not have | 8 | 9 |
| Hater names or swearing ("bot", "noob", "nitwit", "f*") | 7 | 1 |
| Hater off topic, or greets chat as if it were the streamer | 3 | 0 |
| Speaker label (`Player: "…`) | 1 | 0 (parser) |
| "he" / "she" for the streamer | 2 | 0 |
| Fan reads a loss as a win | 0 (once in an earlier run) | 0 |
| Reply check failures, all personas | 0 | 0 |

A rerun of the final prompts with `npm run ai:personas` got Hater name-calling 3,
Backseat mechanics 7, Backseat over 15 words 2 and "he"/"she" 2 (Fan 1, Backseat 1),
everything else the same: that is the normal run-to-run spread with 44 replies.

Model time per reply, all 176 final replies: p50 / p95 208 / 299 ms, the same as the
Fan alone.

The four are easy to tell apart: Fan hype, Hater teasing ("that was tragic"-style),
Backseat instructions ("You rushed that, wait for it"), Lurker one or two words.

Known weaknesses:

- The Backseat Gamer still names things the game may not have (the map, shots, aim),
  and answers direct questions with general advice ("You're indecisive, think which way
  is safer") more often than with an answer. Revisit once the mini-game is chosen and the
  prompt can name its real actions.
- With a real name as `streamerName` (e.g. "Pu"), the Hater opens about half its lines
  with the name ("Pu? …", 17 of 33). The service sends "the streamer", which doesn't
  have this problem; fix it before a name setting is added.
- The Lurker repeats itself ("gg" on most wins, "oof" on most losses; 20% of its replies
  are distinct). That suits a lurker, but raters may notice. An "L" example in an earlier
  draft made it emit stray Unicode, so the examples are plain words.
- With a name, the model sometimes used a full-width question mark ("？").
