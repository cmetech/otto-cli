#!/usr/bin/env node
/**
 * clean-worktrees.mjs — prune stale upstream-port worktrees.
 * CLI: node clean-worktrees.mjs [--registry PATH] [--ttl-hours N]
 * Default (no --registry): prune BOTH default registries —
 *   .planning/upstream-fixes/.worktree-registry.json   (upstream-fix lanes)
 *   .planning/upstream-swarms/.worktree-registry.json  (baseline-gate)
 * With --registry PATH: prune only that one.
 */
import { pruneWorktrees } from "./worktree.mjs";

const DEFAULT_REGISTRIES = [
  ".planning/upstream-fixes/.worktree-registry.json",
  ".planning/upstream-swarms/.worktree-registry.json",
];

const args = process.argv.slice(2);
function flag(name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

const explicit = flag("--registry", null);
const registries = explicit ? [explicit] : DEFAULT_REGISTRIES;
const ttlMs = Number(flag("--ttl-hours", "24")) * 3600 * 1000;

// Missing files: readRegistry returns [] → pruneWorktrees no-ops. Aggregate.
const pruned = [];
for (const registry of registries) {
  const result = pruneWorktrees(registry, { ttlMs });
  pruned.push(...result.pruned);
}
process.stdout.write(JSON.stringify({ pruned }, null, 2) + "\n");
