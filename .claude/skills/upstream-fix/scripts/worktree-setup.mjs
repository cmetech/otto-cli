#!/usr/bin/env node
/**
 * worktree-setup.mjs — create (or resume) a lane worktree off a base branch.
 * CLI: node worktree-setup.mjs <laneId> [base]
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

function branchExists(branch, gitRunner) {
  try { gitRunner(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); return true; }
  catch { return false; }
}

export function setupWorktree({ laneId, base = "main", gitRunner = defaultGitRunner }) {
  const branch = `fix/upstream-lane-${laneId}`;
  const worktree = `.worktrees/upstream-fix-lane-${laneId}`;
  if (!SAFE.test(base) || !SAFE.test(branch)) throw new Error(`unsafe base/branch name: ${base} / ${branch}`);

  if (branchExists(branch, gitRunner)) {
    gitRunner(["worktree", "add", worktree, branch]);
  } else {
    gitRunner(["worktree", "add", worktree, "-b", branch, base]);
  }
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
