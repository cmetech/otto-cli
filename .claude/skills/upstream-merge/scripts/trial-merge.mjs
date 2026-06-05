#!/usr/bin/env node
/**
 * trial-merge.mjs — create a detached worktree at current origin/main and merge
 * a PR's head ref into it (no force, abort-on-conflict). The caller then runs
 * the local full-suite gate inside the worktree (run-gates.mjs full).
 * CLI: node trial-merge.mjs <prNumber> <headRef> [base]
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

export function trialMerge({ prNumber, headRef, base = "origin/main", gitRunner = defaultGitRunner }) {
  if (!Number.isInteger(prNumber)) throw new Error(`prNumber must be an integer: ${prNumber}`);
  if (!SAFE.test(headRef) || !SAFE.test(base)) throw new Error(`unsafe ref name: ${headRef} / ${base}`);
  const worktree = `.worktrees/upstream-merge-pr-${prNumber}`;

  gitRunner(["fetch", "origin", "--prune"]);
  gitRunner(["worktree", "add", "--detach", worktree, base]);
  try {
    gitRunner(["-C", worktree, "merge", "--no-ff", "--no-edit", `origin/${headRef}`]);
    return { worktree, merged: true, conflict: false };
  } catch {
    try { gitRunner(["-C", worktree, "merge", "--abort"]); } catch { /* nothing to abort */ }
    return { worktree, merged: false, conflict: true };
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const prNumber = Number(process.argv[2]);
    const headRef = process.argv[3];
    const base = process.argv[4] ?? "origin/main";
    if (!headRef) throw new Error("Usage: node trial-merge.mjs <prNumber> <headRef> [base]");
    process.stdout.write(JSON.stringify(trialMerge({ prNumber, headRef, base }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
