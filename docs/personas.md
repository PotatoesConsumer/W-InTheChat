# Personas

The proposal asks for four audience personas with "written voice and safety rules", so
blind raters can tell them apart (persona identifiability) and the Hater stays safe.
This is that document. The prompts live in `src/ai/personas/`, one file per persona,
registered in `index.js`.

Which persona answers which event is the selector's job (`src/service/selector.js`,
weights in `PERSONA_WEIGHTS`, `docs/service.md`). All four are in the service's
`aiPersonas`; the Hater joined once the output safety filter (W07) was in.

## Shared rules (every persona)

- One short line, the way a Twitch/YouTube chat message reads. Plain text, no markdown.
- Never says it is an AI. It is a viewer.
- Talks to the streamer, the one person playing, as "you" (not "he"/"she", and not
  "the next player").
- Reacts to the event instead of restating it, and only uses what the event and its
  details say. Every prompt includes the same short description of the game
  (`GAME_CONTEXT` in `game.js`): a top-down wave shooter with slimes, bats and brutes,
  and a shop with six items between waves. It names what doesn't exist (teammates,
  maps, bosses, combos) and says the numbers in the details are the only real ones. A
  test fails if an enemy or shop item is missing from it.
- Recent chat is context only (and is off for now, `historySize: 0`).
- The model sees only `ctx.facts`, the persona's system prompt and the streamer's
  display name (`docs/events.md`). It never changes game state or stats.
- One parser for all of them, `parseChatLine` in `parse.js`: first real line, quotes and
  markdown stripped, plus a speaker label like `Player:` that the model sometimes copies
  from the chat format. The Backseat Gamer's parser also keeps whole sentences up to 15
  words (`limitSentences`): the model ignores "one sentence" about a quarter of the time. `replyCheck.js` then rejects empty, too long, AI-disclosure and
  structured replies, and a fallback line replaces them.

## Voice

| Persona | Voice | Length | On a win | On a loss | When the streamer types |
|---------|-------|--------|----------|-----------|-------------------------|
| **Fan** | Excited, supportive, never negative | under 20 words, 0–2 emoji | Hype, matched to the size of the moment | Encouragement; a death is never a win | Answers a question first, then cheers; says hello back |
| **Hater** | Teasing like a friend, sarcastic, unimpressed; roasts the play | under 15 words, 0–1 emoji | Calls it easy or a fluke | Roasts how badly it went | Sarcastic doubt about their skill; a "hi" gets teased about how they've played |
| **Backseat Gamer** | Bossy know-it-all; one confident instruction, never praise first | one sentence, under 12 words (cut at 15), 0–1 emoji | What they still did wrong | What they should have done | Answers the question bossily in the same sentence; advice either way |
| **Lurker** | Quiet, low-key, rarely types | 1–4 words, lowercase, 0–1 emoji | "gg", "clean", "ez"; a streak gets "sheesh" | "oof", "rip", "unlucky" | "hi" only to a greeting; "no idea" to a question (the selector doesn't give it chat) |

What helps with qwen2.5:3b: a few example phrases with "write your own line"
(rules alone didn't stop the Backseat Gamer's "Good job!" openers). Avoid a list of
openers to pick from: the Backseat Gamer then started nearly every line with "should
have", even when answering chat. **Keep quoted examples out of rules the model applies
every time**: given "nah not hard, you got this!" as an example of answering a
question, the Fan opened every reply with it, wins and deaths included. "you rushed
that, wait for it" did the same for the Backseat Gamer (7 of 44 on the old prompts).
Describing the move ("answer it, yes or no, which way, how, before the cheering")
works better. The trial's `copiesPrompt` check flags any reply holding a quoted
example of three or more words from the persona's own prompt.

The Backseat Gamer names the shooter's real actions: keep moving, kite, don't stand
still, back off from brutes, shoot the bats first, stay off the edges, buy the medkit
or an extra heart, save coins for rapid fire. The Lurker speaks at big moments only: the selector gives it major game
events and never player chat.

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
draft) and "you idiot" (final prompts, 1 in 44). So the Hater only went live with the
output safety filter (`src/service/safetyFilter.js`, W07), which passes
`eval/safety-cases-v1.json`. Every reply is filtered before display, and a fallback line
replaces anything rejected. What it blocks: `docs/service.md`, "Reply check and safety
filter".

## Prompt pass for the wave shooter (2026-11-11, W10)

Same trial, with the inputs updated to the shooter: the major events carry the
shooter's details (`win {wave 2, hp 4/5}`, `loss {wave 3, kills 14}`,
`streak {kills 10}`, `close_call {wave 4, hp 1/5}`, `new_best {wave 6, best 5}`), plus
a loss without details, a hit and the same four messages. New checks: `copiesPrompt`,
`inventedNumber` (a number the details or the player's message don't have) and the
Lurker's `hiOnEvent` (#18: "hi" to a kill streak). The Backseat's `invented` list no
longer counts waves, shots, aim or the shop, which are real now. Both columns use those
inputs and checks, 4 replies per input, RTX 4050, model warm.

