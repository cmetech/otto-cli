#!/usr/bin/env node
/**
 * worktree-merge.mjs — merge an accepted lane branch into the integration
 * branch (no force, abort-on-conflict) + post-hoc overlap detection.
 * CLI: node worktree-merge.mjs <laneBranch> <integrationBranch>
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

/** Files actually touched but not declared. A co-located *.test.* beside a
 *  declared source file is allowed (the regression test the fix subagent adds). */
export function detectOverlap(declaredFiles, actualFiles) {
  const declared = new Set(declaredFiles);
  const isAllowedTest = (f) => {
    const m = f.match(/^(.*)\.test\.[cm]?[jt]s$/);
    if (!m) return false;
    return [...declared].some((d) => d.startsWith(m[1]) || m[1].startsWith(d.replace(/\.[cm]?[jt]s$/, "")));
  };
  return actualFiles.filter((f) => !declared.has(f) && !isAllowedTest(f));
}

export function mergeLane({ laneBranch, integrationBranch, gitRunner = defaultGitRunner }) {
  if (!SAFE.test(laneBranch) || !SAFE.test(integrationBranch)) throw new Error(`unsafe branch name: ${laneBranch} / ${integrationBranch}`);
  // Caller has already checked out integrationBranch.
  try {
    gitRunner(["merge", "--no-ff", "--no-edit", laneBranch]);
    return { merged: true, conflict: false };
  } catch {
    try { gitRunner(["merge", "--abort"]); } catch { /* nothing to abort */ }
    return { merged: false, conflict: true };
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const [laneBranch, integrationBranch] = process.argv.slice(2);
    if (!laneBranch || !integrationBranch) throw new Error("Usage: node worktree-merge.mjs <laneBranch> <integrationBranch>");
    process.stdout.write(JSON.stringify(mergeLane({ laneBranch, integrationBranch }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
