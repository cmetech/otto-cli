#!/usr/bin/env node
/**
 * clean-worktrees.mjs — prune stale upstream-port worktrees.
 * CLI: node clean-worktrees.mjs [--registry PATH] [--ttl-hours N]
 * Default registry: .planning/upstream-fixes/.worktree-registry.json
 */
import { pruneWorktrees } from "./worktree.mjs";

const args = process.argv.slice(2);
function flag(name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

const registry = flag("--registry", ".planning/upstream-fixes/.worktree-registry.json");
const ttlMs = Number(flag("--ttl-hours", "24")) * 3600 * 1000;
const { pruned } = pruneWorktrees(registry, { ttlMs });
process.stdout.write(JSON.stringify({ pruned }, null, 2) + "\n");
