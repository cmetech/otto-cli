#!/usr/bin/env node
/**
 * trial-merge.mjs — create a detached worktree at current origin/main and merge
 * a PR's head ref into it (no force, abort-on-conflict). The caller then runs
 * the local full-suite gate inside the worktree (run-gates.mjs full).
 *
 * Also provisions the worktree's node_modules by symlinking the repo root's
 * installation. Without this, the very first `npm test` inside the worktree
 * fails at `require("esbuild")`. Caller can disable by passing
 * `provisionDeps: false` (or `--no-provision-deps` from the CLI) — useful
 * for callers that intend to run `npm ci` themselves.
 *
 * CLI: node trial-merge.mjs <prNumber> <headRef> [base] [--no-provision-deps]
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { provisionWorktreeNodeModules } from "../../_common/scripts/worktree.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const SAFE = /^[A-Za-z0-9._\/-]+$/;

// Capture git's stderr (stdio[2]: "pipe") instead of inheriting it. `git
// worktree add` prints "Preparing worktree (detached HEAD …)" to stderr;
// inheriting it leaks that line into the stdout a JSON-contract caller (the
// swarm-control `gate` subcommand) captures, which crashed the Workflow
// driver's JSON.parse. Piping keeps it off the parent's streams (and it's
// still surfaced via err.stderr if a git call throws).
function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }); }

function defaultProvisionDeps({ workdir }) {
  provisionWorktreeNodeModules(workdir, REPO_ROOT);
}

export function trialMerge({
  prNumber,
  headRef,
  base = "origin/main",
  gitRunner = defaultGitRunner,
  provisionDeps = defaultProvisionDeps,
}) {
  if (!Number.isInteger(prNumber)) throw new Error(`prNumber must be an integer: ${prNumber}`);
  if (!SAFE.test(headRef) || !SAFE.test(base)) throw new Error(`unsafe ref name: ${headRef} / ${base}`);
  const worktree = `.worktrees/upstream-merge-pr-${prNumber}`;

  gitRunner(["fetch", "origin", "--prune"]);
  // Idempotent: a prior gate (or a crashed run) may have left this worktree on
  // disk, which would make `worktree add` throw "already exists" and fail every
  // retry. Force-remove first (best-effort), mirroring baseline-gate.
  try { gitRunner(["worktree", "remove", "--force", worktree]); } catch { /* nothing to remove */ }
  gitRunner(["worktree", "add", "--detach", worktree, base]);
  // Provision node_modules so the local gate can resolve dependencies
  // without a per-PR `npm ci`. Caller can opt out via provisionDeps: false.
  if (provisionDeps) provisionDeps({ workdir: worktree });
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
    let base = "origin/main";
    let provisionDeps = defaultProvisionDeps;
    for (let i = 4; i < process.argv.length; i++) {
      if (process.argv[i] === "--no-provision-deps") provisionDeps = false;
      else if (!process.argv[i].startsWith("--")) base = process.argv[i];
    }
    if (!headRef) throw new Error("Usage: node trial-merge.mjs <prNumber> <headRef> [base] [--no-provision-deps]");
    process.stdout.write(JSON.stringify(trialMerge({ prNumber, headRef, base, provisionDeps }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
