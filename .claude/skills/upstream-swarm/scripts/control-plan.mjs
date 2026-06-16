#!/usr/bin/env node
/**
 * control-plan.mjs — read/planner controller subcommands: `tick` (pure planner
 * wrapping the scheduler), `report` (rollup), `cleanup` (worktree TTL prune).
 */
import { writeFileSync } from "node:fs";
import { readLedger } from "./swarm-ledger.mjs";
import { nextActions } from "./scheduler.mjs";
import { renderReport } from "./write-report.mjs";
import { driverPlan } from "./driver-core.mjs";
import { pruneWorktrees } from "../../_common/scripts/worktree.mjs";

const DEFAULT_REGISTRIES = [
  ".planning/upstream-fixes/.worktree-registry.json",
  ".planning/upstream-swarms/.worktree-registry.json",
];

/**
 * enrichAction — augment a scheduler action with per-issue ledger fields so the
 * sandboxed Workflow driver can build controller commands. Additive: it never
 * removes kind/issueNumber/issueNumbers/reason.
 */
function enrichAction(action, led) {
  // poll-ci-batch carries an array of issue numbers; map each to its PR.
  if (Array.isArray(action.issueNumbers)) {
    return {
      ...action,
      issues: action.issueNumbers.map((n) => ({
        issueNumber: n,
        prNumber: led.issues?.[String(n)]?.prNumber ?? null,
      })),
    };
  }
  // single-issue actions: spread in sha/targetFiles/prNumber/branch.
  const n = action.issueNumber;
  const rec = n != null ? led.issues?.[String(n)] : undefined;
  if (!rec) return action; // missing record → add nothing
  const sha = rec.sha ?? null;
  return {
    ...action,
    sha,
    targetFiles: rec.targetFiles ?? [],
    prNumber: rec.prNumber ?? null,
    branch: sha ? `fix/upstream-issue-${n}-${sha}` : null,
  };
}

export function tick({ ledger, caps, now }) {
  if (!ledger) throw new Error("tick requires --ledger <path>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  const capsObj = typeof caps === "string" ? JSON.parse(caps) : (caps ?? {});
  const nowMs = now != null ? Number(now) : Date.now();
  const actions = nextActions(led, capsObj, nowMs).map((a) => enrichAction(a, led));
  return { actions };
}

/**
 * plan — one-call planner for the sandboxed Workflow driver: run the scheduler
 * tick (already enriched) and fold its actions straight into a ready-to-execute
 * driverPlan. Lets the driver get a full dispatch plan with a single `ctl` call.
 */
export function plan({ ledger, caps, now, gateLogDir }) {
  return driverPlan(tick({ ledger, caps, now }).actions, {
    gateLogDir: gateLogDir ?? ".worktrees/gate-logs",
    ledger,
  });
}

export function report({ ledger, out }) {
  if (!ledger || !out) throw new Error("report requires --ledger <path> --out <path>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  writeFileSync(out, renderReport(led));
  return { out };
}

export function cleanup({ ttlHours, registry } = {}) {
  const ttlMs = Number(ttlHours ?? 24) * 3600 * 1000;
  const registries = registry ? [registry] : DEFAULT_REGISTRIES;
  const pruned = [];
  for (const reg of registries) {
    try { pruned.push(...pruneWorktrees(reg, { ttlMs })); } catch { /* missing registry → no-op */ }
  }
  return { pruned, count: pruned.length };
}
