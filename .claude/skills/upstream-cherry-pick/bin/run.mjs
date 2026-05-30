#!/usr/bin/env node
/**
 * run.mjs — top-level agent-free orchestrator for upstream-cherry-pick.
 *
 * CLI:
 *   node run.mjs [upstream-name] [flags]
 *
 * Flags:
 *   --init                   Scaffold config + state + labels (Task 19)
 *   --dry-run                Classify and score but skip gh issue creation
 *   --no-issue-context       Skip linked-PR/issue context fetching
 *   --refresh-cache          Force re-fetch of cached PR/issue JSON
 *   --output-dir=<path>      Override default `.planning/upstream-audits/`
 *   --config=<path>          Override default `.planning/upstream-sync-config.json`
 *
 * Programmatic API:
 *   import { run } from "./run.mjs"
 *   const { exitCode, results } = await run({ args, cwd, ghRunner, cmdRunner, todayIso })
 */

import { resolve, join } from "node:path";
import { parseConfig } from "../scripts/parse-config.mjs";
import { parseLedger } from "../scripts/parse-ledger.mjs";
import { readState } from "../scripts/state-read.mjs";
import { writeState } from "../scripts/state-write.mjs";
import { harvestCommits } from "../scripts/harvest-commits.mjs";
import { classifyApplicability } from "../scripts/classify-applicability.mjs";
import { classifySeverity } from "../scripts/classify-severity.mjs";
import { fetchPrContext } from "../scripts/fetch-pr-context.mjs";
import { applyContextUpgrades } from "../scripts/apply-context-upgrades.mjs";
import { scoreConflictRisk } from "../scripts/score-conflict-risk.mjs";
import { buildIssuePayload } from "../scripts/build-issue-payload.mjs";
import { dedupCheck } from "../scripts/dedup-check.mjs";
import { fileIssue } from "../scripts/file-issue.mjs";
import { writeReport } from "../scripts/write-report.mjs";
import { runPreflight } from "../scripts/preflight.mjs";

// ─── Severity → runData bucket mapping ───────────────────────────────────────

const SEVERITY_BUCKET = {
  CRITICAL_SECURITY: "criticalSecurity",
  CRITICAL_STABILITY: "criticalStability",
  NICE_TO_HAVE_FIX: "niceToHaveFix",
  FEATURE: "feature",
};

// ─── Flag parser ─────────────────────────────────────────────────────────────

/**
 * Parse argv (without node + script path) into flags and positional args.
 *
 * @param {string[]} args
 * @returns {{ flags: object, positional: string[] }}
 */
