/**
 * regression.js
 *
 * The full regression pass (W08): which runs to make, how to judge each one, and the
 * Markdown report. scripts/regression.js runs it; docs/regression/ keeps the reports.
 *
 * A run's verdict:
 *   pass     every check passed
 *   fail     a check failed and no pending edge case covers it: a regression
 *   known    a check failed, but a pending edge case covers the run (a known gap)
 *   unblock  a pending edge case covers the run, yet every check passed: take it off
 *            the pipeline's `pending` list
 */

import { FAKE_MODES } from "./fakeGenerator.js";
import { pendingFor } from "./edgeCases.js";
import { summarize } from "./report.js";

/** Real-time playback for scenarios whose checks depend on timing; 20x for the rest. */
const REAL_TIME = new Set(["burst"]);
const FAST = 20;

/**
 * Every scenario in the AI condition under every fake model mode, and in the scripted
 * condition once (it never calls the model, so the mode can't matter).
 * @param {string[]} scenarios - Bundled names or paths.
 */
export function buildMatrix(scenarios) {
  const runs = [];
  for (const scenario of scenarios) {
    const speed = REAL_TIME.has(scenario) ? 1 : FAST;
    for (const mode of FAKE_MODES) runs.push({ scenario, condition: "ai", mode, speed });
    runs.push({ scenario, condition: "scripted", mode: "normal", speed });
  }
  return runs;
}

/**
 * @param {{scenario: string, mode: string}} run
 * @param {{name: string, ok: boolean, skipped?: boolean}[]} checks - runChecks() output.
 * @param {Record<string, string>} [pending] - The pipeline's pending edge cases.
 */
export function verdict(run, checks, pending) {
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  const covering = pendingFor(run, pending);
  if (failed.length === 0)
    return { verdict: covering.length ? "unblock" : "pass", failed, covering };
  return { verdict: covering.length ? "known" : "fail", failed, covering };
}

/**
 * One finished run, reduced to what the report needs.
 * @param {object} run - Matrix entry.
 * @param {object} record - runScenario() record.
 * @param {object[]} checks - runChecks() output.
 * @param {Record<string, string>} [pending]
 */
export function summarizeRun(run, record, checks, pending) {
  const s = summarize(record);
  return {
    ...run,
    ...verdict(run, checks, pending),
    violations: checks
      .filter((c) => !c.ok)
      .map((c) => ({ check: c.name, first: c.violations.slice(0, 3).map((v) => v.message) })),
    skipped: checks.filter((c) => c.skipped).map((c) => c.name),
    messages: s.messages.final,
    bySource: s.messages.bySource,
    completion: s.latency.completion,
  };
}

/** True when the pass found something that needs fixing. */
export function hasRegressions(report) {
  return (
    report.static.some((s) => !s.ok) ||
    report.runs.some((r) => r.verdict === "fail") ||
    report.comparisons.some((c) => !c.ok) ||
    (report.model?.checks ?? []).some((c) => !c.ok)
  );
}

/**
 * @param {object} report
 * @param {object} report.env - date, commit, node, os, gpu, ollama
 * @param {{name: string, ok: boolean, detail: string}[]} report.static
 * @param {object[]} report.runs - summarizeRun() results.
 * @param {{name: string, scenario: string, ok: boolean, detail?: string}[]} report.comparisons
 * @param {object} [report.model] - Real-model run, if one was made.
 * @param {string} report.pipeline - Name of the pipeline under test.
 * @returns {string} Markdown
 */
