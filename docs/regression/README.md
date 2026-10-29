# Regression pass

`npm run regression` runs everything that can catch a regression in one go and writes a
Markdown report here, named by date. Run it before every demo, before freezing the
evaluation set, and after any big merge.

```bash
npm run regression                 # about 5 minutes, no Ollama needed
npm run regression -- --model      # + the evaluation set through the real model (Ollama running)
npm run regression -- --skip-static --out my-report.md
```

It exits 1 if it found a regression, so it can also gate a merge.

## What it runs

1. **Static checks**: ESLint, Prettier, and every unit and contract test (`node --test`).
2. **Harness matrix**: every bundled scenario and the evaluation set, through the
   pipeline registered in `test/contracts/implementations.js`, with the registered stats
   model:
   - AI condition × every fake-model mode: `normal`, `slow`, `error`, `garbage`, `unsafe`
   - scripted condition once (it never calls the model)

   Each run is judged by every check in `docs/pipeline-contract.md`. `burst` plays at real
   time; the rest at 20× (the timing checks skip those).
3. **Comparisons** for every scenario: `same-choices` (same seed twice),
   `persona-independent-of-model` (normal vs garbage output) and `same-stats` (normal vs
   unsafe output).
4. **Real model** (`--model` only): the evaluation set at real-time speed through the
   pipeline and `qwen2.5:3b`. Checks, replies by source and persona, latency, and a few
   sample replies to eyeball.

## Reading a report

Each harness run gets a verdict:

| Verdict | Meaning | What to do |
|---------|---------|------------|
| ✅ pass | Every check passed | Nothing |
| ❌ fail | A check failed, and no pending edge case covers it | A regression: the report lists the first violations. Fix it, or ask its owner. |
| ⏸ known | A check failed, but the pipeline lists that edge case as `pending` | A known gap; the report gives the reason. Not a regression. |
| 🔓 unblock | The pipeline lists the edge case as `pending`, yet the run passed | Probably fixed: take the id out of `pending` so the contract suite enforces it. |

**Latency in the harness matrix uses the fake model.** It measures the pipeline (queueing,
pacing, coalescing), not `qwen2.5:3b`. The real-model section says which GPU it ran on.
Only numbers from the RTX 4050 laptop count as the project's latency (proposal: "on an RTX
4050 laptop with 6 GB VRAM"); anything else is indicative only.

## Reports

| Date | Commit | Result | Notes |
|------|--------|--------|-------|
| [2026-10-29](2026-10-29.md) | `0bd20f5` (after #17) | ✅ no regressions | W08 pass, with the real model (RTX 4060). Known gap: unsafe output (no filter yet). Findings in `docs/demo-m2.md`. |
