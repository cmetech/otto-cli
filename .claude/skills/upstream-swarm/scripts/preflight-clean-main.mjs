#!/usr/bin/env node
/**
 * preflight-clean-main.mjs — guard against local-main contamination.
 *
 * Why this exists: every per-issue PR opened by the swarm branches off the
 * local repo's main. If local main has commits that haven't been pushed to
 * origin/main, those commits silently ride along on every PR — caught
 * eventually by the refute panel's scope-discipline lens, but only after
 * burning a full CI + local gate cycle. This script catches it before
 * baseline-gate so the swarm aborts cleanly with an actionable message.
 *
 * Returns { clean: bool, ahead: number, behind: number, message }.
 * Exits 0 when clean, 2 when not (distinct from usage error 1).
 *
 * CLI: node preflight-clean-main.mjs [--base origin/main] [--head main]
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

export function preflightCleanMain({ base = "origin/main", head = "main", gitRunner = defaultGitRunner, fetch = true } = {}) {
  if (!SAFE.test(base) || !SAFE.test(head)) throw new Error(`unsafe ref name: ${base} / ${head}`);
  if (fetch) {
    // Pull the latest origin so the ahead/behind counts are honest.
    gitRunner(["fetch", "origin", "--prune"]);
  }
  // `rev-list --count A..B` counts commits reachable from B but not A.
  const ahead = Number(gitRunner(["rev-list", "--count", `${base}..${head}`]));
  const behind = Number(gitRunner(["rev-list", "--count", `${head}..${base}`]));

  if (ahead === 0) {
    return { clean: true, ahead, behind, message: behind > 0
      ? `OK: local ${head} is ${behind} commit(s) behind ${base} (will use ${base} as branch base anyway)`
      : `OK: local ${head} matches ${base}` };
  }
  return {
    clean: false,
    ahead,
    behind,
    message:
      `Local ${head} is ${ahead} commit(s) ahead of ${base}. These commits would leak ` +
      `into every per-issue PR opened by the swarm. Push them (or stash/reset) before running. ` +
      `Inspect: \`git log ${base}..${head}\`. Once pushed: re-run the swarm.`,
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    let base = "origin/main", head = "main";
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--base") base = argv[++i];
      else if (argv[i] === "--head") head = argv[++i];
    }
    const r = preflightCleanMain({ base, head });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.clean) process.exit(2);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
