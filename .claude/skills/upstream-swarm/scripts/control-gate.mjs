#!/usr/bin/env node
/**
 * control-gate.mjs — gateForPr (#3). Trial-merges a PR onto origin/main in a
 * fresh worktree and runs the `full` suite IN-PROCESS via runGate (the result
 * is a function return value, never parsed from stdout — that shell-parse was
 * the wave2 false-negative bug). On failure, an isolated single re-run
 * distinguishes a load-induced flake from a real break, unless a changed target
 * file appears in the failure tail (suspicious → real without re-run).
 */
import { basename, join } from "node:path";
import { trialMerge as defaultTrialMerge } from "../../upstream-merge/scripts/trial-merge.mjs";
import { runGate as defaultRunGate } from "../../_common/scripts/run-gates.mjs";

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
