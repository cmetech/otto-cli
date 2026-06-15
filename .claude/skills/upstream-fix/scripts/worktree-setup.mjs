#!/usr/bin/env node
/**
 * worktree-setup.mjs — create (or resume) a lane worktree off a base branch.
 * CLI: node worktree-setup.mjs <laneId> [base]
 */
import { execFileSync } from "node:child_process";
import { registerWorktree } from "../../_common/scripts/worktree.mjs";
import { singleIssueBranch } from "./single-issue-mode.mjs";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

function branchExists(branch, gitRunner) {
  try { gitRunner(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); return true; }
  catch { return false; }
}

export function setupWorktree({ laneId, issueNumber = null, sha = null, base = "origin/main", gitRunner = defaultGitRunner, fetch = true, registryPath = ".planning/upstream-fixes/.worktree-registry.json" }) {
  // Single-issue mode: name worktree+branch by issue number (and sha) so that
  // parallel `upstream-fix --single-issue` lanes — which all get plan-lanes
  // id=1 — never collide on the same `.worktrees/upstream-fix-lane-1` dir or
  // `fix/upstream-lane-1` branch. See #384. The branch matches
  // singleIssueBranch(N, sha) so the PR-title `(closes #N)` convention lines up.
  const single = issueNumber != null;
  if (single && !sha) throw new Error(`single-issue mode requires a sha (issue #${issueNumber})`);
  const branch = single ? singleIssueBranch(issueNumber, sha) : `fix/upstream-lane-${laneId}`;
  const worktree = single ? `.worktrees/upstream-fix-issue-${issueNumber}` : `.worktrees/upstream-fix-lane-${laneId}`;
  const owner = single ? `fix-issue-${issueNumber}` : `fix-lane-${laneId}`;
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
  try { registerWorktree(registryPath, { path: worktree, owner, createdAt: Date.now() }); }
  catch { /* registry is best-effort; never block worktree creation */ }
  return { worktree, branch };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const argv = process.argv.slice(2);
    // Single-issue mode: --issue <N> --sha <sha> [base]. Falls back to the
    // positional <laneId> [base] form for multi-lane runs.
    let issueNumber = null, sha = null, laneId = null, base = "main", positional = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--issue") issueNumber = argv[++i];
      else if (argv[i] === "--sha") sha = argv[++i];
      else positional.push(argv[i]);
    }
    if (issueNumber != null) {
      base = positional[0] ?? "main";
      if (!sha) throw new Error("Usage: node worktree-setup.mjs --issue <N> --sha <sha> [base]");
      process.stdout.write(JSON.stringify(setupWorktree({ issueNumber, sha, base }), null, 2) + "\n");
    } else {
      laneId = positional[0];
      base = positional[1] ?? "main";
      if (!laneId) throw new Error("Usage: node worktree-setup.mjs <laneId> [base]  |  --issue <N> --sha <sha> [base]");
      process.stdout.write(JSON.stringify(setupWorktree({ laneId, base }), null, 2) + "\n");
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
