# Contributing

How the three of us work in this repo. Prin owns these conventions; propose changes in a PR.

## Branches

- `master` is always working: `npm run check` passes on it. **Nobody pushes to `master`
  directly**; everything goes through a pull request.
- Branch from the latest `master`, named `<type>/<short-description>` in kebab-case:

  | Type | For | Example |
  |------|-----|---------|
  | `feature/` | new functionality | `feature/hater-persona` |
  | `fix/` | bug fixes | `fix/retry-on-404` |
  | `docs/` | docs only | `docs/event-catalog` |
  | `chore/` | tooling, config, dependencies | `chore/eslint-rules` |

- One board task per branch where possible (e.g. "W03 mock-event harness"). Small PRs get
  reviewed faster.
- Delete the branch after it's merged.

## Commits

- Imperative, capitalized subject under ~70 characters, no trailing period:
  `Add Hater persona prompt`, not `added hater stuff.`
- Add a body when the *why* isn't obvious from the subject.

## Pull requests

1. Run `npm run check` (lint + format check + tests). CI runs the same thing on every PR.
2. Open the PR into `master`. Say what changed, why, and which board task it covers, and
   flag anything the others need to decide.
3. **At least one teammate reviews before merging**, ideally the owner of the area it
   touches:
   - `src/ai/`: Sittipon
   - game, overlay and stats: Shapphanyu
   - `src/events/`, tests, tooling: Prin
4. Merge with a merge commit (GitHub's default "Create a merge commit").

## Code style

- **Prettier** formats the code (`npm run format`) and **ESLint** catches mistakes
  (`npm run lint`). Don't hand-tune formatting. Markdown is not auto-formatted.
- `.editorconfig` and `.gitattributes` keep 2-space indents and LF line endings on every OS.
- Tests live in `test/`, mirroring `src/`, as `*.test.js`, using Node's built-in `node:test`.
  They must not need Ollama or a network connection; use a fake generator instead.

## Never commit

- Model weights (Qwen Research License). Everyone runs `ollama pull qwen2.5:3b` locally.
- `.env` or any API key, token or password.
- Participant data from the study, even anonymized drafts. Keep it out of the repo.
