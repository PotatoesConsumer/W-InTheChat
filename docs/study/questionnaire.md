# Questionnaire: W-InTheChat study

The engagement measure from the proposal: after each condition, participants rate
immersion and desire to keep playing on 1–5 items. The same items are asked after both
halves, so the answers can be compared in pairs. Responses go into
[`responses-template.csv`](responses-template.csv), one row per participant per half.
The researcher fills in the participant ID, half and condition, and doesn't show the
condition to the participant.

## After each half (asked twice)

Participant ID: ______ Half: ☐ 1 ☐ 2

1 = strongly disagree, 5 = strongly agree. Circle one.

| # | Item | Column | | | | | |
|---|------|--------|---|---|---|---|---|
| 1 | I felt like I was really streaming to an audience. | `immersion` | 1 | 2 | 3 | 4 | 5 |
| 2 | I wanted to keep playing. | `keep_playing` | 1 | 2 | 3 | 4 | 5 |
| 3 | The chat reacted to what I was doing in the game. | `chat_relevant` | 1 | 2 | 3 | 4 | 5 |
| 4 | The chat felt like different people with their own personalities. | `chat_viewers` | 1 | 2 | 3 | 4 | 5 |
| 5 | Anything you'd like to say about this half? (optional) | `comment` | | | | | |

Items 1 and 2 are the proposal's engagement measures: immersion and desire to keep
playing. Items 3 and 4 are the participant's own view of relevance and persona
clarity. The study's main relevance and persona results come from the blind raters
instead (`docs/evaluation.md`).

## At the end (asked once)

| # | Question | Column | Answers |
|---|----------|--------|---------|
| 6 | Which half's chat did you prefer? | `preferred` | ☐ the first ☐ the second ☐ no preference |
| 7 | Why? (optional) | `preferred_why` | |
| 8 | How often do you watch game streams? | `watches_streams` | ☐ never ☐ a few times a year ☐ monthly ☐ weekly ☐ daily |

The researcher records `preferred` as `first`, `second` or `none`. The analysis turns
that into a condition using the participant's order.

Don't ask for a name, age, email or student ID here. The consent form is the only paper
with a name on it.

## Debrief (said after question 8)

Tell the participant which half used the AI and which used the scripted chat. Explain
that the scripted chat is the fixed-line baseline we compare the AI against. Thank them,
and remind them they can still ask for their data to be deleted using their participant
ID.
