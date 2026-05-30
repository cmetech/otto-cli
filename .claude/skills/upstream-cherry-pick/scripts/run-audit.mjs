#!/usr/bin/env node
/**
 * run-audit.mjs — deterministic orchestrator for the upstream-cherry-pick skill.
 *
 * Runs the full per-commit pipeline that SKILL.md describes, so a fresh agent
 * doesn't have to hand-drive dozens of CLI invocations (which is where bugs
 * like un-flagged regexes creep in). The only non-deterministic work — PR
 * review-thread prose, manual-triage notes — stays with the controlling agent.
 *
 * Usage (run from repo root):
 *   node .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs [upstream] [flags]
 *
 * Args:
 *   upstream            optional; one of config.upstreams. Omit to scan all.
 *
 * Flags:
 *   --dry-run           classify + score + write report, but file NO issues,
 *                       do NOT advance state, do NOT commit.
 *   --no-issue-context  skip the linked PR/issue fetch (faster, less accurate).
 *   --refresh-cache     bypass _cache/ and re-fetch PR/issue context.
 *   --from <commit>     override the starting commit for this run.
 *   --no-commit         file/advance state but skip the closing git commit.
 *
 * Exit codes: 0 = success, 1 = preflight or fatal error.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseConfig } from "./parse-config.mjs";
import { parseLedger } from "./parse-ledger.mjs";
import { readState } from "./state-read.mjs";
import { writeState } from "./state-write.mjs";
import { harvestCommits } from "./harvest-commits.mjs";
import { classifyApplicability } from "./classify-applicability.mjs";
import { classifySeverity } from "./classify-severity.mjs";
import { fetchPrContext } from "./fetch-pr-context.mjs";
import { applyContextUpgrades } from "./apply-context-upgrades.mjs";
import { scoreConflictRisk } from "./score-conflict-risk.mjs";
import { buildIssuePayload } from "./build-issue-payload.mjs";
import { dedupCheck } from "./dedup-check.mjs";
import { fileIssue } from "./file-issue.mjs";
import { writeReport } from "./write-report.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const AUDIT_OUTPUT_DIR = ".planning/upstream-audits";

const SECTION_BY_SEV = {
  CRITICAL_SECURITY: "criticalSecurity",
  CRITICAL_STABILITY: "criticalStability",
  NICE_TO_HAVE_FIX: "niceToHaveFix",
  FEATURE: "feature",
};

// ─── arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    noIssueContext: false,
    refreshCache: false,
    noCommit: false,
    from: null,
  };
  let upstream = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--no-issue-context") flags.noIssueContext = true;
    else if (a === "--refresh-cache") flags.refreshCache = true;
    else if (a === "--no-commit") flags.noCommit = true;
    else if (a === "--from") flags.from = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else upstream = a;
  }
  return { upstream, flags };
}

// ─── regex compilation (mirrors the CLI blocks in the classifier scripts) ─────

function compileRubric(classifier) {
  return {
    securityRegex: classifier.securityRegex ? new RegExp(classifier.securityRegex, "i") : undefined,
    stabilityRegex: classifier.stabilityRegex ? new RegExp(classifier.stabilityRegex, "i") : undefined,
    skipPrefixes: classifier.skipPrefixes ?? [],
  };
}

function compileRules(notApplicable) {
  const compileGroup = (g) => ({
    // Subjects are prose → case-insensitive; file paths stay exact (Linux).
    subjectRegex: g.subjectRegex ? new RegExp(g.subjectRegex, "i") : undefined,
    filePathRegex: g.filePathRegex ? new RegExp(g.filePathRegex) : undefined,
  });
  return (notApplicable ?? []).map((r) => ({
    ...r,
    matchAny: r.matchAny && compileGroup(r.matchAny),
    matchAll: r.matchAll && compileGroup(r.matchAll),
  }));
}

// ─── git helpers ─────────────────────────────────────────────────────────────

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function resolveSha(repoPath, rev) {
  try {
    return git(["-C", repoPath, "rev-parse", rev]);
  } catch {
    return rev; // leave unresolved (e.g. an absent tag) — report still renders
  }
}

// ─── preflight ───────────────────────────────────────────────────────────────

function runPreflight() {
  let out;
  try {
    out = execFileSync("node", [join(SCRIPT_DIR, "preflight.mjs")], { encoding: "utf-8" });
  } catch (err) {
    // preflight exits non-zero on hard failure; its stdout still holds the JSON
    out = err.stdout?.toString() ?? "";
    if (!out) {
      throw new Error(`preflight failed and produced no diagnostics: ${err.message}`);
    }
  }
  const result = JSON.parse(out);
  if (result.failed?.length) {
    throw new Error(
      "Preflight failed:\n" +
        result.failed.map((f) => `  - ${f.name}: ${f.detail ?? "failed"}`).join("\n"),
    );
  }
  return {
    passed: result.passed?.length ?? 0,
    autoCreatedLabels: (result.autoFixed ?? []).filter((a) => /label/i.test(a.name ?? "")).length,
  };
}

// ─── per-upstream scan ───────────────────────────────────────────────────────

async function scanUpstream(name, upstream, cfg, ledger, compiledRubric, compiledRules, preflight, flags) {
  const state = readState(undefined, name);
  const fromCommit = flags.from ?? state.lastAnalyzedCommit;
  if (!fromCommit) {
    throw new Error(
      `No starting commit for "${name}". Pass --from <commit/tag>, or seed ` +
        `.planning/upstream-sync-state.json. (Run with --init via the skill first.)`,
    );
  }

  const fromSha = resolveSha(upstream.path, fromCommit);
  const toSha = resolveSha(upstream.path, upstream.branch);

  const commits = harvestCommits({
    path: upstream.path,
    branch: upstream.branch,
    lastAnalyzedCommit: fromCommit,
  });

  const heavyFiles = new Set(ledger.heavyFiles);
  const heavyPackages = new Set(ledger.heavyPackages);

  const runData = {
    upstream: { name, ghRepo: upstream.ghRepo },
    scope: { fromCommit, fromSha, toSha },
    date: new Date().toISOString().slice(0, 10),
    dryRun: flags.dryRun,
    totals: { scanned: commits.length, filed: 0, notApplicable: 0, skipped: 0, unclassified: 0 },
    filed: { criticalSecurity: [], criticalStability: [], niceToHaveFix: [], feature: [] },
    notApplicable: [],
    unclassified: [],
    skipped: [],
    preflight,
    stateAdvanceTo: toSha,
  };

  let fetchFailures = 0;

  for (const commit of commits) {
    // i. applicability
    const appl = classifyApplicability(commit, compiledRules);
    if (!appl.applicable) {
      runData.notApplicable.push({ sha: commit.sha, subject: commit.subject, ruleId: appl.ruleId, reason: appl.reason });
      continue;
    }

    // ii. first-pass severity
    const firstPass = classifySeverity(commit, compiledRubric);
    if (firstPass.severity === "SKIP") {
      runData.skipped.push({ sha: commit.sha, subject: commit.subject, reason: firstPass.matchedBy });
      continue;
    }

    // iii. fetch PR/issue context
    let prContext = null;
    const issueContexts = [];
    if (!flags.noIssueContext) {
      for (const ref of commit.refs ?? []) {
        try {
          const ctx = await fetchPrContext({
            ghRepo: upstream.ghRepo,
            refNum: parseInt(ref, 10),
            refreshCache: flags.refreshCache,
          });
          if (ctx.kind === "pr") prContext = ctx;
          else issueContexts.push(ctx);
        } catch {
          fetchFailures++; // proceed with reduced signal
        }
      }
    }

    // iv. context upgrades
    const upgraded = applyContextUpgrades({ firstPass, prContext, issueContexts });
    const classification = { ...upgraded, matchedBy: firstPass.matchedBy };

    if (classification.severity === "SKIP") {
      runData.skipped.push({ sha: commit.sha, subject: commit.subject, reason: classification.upgradeReason ?? "context-downgrade" });
      continue;
    }
    if (classification.severity === "UNCLASSIFIED") {
      runData.unclassified.push({ sha: commit.sha, subject: commit.subject, note: "no rubric match; manual review" });
      continue;
    }

    // v. conflict risk
    const conflictRisk = scoreConflictRisk(commit, { heavyFiles, heavyPackages });

    // vi. payload
    const payload = buildIssuePayload({
      commit,
      classification,
      conflictRisk,
      upstream: { name, ghRepo: upstream.ghRepo },
      prContext,
      issueContexts,
      ccUser: cfg.issueFiling.ccUser,
      heavyFiles,
    });

    // vii. dedup
    let dedup = { existing: null, state: null };
    try {
      dedup = await dedupCheck({ targetRepo: cfg.targetRepo, shaShort: commit.sha.slice(0, 7) });
    } catch (err) {
      console.error(`  ! dedup check failed for ${commit.sha.slice(0, 7)}: ${err.message}`);
    }

    const section = SECTION_BY_SEV[classification.severity];
    const item = { sha: commit.sha, subject: commit.subject, conflictRisk: conflictRisk.risk, issueNumber: null };

    if (dedup.existing) {
      // Already tracked — record but don't re-file.
      item.issueNumber = dedup.existing;
      item.existingState = dedup.state;
      runData.filed[section].push(item);
      continue;
    }

    if (flags.dryRun) {
      runData.totals.filed++; // would-file
      runData.filed[section].push(item);
      continue;
    }

    // viii. file the issue (real run)
    const result = await fileIssue({ payload, targetRepo: cfg.targetRepo });
    if (result.error) {
      console.error(`  ! failed to file issue for ${commit.sha.slice(0, 7)}: ${result.error}`);
      item.issueNumber = null;
    } else {
      item.issueNumber = result.number;
      runData.totals.filed++;
    }
    runData.filed[section].push(item);
  }

  runData.totals.notApplicable = runData.notApplicable.length;
  runData.totals.skipped = runData.skipped.length;
  runData.totals.unclassified = runData.unclassified.length;

  const reportPath = writeReport({ outputDir: AUDIT_OUTPUT_DIR, runData });

  // state + commit (real runs only)
  if (!flags.dryRun) {
    writeState(undefined, name, {
      lastAnalyzedCommit: toSha,
      lastAnalyzedAt: new Date().toISOString(),
      lastReportPath: reportPath,
    });
    if (!flags.noCommit) {
      maybeCommit(name, runData, reportPath);
    }
  }

  return { reportPath, totals: runData.totals, fetchFailures };
}

// ─── closing commit (best-effort; never forces gitignored artifacts) ──────────

function maybeCommit(name, runData, reportPath) {
  const statePath = ".planning/upstream-sync-state.json";
  try {
    git(["add", statePath, reportPath]);
  } catch {
    // paths may be gitignored in this repo; nothing to stage
  }
  let staged = "";
  try {
    staged = git(["diff", "--cached", "--name-only"]);
  } catch {
    /* ignore */
  }
  if (!staged.trim()) {
    console.error(
      `  (skipping commit — ${statePath} / report are not tracked (likely gitignored). ` +
        `Track them or run with the skill's commit step disabled.)`,
    );
    return;
  }
  const msg = `audit(upstream): ${name} scan ${runData.date} (${runData.totals.filed} issues filed)`;
  git(["commit", "-m", msg]);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { upstream: only, flags } = parseArgs(process.argv.slice(2));

  const cfg = parseConfig();
  const ledger = parseLedger();
  const compiledRubric = compileRubric(cfg.classifier);
  const compiledRules = compileRules(cfg.applicability?.notApplicable);

  const preflight = runPreflight();

  const names = only ? [only] : Object.keys(cfg.upstreams);
  for (const name of names) {
    const upstream = cfg.upstreams[name];
    if (!upstream) throw new Error(`Unknown upstream "${name}". Known: ${Object.keys(cfg.upstreams).join(", ")}`);

    console.error(`\n=== ${name}${flags.dryRun ? " (dry-run)" : ""} ===`);
    const summary = await scanUpstream(name, upstream, cfg, ledger, compiledRubric, compiledRules, preflight, flags);
    console.error(`  report: ${summary.reportPath}`);
    console.error(`  totals: ${JSON.stringify(summary.totals)}`);
    if (summary.fetchFailures > 0) {
      console.error(`  ⚠️  ${summary.fetchFailures} PR/issue context fetch(es) failed — classification ran on reduced signal.`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
