#!/usr/bin/env node
/**
 * issue-update.mjs — label / comment / close a cmetech/otto-cli issue via gh.
 * CLI: node issue-update.mjs <number> --repo R [--add-label L]... [--remove-label L]... [--comment TEXT] [--close]
 */
import { execFileSync } from "node:child_process";

const DEFAULT_REPO = "cmetech/otto-cli";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8" }); }

export function updateIssue({ number, repo = DEFAULT_REPO, addLabels = [], removeLabels = [], comment = null, close = false, ghRunner = defaultGhRunner }) {
  const actions = [];

  if (addLabels.length || removeLabels.length) {
    const args = ["issue", "edit", String(number), "--repo", repo];
    for (const l of addLabels) args.push("--add-label", l);
    for (const l of removeLabels) args.push("--remove-label", l);
    ghRunner(args);
    if (addLabels.length) actions.push("add-label");
    if (removeLabels.length) actions.push("remove-label");
  }

  if (comment) {
    ghRunner(["issue", "comment", String(number), "--repo", repo, "--body", comment]);
    actions.push("comment");
  }

  if (close) {
    ghRunner(["issue", "close", String(number), "--repo", repo]);
    actions.push("close");
  }

  return { number, actions };
}

function parseArgv(argv) {
  const number = argv[0];
  let repo = DEFAULT_REPO; const addLabels = []; const removeLabels = []; let comment = null; let close = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") repo = argv[++i];
    else if (a === "--add-label") addLabels.push(argv[++i]);
    else if (a === "--remove-label") removeLabels.push(argv[++i]);
    else if (a === "--comment") comment = argv[++i];
    else if (a === "--close") close = true;
  }
  return { number, repo, addLabels, removeLabels, comment, close };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const opts = parseArgv(process.argv.slice(2));
    if (!opts.number) throw new Error("Usage: node issue-update.mjs <number> --repo R [--add-label L] [--remove-label L] [--comment T] [--close]");
    process.stdout.write(JSON.stringify(updateIssue(opts), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