| Check (n = 44 per persona) | Before (master's prompts) | After |
|----------------------------|---------------------------|-------|
| Fan reads a loss as a win | 2 | 0 |
| Fan invents a number | 1 | 3 (all "wave 3 next" after clearing wave 2, and the like) |
| "he" / "she" for the streamer | 3 (Fan 2, Backseat 1) | 0 |
| Backseat copies a prompt example | 7 | 0 |
| Backseat names things the game doesn't have | 3 | 0 |
| Backseat over 15 words | 3 | 0 (cut at sentence ends) |
| Hater name-calling | 1 | 0 |
| Lurker "hi" to a game event | 0 | 0 |
| Lurker distinct replies | 18% | 14% |
| Reply check failures, all personas | 0 | 0 |

Model time per reply, all 176: p50 / p95 216 / 331 ms (213 / 321 before).

Not in the checks but clear in the replies: the Fan now answers questions ("Yesss, but
you're doing great so far!" to "is this boss hard?", "let's go left" to "left or
right") and says hello back, where before it mostly cheered past them. The Backseat
answers "left or right" with a side and a reason ("go right, you're getting too close
to the brutes").

Still weak:

- The Lurker barely varies: "sheesh" on most good moments, "rip" on most bad ones (14%
  distinct). It suits a lurker, and the selector only gives it major events, but blind
  raters will find it easy to spot. That helps persona identification and costs variety.
- The Backseat often opens with "back off" or "stop", and sometimes writes two short
  sentences (kept when they fit in 15 words).
- The Hater sometimes invents a detail for a joke ("stuck in lava", "slime coming from
  the corner"). Harmless, but it isn't in the event.

## Modern chat slang (2026-11-11)

The Fan talks like today's stream chat (W, GG, clutch, goated, cracked, sheesh, "LETS
GO"), the Hater calls a death an L, and the Lurker can answer a win with "W". "W in the
chat" and the other chat calls aren't left to the model: chat spams them with fixed lines
(`src/service/chatCalls.js`, `docs/service.md`).

What the 3B model did with slang lists, from the trial:

- **Fan:** worked. "LETS GO", "sheesh", "let's go for a W", "So clutch" in context.
- **Hater:** given L, mid, cooked, washed and "skill issue", it misused them ("you'd
  wash this boss in your sleep", "Took you 10 kills to get an L?", an L on a win). Cut to
  just "A death can be an L", and only for a loss or a mistake. It's fine since.
- **Backseat:** given throwing, washed, "lock in", it used none of them. Removed.

Full trial after the change (176 replies): every check at 0 or near it, as before. One
Hater reply failed the reply check, and a fallback would replace it. The Lurker's
distinct replies went from 14% to 20%.

## Voice input: playing along with jokes (2026-11-12)

With the optional voice input, the streamer's speech reaches the prompt as `Pu said on
stream: "…"` (typed messages stay `typed in chat`). Every prompt now says it may get
either, and each persona plays along with a joke in its own voice:

- **Fan:** laughs with the streamer (LMAO, KEKW) and adds to the joke. Only a joke gets a
  laugh: a question or a hello gets a real answer. Keep it clean.
- **Hater:** roasts the joke, not the streamer: it wasn't funny, or their gameplay is the
  real joke.
- **Backseat:** tells them to stop joking and focus, then gives advice anyway.
- **Lurker:** "lol", "lmao", "kekw" or "real" are in its reaction list for a joke.

`npm run ai:voice` runs every persona on seven spoken lines (five jokes, a question and
a hello), each reply through the reply check. What the runs showed:

- **Fan and Hater riff on the joke:** "LMAO! The brute must really like the way you play
  champ!", "so this is how you pass waves then? Just test the respawn mechanic". The Fan
  said "LMAO" to a question too until "only laugh at a joke" was added.
- **One Fan reply was sexual and passed the filter** (to "chat I think the brute has a
  crush on me"). That word and its plural are now in the filter's sexual list, with a
  test.
- **The Backseat** mostly gives advice, as its rules say.
- **The Lurker stays weak at jokes:** it often says "sheesh", its kill-streak word.
  - Telling it "sheesh is only for a kill streak" made it say "sheesh" to everything.
  - The wordings that got it to say "lol" more also made it copy the streamer's greeting
    word for word in the main trial (3 of 44 replies, against 0–1 before).
  - The kept wording has the joke words only in its reaction list, and the main trial
    matches master: 0 copies, distinct 0.14–0.16.

Main trial (`npm run ai:personas`, 44 replies per persona) against master's prompts, same
day:

| Persona | Flags, this version | Flags, master |
|---|---|---|
| Fan | inventedNumber 2, lossAsWin 1 | inventedNumber 4 |
| Hater | inventedNumber 1 | failed 1, copiesPrompt 1, inventedNumber 1, nameCalling 1 |
| Backseat | praiseFirst 1, assistant 1, over15Words 1 | none |
| Lurker | 0 over4Words, distinct 0.14–0.16 | 0–1 over4Words, distinct 0.16–0.18 |

The spoken-line run: 28 replies, 0 rejected, about 60–400 ms each.

### Chat in the menu (2026-11-12)

Playing it for real, chat reacted to plays while the streamer was still in the game hub
("W, that was clutch!", "back off from brutes"): the model only got the message and the
game's description, so it assumed a run. Chat events now carry a `scene` (menu, playing,
paused, `docs/events.md`), the prompt says when the streamer is in the menu, and each
persona has a menu rule:

- **Fan:** nothing has happened yet, so hype them up to start a run.
- **Hater:** tease them for stalling instead of playing.
- **Backseat:** tell them to start the game, nothing else.

A shared line in `game.js` alone wasn't enough for the 3B model: the Hater still said
"after that last mistake" to a hello. With the persona rules
(`npm run ai:voice -- --scene menu`), a hello gets "Looks like you're still stalling" and
"Start the game", and "which game should I play" gets "you finally decided to pick a
game". Jokes that mention a wave still get wave talk, since the streamer brought it up.
The main trial (no scene, as in the evaluation set) stays comparable to master.

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

Known weaknesses at the time (the Backseat's advice and answers were addressed in the
2026-11-11 pass above):

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
