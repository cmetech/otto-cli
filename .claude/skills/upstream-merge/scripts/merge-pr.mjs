#!/usr/bin/env node
/**
 * merge-pr.mjs — squash-merge a PR via `gh pr merge` and return the merge sha.
 * Locked: --squash --delete-branch only; never --admin / --no-verify / bypass.
 * CLI: node merge-pr.mjs <number> [--repo <owner/name>]
 */
import { execFileSync } from "node:child_process";

const DEFAULT_REPO = "cmetech/otto-cli";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 }); }

export function mergePr({ number, repo = DEFAULT_REPO, ghRunner = defaultGhRunner }) {
  if (!Number.isInteger(number)) throw new Error(`PR number must be an integer: ${number}`);
  ghRunner(["pr", "merge", String(number), "--repo", repo, "--squash", "--delete-branch"]);
  const view = JSON.parse(ghRunner(["pr", "view", String(number), "--repo", repo, "--json", "mergeCommit"]));
  const sha = view?.mergeCommit?.oid ? String(view.mergeCommit.oid).slice(0, 7) : null;
  return { merged: true, sha };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const number = Number(process.argv[2]);
    let repo = DEFAULT_REPO;
    for (let i = 3; i < process.argv.length; i++) if (process.argv[i] === "--repo") repo = process.argv[++i];
    if (!Number.isInteger(number)) throw new Error("Usage: node merge-pr.mjs <number> [--repo <owner/name>]");
    process.stdout.write(JSON.stringify(mergePr({ number, repo }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
