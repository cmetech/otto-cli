#!/usr/bin/env node
/**
 * transient-classifier.mjs — categorize a failure as transient | real | abort.
 * Pure. Inputs include stage and stage-specific evidence; output is the routing
 * decision the scheduler uses to retry, quarantine, or abort the swarm.
 */

export const INFRA_PATTERNS = [
  "EACCES",
  "ENOSPC",
  "ETIMEDOUT",
  "ECONNRESET",
  "Killed",
  "OOMKilled",
  "network error",
];

function tailHasInfraPattern(tail = "") {
  return INFRA_PATTERNS.some((p) => tail.includes(p));
}

export function classifyFailure(ctx) {
  // Skill-level abort
  if (ctx.thrown) return { category: "abort", reason: `skill threw: ${ctx.thrown.message ?? String(ctx.thrown)}` };

  switch (ctx.stage) {
    case "ci": {
      if (ctx.firstRunRed && ctx.rerunGreen) return { category: "transient", reason: "ci-flake (red→green)" };
      return { category: "real", reason: "ci persistent red" };
    }
    case "local-gate": {
      if (ctx.baselineFailTail && ctx.failTail && ctx.failTail === ctx.baselineFailTail) {
        return { category: "transient", reason: "baseline-rot (same failure on main)" };
      }
      if (tailHasInfraPattern(ctx.failTail)) return { category: "transient", reason: "infra signature in fail tail" };
      return { category: "real", reason: "local gate real failure" };
    }
    case "fix": {
      if (tailHasInfraPattern(ctx.failTail)) return { category: "transient", reason: "infra signature in fail tail" };
      return { category: "real", reason: "fix stage failure" };
    }
    case "fix-reviewer": {
      // Reviewer rejection is always a real signal; the reviewer is the gate.
      return { category: "real", reason: `fix-reviewer ${ctx.reviewerVerdict}: ${ctx.reviewerReason ?? ""}` };
    }
    case "regression-gate": {
      if (ctx.regressionPassesOnMain) return { category: "real", reason: "regression test passes on main — does not pin the bug" };
      return { category: "real", reason: "regression gate failure" };
    }
    case "rebase": {
      // A rebase conflict only merits a transient retry when main moved AND our
      // touched files are disjoint from the new commits — then the conflict is
      // contextual and a re-rebase onto the new tip will likely apply. If our
      // own files overlap the new commits, a blind replay won't self-heal:
      // route to `real` so it quarantines for a manual rebase.
      if (ctx.mainShaChanged && ctx.conflictMarkers && ctx.touchedFilesDisjoint) {
        return { category: "transient", reason: "rebase conflict (main moved, touched files disjoint — re-rebase)" };
      }
      if (ctx.mainShaChanged && ctx.conflictMarkers) {
        return { category: "real", reason: "rebase conflict in our touched files — manual rebase needed" };
      }
      return { category: "real", reason: "rebase failure" };
    }
    case "swarm": {
      return { category: "abort", reason: "swarm-level failure" };
    }
    default: {
      return { category: "real", reason: `unknown stage: ${ctx.stage}` };
    }
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ctx = JSON.parse(process.argv[2] ?? "{}");
    process.stdout.write(JSON.stringify(classifyFailure(ctx), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
