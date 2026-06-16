#!/usr/bin/env node
/**
 * control-plan.mjs — read/planner controller subcommands: `tick` (pure planner
 * wrapping the scheduler), `report` (rollup), `cleanup` (worktree TTL prune).
 */
import { writeFileSync } from "node:fs";
import { readLedger } from "./swarm-ledger.mjs";
import { nextActions } from "./scheduler.mjs";
import { renderReport } from "./write-report.mjs";
import { pruneWorktrees } from "../../_common/scripts/worktree.mjs";

const DEFAULT_REGISTRIES = [
  ".planning/upstream-fixes/.worktree-registry.json",
  ".planning/upstream-swarms/.worktree-registry.json",
];

export function tick({ ledger, caps, now }) {
  if (!ledger) throw new Error("tick requires --ledger <path>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  const capsObj = typeof caps === "string" ? JSON.parse(caps) : (caps ?? {});
  const nowMs = now != null ? Number(now) : Date.now();
  return { actions: nextActions(led, capsObj, nowMs) };
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