export function formatRegressionReport(report) {
  const { env, runs, comparisons, model } = report;
  const count = (v) => runs.filter((r) => r.verdict === v).length;
  const regressions = hasRegressions(report);
  const out = [];

  out.push(
    `# Regression pass: ${env.date}`,
    "",
    `**Result: ${regressions ? "❌ regressions found" : "✅ no regressions"}.** ` +
      `${runs.length} harness runs: ${count("pass")} pass, ${count("known")} known gaps, ` +
      `${count("fail")} fail, ${count("unblock")} ready to unblock.`,
    "",
    "Made with `npm run regression`. How to read it: `docs/regression/README.md`.",
    "",
    "| | |",
    "|-|-|",
    `| Commit | \`${env.commit}\` |`,
    `| Pipeline | ${report.pipeline} |`,
    `| Node | ${env.node} on ${env.os} |`,
    `| GPU | ${env.gpu} |`,
    `| Model | ${env.ollama} |`,
    "",
    "## Static checks",
    "",
    "| Check | Result | Detail |",
    "|-------|--------|--------|",
    ...report.static.map((s) => `| ${s.name} | ${s.ok ? "✅" : "❌"} | ${s.detail} |`),
    "",
    "## Harness matrix (fake model)",
    "",
    "Every scenario through the real pipeline, with the stats model. Latency is the",
    "pipeline with the fake model, not the real one.",
    "",
    "| Scenario | Condition | Model | Verdict | Failed checks | Messages | Completed p50 / p95 |",
    "|----------|-----------|-------|---------|---------------|----------|---------------------|",
  );
  for (const r of runs) {
    const failed = r.failed.length ? r.failed.join(", ") : "";
    const ms = r.completion.n ? `${r.completion.p50} / ${r.completion.p95} ms` : "";
    out.push(
      `| ${r.scenario} | ${r.condition} | ${r.mode} | ${VERDICT_LABEL[r.verdict]} | ${failed} | ${r.messages} | ${ms} |`,
    );
  }

  const known = runs.filter((r) => r.verdict === "known");
  const failures = runs.filter((r) => r.verdict === "fail");
  const unblock = runs.filter((r) => r.verdict === "unblock");

  if (failures.length) {
    out.push("", "### Regressions", "");
    for (const r of failures) out.push(...describeRun(r));
  }
  if (known.length) {
    out.push("", "### Known gaps (pending in `test/contracts/implementations.js`)", "");
    const reasons = new Map();
    for (const r of known) {
      for (const c of r.covering) {
        const key = `**${c.id}**: ${c.reason}`;
        reasons.set(key, [...(reasons.get(key) ?? []), `${r.scenario}/${r.mode}`]);
      }
    }
    for (const [reason, where] of reasons) out.push(`- ${reason} (${where.length} runs)`);
  }
  if (unblock.length) {
    out.push("", "### Ready to unblock", "");
    const ids = new Set(unblock.flatMap((r) => r.covering.map((c) => c.id)));
    out.push(
      `Every run covered by ${[...ids].map((id) => `\`${id}\``).join(", ")} passed. ` +
        "If that holds for all of them, remove them from `pending`.",
    );
  }

  out.push(
    "",
    "## Comparisons",
    "",
    "| Comparison | Scenario | Result | Detail |",
    "|------------|----------|--------|--------|",
    ...comparisons.map(
      (c) => `| ${c.name} | ${c.scenario} | ${c.ok ? "✅" : "❌"} | ${c.detail ?? ""} |`,
    ),
  );

  out.push("", "## Real model", "");
  if (!model) {
    out.push("Not run. Pass `--model` with Ollama running to include it.");
  } else {
    out.push(
      `\`${model.scenario}\` at real-time speed through the real pipeline and \`${env.ollama}\`.`,
      "",
      `- Checks: ${model.checks.filter((c) => c.ok).length}/${model.checks.length} passed` +
        (model.checks.some((c) => !c.ok)
          ? ` (failed: ${model.checks
              .filter((c) => !c.ok)
              .map((c) => c.name)
              .join(", ")})`
          : ""),
      `- Replies by source: ${formatCounts(model.summary.messages.bySource)}`,
      `- Replies by persona: ${formatCounts(model.summary.messages.byPersona)}`,
      `- Model calls: ${model.summary.generator.calls} (${formatCounts(model.summary.generator.byOutcome)})`,
      `- Event to completed reply: ${formatLatency(model.summary.latency.completion)}`,
      "",
      `> ${model.hardwareNote}`,
    );
    if (model.samples.length) {
      out.push("", "Sample model replies (for a quick read, not a rating):", "");
      for (const s of model.samples) out.push(`- *${s.trigger}* → [${s.persona}] ${s.text}`);
    }
  }

  return out.join("\n") + "\n";
}

const VERDICT_LABEL = { pass: "✅ pass", fail: "❌ fail", known: "⏸ known", unblock: "🔓 unblock" };

function describeRun(r) {
  const lines = [`**${r.scenario} / ${r.condition} / ${r.mode}**`, ""];
  for (const v of r.violations) {
    lines.push(`- \`${v.check}\`: ${v.first.join("; ")}`);
  }
  lines.push("");
  return lines;
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(", ") : "none";
}

function formatLatency(x) {
  return x.n ? `p50 ${x.p50} ms, p95 ${x.p95} ms (n=${x.n})` : "no replies";
}
