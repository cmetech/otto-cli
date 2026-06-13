#!/usr/bin/env node
/**
 * worktree-setup.mjs — create (or resume) a lane worktree off a base branch.
 * CLI: node worktree-setup.mjs <laneId> [base]
 */
import { execFileSync } from "node:child_process";
import { registerWorktree } from "../../_common/scripts/worktree.mjs";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

function branchExists(branch, gitRunner) {
  try { gitRunner(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); return true; }
  catch { return false; }
}

export function setupWorktree({ laneId, base = "origin/main", gitRunner = defaultGitRunner, fetch = true, registryPath = ".planning/upstream-fixes/.worktree-registry.json" }) {
  const branch = `fix/upstream-lane-${laneId}`;
  const worktree = `.worktrees/upstream-fix-lane-${laneId}`;
  if (!SAFE.test(base) || !SAFE.test(branch)) throw new Error(`unsafe base/branch name: ${base} / ${branch}`);

  // Always fetch first when basing off a remote ref so the worktree picks up
  // the latest origin state. Prevents local-main contamination — see
  // preflight-clean-main.mjs in upstream-swarm/scripts for the swarm-level
  // guard. The fetch is cheap; skip it via fetch:false in unit tests.
  if (fetch && base.startsWith("origin/")) {
    gitRunner(["fetch", "origin", "--prune"]);
  }

  if (branchExists(branch, gitRunner)) {
    gitRunner(["worktree", "add", worktree, branch]);
  } else {
    gitRunner(["worktree", "add", worktree, "-b", branch, base]);
  }
  try { registerWorktree(registryPath, { path: worktree, owner: `fix-lane-${laneId}`, createdAt: Date.now() }); }
  catch { /* registry is best-effort; never block worktree creation */ }
  return { worktree, branch };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const laneId = process.argv[2];
    const base = process.argv[3] ?? "main";
    if (!laneId) throw new Error("Usage: node worktree-setup.mjs <laneId> [base]");
    process.stdout.write(JSON.stringify(setupWorktree({ laneId, base }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