function parseArgs(args) {
  const flags = {
    init: false,
    dryRun: false,
    noIssueContext: false,
    refreshCache: false,
    outputDir: null,
    config: null,
  };
  const positional = [];

  for (const arg of args) {
    if (arg === "--init") {
      flags.init = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--no-issue-context") {
      flags.noIssueContext = true;
    } else if (arg === "--refresh-cache") {
      flags.refreshCache = true;
    } else if (arg.startsWith("--output-dir=")) {
      flags.outputDir = arg.slice("--output-dir=".length);
    } else if (arg.startsWith("--config=")) {
      flags.config = arg.slice("--config=".length);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
    // unknown --flags are silently ignored
  }

  return { flags, positional };
}

// ─── Main exported run() function ────────────────────────────────────────────

/**
 * Orchestrate the full upstream-cherry-pick pipeline.
 *
 * @param {object} opts
 * @param {string[]} [opts.args]       - argv without node + script path
 * @param {string}   [opts.cwd]        - working directory (defaults to process.cwd())
 * @param {Function} [opts.ghRunner]   - injectable gh CLI runner: (args: string[]) => string
 * @param {Function} [opts.cmdRunner]  - injectable cmd runner: (cmd: string, args: string[]) => string
 * @param {string}   [opts.todayIso]   - ISO date string (YYYY-MM-DD) for report stamping
 * @returns {Promise<{ exitCode: number, results?: object, error?: string }>}
 */
export async function run({
  args = [],
  cwd = process.cwd(),
  ghRunner,
  cmdRunner,
  todayIso,
} = {}) {
  // Resolve date
  const date = todayIso ?? new Date().toISOString().slice(0, 10);

  // Change cwd context by resolving paths relative to provided cwd
  const resolvePath = (p) => resolve(cwd, p);

  const { flags, positional } = parseArgs(args);

  // ── Step 1: --init delegation ──────────────────────────────────────────────
  if (flags.init) {
    // Task 19 will implement init-scaffold.mjs; stub for now
    process.stderr.write(
      "upstream-cherry-pick --init: not yet implemented (Task 19 pending)\n",
    );
    return { exitCode: 1, error: "init not implemented" };
  }

  // ── Step 2: Load config ────────────────────────────────────────────────────
  const configPath = flags.config
    ? resolvePath(flags.config)
    : resolvePath(".planning/upstream-sync-config.json");

  let config;
  try {
    config = parseConfig(configPath);
  } catch (err) {
    process.stderr.write(`upstream-cherry-pick: config load failed: ${err.message}\n`);
    return { exitCode: 1, error: err.message };
  }

  // ── Step 3: Preflight ──────────────────────────────────────────────────────
  let preflight;
  try {
    preflight = await runPreflight({ config, ghRunner, cmdRunner, cwd });
  } catch (err) {
    process.stderr.write(`upstream-cherry-pick: preflight threw: ${err.message}\n`);
    return { exitCode: 1, error: err.message };
  }

  if (preflight.failed.length > 0) {
    for (const f of preflight.failed) {
      process.stderr.write(`[preflight FAIL] ${f.name}: ${f.message}\n`);
      if (f.remediation) {
        process.stderr.write(`  → Remediation: ${f.remediation}\n`);
      }
    }
    return { exitCode: 1, error: "preflight checks failed" };
  }

  // ── Step 4: Load ledger ────────────────────────────────────────────────────
  const ledgerPath = config.divergenceLedger
    ? resolvePath(config.divergenceLedger)
    : resolvePath("docs/UPSTREAM-SYNC.md");
  const ledger = parseLedger(ledgerPath);

  // ── Step 5: Determine upstreams to scan ───────────────────────────────────
  const allUpstreams = config.upstreams ?? {};
  const upstreamNames =
    positional.length > 0
      ? positional
      : Object.keys(allUpstreams);

  if (upstreamNames.length === 0) {
    process.stderr.write("upstream-cherry-pick: no upstreams configured.\n");
    return { exitCode: 0, results: {} };
  }

  // ── Step 6: State file path ────────────────────────────────────────────────
  const statePath = resolvePath(".planning/upstream-sync-state.json");

  // ── Step 7: Output dir ─────────────────────────────────────────────────────
  const outputDir = flags.outputDir
    ? resolvePath(flags.outputDir)
    : resolvePath(".planning/upstream-audits");

  // ── Step 8: Cache dir for PR context ──────────────────────────────────────
  const cacheDir = resolvePath(".planning/upstream-audits/_cache");

  // ── Step 9: Scan each upstream ────────────────────────────────────────────
  const results = {};

  for (const upstreamName of upstreamNames) {
    const upstreamConfig = allUpstreams[upstreamName];
    if (!upstreamConfig) {
      process.stderr.write(
        `upstream-cherry-pick: unknown upstream "${upstreamName}" — skipping.\n`,
      );
      continue;
    }

    const upstreamInfo = { name: upstreamName, ghRepo: upstreamConfig.ghRepo };

    // Read state
    const state = readState(statePath, upstreamName);
    if (!state.lastAnalyzedCommit) {
      process.stderr.write(
        `upstream-cherry-pick: upstream "${upstreamName}" has no lastAnalyzedCommit in state.\n` +
        `  Run with --init to scaffold initial state.\n`,
      );
      return { exitCode: 1, error: `missing lastAnalyzedCommit for ${upstreamName}` };
    }

    // Harvest commits
    let commits;
    try {
      commits = harvestCommits({
        path: resolvePath(upstreamConfig.path),
        branch: upstreamConfig.branch ?? "main",
        lastAnalyzedCommit: state.lastAnalyzedCommit,
        cmdRunner,
      });
    } catch (err) {
      process.stderr.write(
        `upstream-cherry-pick: harvest failed for "${upstreamName}": ${err.message}\n`,
      );
      return { exitCode: 1, error: err.message };
    }

    process.stdout.write(
      `[${upstreamName}] ${commits.length} new commit(s) since ${state.lastAnalyzedCommit.slice(0, 7)}\n`,
    );

    // Build runData accumulator
    const runData = {
      upstream: upstreamInfo,
      scope: {
        fromSha: state.lastAnalyzedCommit,
        fromCommit: state.lastAnalyzedCommit,
        toSha: commits.length > 0 ? commits[0].sha : state.lastAnalyzedCommit,
      },
      date,
      filed: {
        criticalSecurity: [],
        criticalStability: [],
        niceToHaveFix: [],
        feature: [],
      },
      skipped: [],
      notApplicable: [],
      unclassified: [],
      preflight: {
        passed: preflight.passed.length,
        autoCreatedLabels: preflight.autoFixed.length,
      },
      stateAdvanceTo: commits.length > 0 ? commits[0].sha : state.lastAnalyzedCommit,
    };

    // Process each commit
    for (const commit of commits) {
      // i. Applicability check
      const applicability = classifyApplicability(
        commit,
        config.applicability?.notApplicable ?? [],
      );
      if (!applicability.applicable) {
        runData.notApplicable.push({
          sha: commit.sha,
          subject: commit.subject,
          ruleId: applicability.ruleId,
          reason: applicability.reason,
        });
        continue;
      }

      // ii. Initial severity classification
      const firstPass = classifySeverity(commit, config.classifier ?? {});
      if (firstPass.severity === "SKIP") {
        runData.skipped.push({
          sha: commit.sha,
          subject: commit.subject,
          reason: firstPass.matchedBy ?? "skip",
        });
        continue;
      }

      // iii. Fetch PR/issue context (if applicable)
      let prContext = null;
      let issueContexts = [];

      if (!flags.noIssueContext && commit.refs && commit.refs.length > 0) {
        for (const refNum of commit.refs) {
          try {
            const ctx = await fetchPrContext({
              ghRepo: upstreamConfig.ghRepo,
              refNum: parseInt(refNum, 10),
              cacheDir,
              refreshCache: flags.refreshCache,
              ghRunner,
            });
            if (ctx.kind === "pr" && !prContext) {
              prContext = ctx;
            } else if (ctx.kind === "issue") {
              issueContexts.push(ctx);
            }
          } catch {
            // Non-fatal: context fetch failure just means no enrichment
          }
        }

        // Also fetch issues referenced by the PR
        if (prContext?.data?.closingIssuesReferences) {
          for (const issueRef of prContext.data.closingIssuesReferences) {
            const num = issueRef.number ?? issueRef;
            if (!num) continue;
            try {
              const ctx = await fetchPrContext({
                ghRepo: upstreamConfig.ghRepo,
                refNum: parseInt(num, 10),
                cacheDir,
                refreshCache: flags.refreshCache,
                ghRunner,
              });
              if (ctx.kind === "issue") {
                issueContexts.push(ctx);
              }
            } catch {
              // Non-fatal
            }
          }
        }
      }

      // iv. Context-based upgrade
      const upgraded = applyContextUpgrades({
        firstPass,
        prContext,
        issueContexts,
      });
      const finalSeverity = upgraded.severity;

      // v. Score conflict risk
      const conflictRisk = scoreConflictRisk(commit, ledger);

      // vi. Post-upgrade SKIP check
      if (finalSeverity === "SKIP") {
        runData.skipped.push({
          sha: commit.sha,
          subject: commit.subject,
          reason: upgraded.upgradeReason ?? "downgraded-to-skip",
        });
        continue;
      }

      // vii. UNCLASSIFIED → manual triage bucket
      if (finalSeverity === "UNCLASSIFIED") {
        runData.unclassified.push({
          sha: commit.sha,
          subject: commit.subject,
          note: "no classifier matched — manual triage required",
        });
        continue;
      }

      // viii. Build issue payload
      const classification = {
        severity: finalSeverity,
        matchedBy: firstPass.matchedBy,
        upgradeReason: upgraded.upgradeReason,
      };

      const payload = buildIssuePayload({
        commit,
        classification,
        conflictRisk,
        upstream: upstreamInfo,
        prContext,
        issueContexts,
        ccUser: config.issueFiling?.ccUser ?? "@claude",
        heavyFiles: ledger.heavyFiles,
      });

      // ix. Dedup check
      const shaShort = commit.sha.slice(0, 7);
      let dedupResult;
      try {
        dedupResult = await dedupCheck({
          targetRepo: config.targetRepo,
          shaShort,
          ghRunner,
        });
      } catch (err) {
        process.stderr.write(
          `  [dedup warn] ${shaShort}: ${err.message}\n`,
        );
        dedupResult = { existing: null, state: null };
      }

      const bucket = SEVERITY_BUCKET[finalSeverity] ?? "feature";

      if (dedupResult.existing) {
        process.stdout.write(
          `  [dup] ${shaShort} already filed as #${dedupResult.existing} (${dedupResult.state})\n`,
        );
        runData.filed[bucket].push({
          sha: commit.sha,
          subject: commit.subject,
          issueNumber: dedupResult.existing,
          conflictRisk: conflictRisk.risk,
          alreadyFiled: true,
          note: `already filed as #${dedupResult.existing}`,
        });
        continue;
      }

      // x. File issue (or dry-run)
      if (flags.dryRun) {
        process.stdout.write(
          `  [dry-run] would file: ${payload.title}\n`,
        );
        runData.filed[bucket].push({
          sha: commit.sha,
          subject: commit.subject,
          issueNumber: 0,
          conflictRisk: conflictRisk.risk,
          dryRun: true,
          title: payload.title,
        });
      } else {
        const filed = await fileIssue({
          payload,
          targetRepo: config.targetRepo,
          ghRunner,
        });
        if (filed.error) {
          process.stderr.write(
            `  [file-issue error] ${shaShort}: ${filed.error}\n`,
          );
          runData.unclassified.push({
            sha: commit.sha,
            subject: commit.subject,
            note: `issue filing failed: ${filed.error}`,
          });
        } else {
          process.stdout.write(
            `  [filed] #${filed.number} — ${payload.title}\n`,
          );
          runData.filed[bucket].push({
            sha: commit.sha,
            subject: commit.subject,
            issueNumber: filed.number,
            issueUrl: filed.url,
            conflictRisk: conflictRisk.risk,
          });
        }
      }
    }

    // Compute totals
    const totalFiled =
      runData.filed.criticalSecurity.length +
      runData.filed.criticalStability.length +
      runData.filed.niceToHaveFix.length +
      runData.filed.feature.length;

    runData.totals = {
      scanned: commits.length,
      filed: totalFiled,
      skipped: runData.skipped.length,
      notApplicable: runData.notApplicable.length,
      unclassified: runData.unclassified.length,
    };

    // Write report
    let reportPath;
    try {
      reportPath = writeReport({ outputDir, runData });
      process.stdout.write(`[${upstreamName}] report written: ${reportPath}\n`);
    } catch (err) {
      process.stderr.write(
        `[${upstreamName}] write-report failed: ${err.message}\n`,
      );
    }

    // Advance state (unless dry-run)
    if (!flags.dryRun && commits.length > 0) {
      try {
        writeState(statePath, upstreamName, {
          lastAnalyzedCommit: runData.stateAdvanceTo,
          lastRunDate: date,
        });
      } catch (err) {
        process.stderr.write(
          `[${upstreamName}] state-write failed: ${err.message}\n`,
        );
      }
    }

    results[upstreamName] = {
      filed: totalFiled,
      skipped: runData.skipped.length,
      notApplicable: runData.notApplicable.length,
      unclassified: runData.unclassified.length,
      reportPath: reportPath ?? null,
    };
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  process.stdout.write("\n=== upstream-cherry-pick summary ===\n");
  for (const [name, r] of Object.entries(results)) {
    process.stdout.write(
      `  ${name}: filed=${r.filed} skipped=${r.skipped} notApplicable=${r.notApplicable} unclassified=${r.unclassified}\n`,
    );
  }

  return { exitCode: 0, results };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  try {
    const { exitCode } = await run({ args });
    process.exit(exitCode);
  } catch (err) {
    process.stderr.write(`upstream-cherry-pick: fatal: ${err.message}\n`);
    process.exit(1);
  }
}
