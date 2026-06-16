#!/usr/bin/env node
/**
 * control-gate.mjs — gateForPr (#3). Trial-merges a PR onto origin/main in a
 * fresh worktree and runs the `full` suite IN-PROCESS via runGate (the result
 * is a function return value, never parsed from stdout — that shell-parse was
 * the wave2 false-negative bug). On failure, an isolated single re-run
 * distinguishes a load-induced flake from a real break, unless a changed target
 * file appears in the failure tail (suspicious → real without re-run).
 */
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { trialMerge as defaultTrialMerge } from "../../upstream-merge/scripts/trial-merge.mjs";
import { runGate as defaultRunGate } from "../../_common/scripts/run-gates.mjs";

const DEFAULT_FLAKY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "flaky-tests.json");

// Curated known-flaky test signatures. A gate failure matching one of these —
// when it does NOT overlap the fix's target files (suspicious overlap is judged
// first) — is treated as a flake instead of quarantining a good fix. Fail-open:
// a missing/unparseable file yields [] (no allowlisting), never a throw.
export function loadFlakyPatterns(path = DEFAULT_FLAKY) {
  try {
    if (!existsSync(path)) return [];
    const json = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(json.patterns) ? json.patterns.filter((p) => typeof p === "string" && p) : [];
  } catch { return []; }
}

function tailMatchesFlaky(failTail, flakyPatterns) {
  const tail = failTail ?? "";
  return flakyPatterns.some((p) => tail.includes(p));
}

function toList(targets) {
  if (Array.isArray(targets)) return targets.filter(Boolean);
  if (typeof targets === "string") return targets.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function isSuspiciousOverlap(failTail, targetList) {
  const tail = failTail ?? "";
  return targetList.some((t) => tail.includes(t) || tail.includes(basename(t)));
}

export function gateForPr({
  pr, headRef, targets, logDir, base = "origin/main",
  flakyPatterns = loadFlakyPatterns(),
  trialMergeFn = defaultTrialMerge,
  runGateFn = defaultRunGate,
}) {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) throw new Error(`pr must be an integer: ${pr}`);
  if (!headRef) throw new Error("headRef is required");
  const targetList = toList(targets);

  const tm = trialMergeFn({ prNumber, headRef, base });
  if (tm.conflict) {
    return { pass: false, verdict: "conflict", failTail: "trial-merge conflict", worktree: tm.worktree, reran: false, suspiciousOverlap: false };
  }

  const first = runGateFn({ gate: "full", cwd: tm.worktree, logPath: join(logDir, `gate-pr${prNumber}.log`), targetFiles: targetList });
  if (first.pass) {
    return { pass: true, verdict: "pass", failTail: "", worktree: tm.worktree, reran: false, suspiciousOverlap: false };
  }

  const suspiciousOverlap = isSuspiciousOverlap(first.failTail, targetList);
  if (suspiciousOverlap) {
    return { pass: false, verdict: "real", failTail: first.failTail, worktree: tm.worktree, reran: false, suspiciousOverlap: true };
  }

  // #5 known-flaky allowlist: a failure matching a curated flaky signature (and
  // already cleared of target-file overlap above) is a flake — skip the costly
  // re-run and don't quarantine a good fix on a test we've chosen to distrust.
  if (tailMatchesFlaky(first.failTail, flakyPatterns)) {
    return { pass: true, verdict: "flake", failTail: "", worktree: tm.worktree, reran: false, suspiciousOverlap: false, flaky: true };
  }

  const tm2 = trialMergeFn({ prNumber, headRef, base });
  if (tm2.conflict) {
    return { pass: false, verdict: "real", failTail: "re-run trial-merge conflict", worktree: tm2.worktree, reran: true, suspiciousOverlap: false };
  }
  const second = runGateFn({ gate: "full", cwd: tm2.worktree, logPath: join(logDir, `gate-pr${prNumber}-rerun.log`), targetFiles: targetList });
  if (second.pass) {
    return { pass: true, verdict: "flake", failTail: "", worktree: tm2.worktree, reran: true, suspiciousOverlap: false };
  }
  return { pass: false, verdict: "real", failTail: second.failTail, worktree: tm2.worktree, reran: true, suspiciousOverlap: false };
}
