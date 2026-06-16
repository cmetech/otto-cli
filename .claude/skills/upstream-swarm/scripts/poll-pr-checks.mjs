#!/usr/bin/env node
/**
 * poll-pr-checks.mjs — non-blocking CI status snapshot for the swarm.
 *
 * Why this exists: every `poll-ci` action in the scheduler used to imply a
 * blocking `gh pr checks --watch` call, which serializes the swarm to one
 * PR at a time. With prWindow=10 that's an order-of-magnitude waste of
 * the configured pipelining. This script does ONE non-blocking HTTP call
 * via `gh pr checks --json` and returns a structured verdict.
 *
 * The scheduler already re-emits `poll-ci` for every issue in state
 * `awaiting-ci` on every tick — so "pending" is not a failure; it's a
 * no-op that gets re-polled next tick. Only state changes drive ledger
 * transitions.
 *
 * Output shape:
 *   {
 *     state: "pass" | "pending" | "fail",   // ledger driver
 *     pending: string[],                     // required checks still running
 *     blocking: { name, reason }[],          // required checks that failed
 *     informationalReds: string[],           // non-required reds (FYI only)
 *   }
 *
 * Exit codes: 0 always (the scheduler reads `state` to decide; a non-zero
 * exit would conflate "couldn't poll" with "checks failed"). On gh error
 * the script writes { state: "error", message } and exits 0 — the caller
 * decides whether to retry, classify as transient, or quarantine.
 *
 * CLI: node poll-pr-checks.mjs <pr-number> [--repo <owner/name>] [--config <path>]
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { evaluateChecks, loadAllowlist } from "../../_common/scripts/evaluate-checks.mjs";

// Canonical required-checks allowlist (owned by upstream-merge). Used as the
// default for BOTH the exported function and the CLI, so non-CLI callers — the
// swarm-control `poll` subcommand / Workflow driver, which pass no --config —
// get a real path instead of `undefined` (which made loadAllowlist throw
// "path must be of type string", silently breaking the poll→ci-green path).
const DEFAULT_CONFIG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "upstream-merge", "config.json");

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
}

/**
 * Fetch the current check snapshot for a PR and classify it against the
 * required-checks allowlist. Pure aside from the gh call.
 *
 * @param {object} opts
 * @param {number|string} opts.prNumber
 * @param {string} [opts.repo]
 * @param {string} opts.configPath  required-checks allowlist
 * @param {function} [opts.ghRunner]
 * @returns {{state, pending, blocking, informationalReds}|{state:"error", message}}
 */
export function pollPrChecks({ prNumber, repo = "cmetech/otto-cli", configPath = DEFAULT_CONFIG, ghRunner = defaultGhRunner }) {
  let raw;
  try {
    raw = ghRunner(["pr", "checks", String(prNumber), "--repo", repo, "--json", "name,bucket,state"]);
  } catch (err) {
    return { state: "error", message: err.message ?? String(err) };
  }
  let checks;
  try {
    checks = JSON.parse(raw);
  } catch (err) {
    return { state: "error", message: `gh returned non-JSON: ${(raw ?? "").slice(0, 120)}` };
  }
  const allowlist = loadAllowlist(configPath);
  const verdict = evaluateChecks(checks, allowlist);
  // Map the evaluate-checks shape (which conflates pending and blocking
  // under `pass:false`) into a state with stable semantics for the
  // scheduler:
  //   - real blocking (anything other than "required check missing", OR
  //     missing checks with no pending checks alongside)
  //                                  → "fail"    (drives ci-red)
  //   - any pending — including pending alongside missing checks that
  //     are matrix-children of the pending job (fresh-PR matrix race)
  //                                  → "pending" (re-poll next tick; no transition)
  //   - else                         → "pass"    (drives ci-green)
  //
  // Why the matrix-race carve-out: GitHub's check-runs API only
  // surfaces checks once their workflow run has been created. A matrix
  // job (e.g. test-unit, test-packages) that depends on a build job
  // doesn't appear at all until build completes. Treating "missing
  // required check" as `fail` while `build` is still pending would
  // quarantine every fresh PR.
  const realBlocking = verdict.blocking.filter((b) => b.reason !== "required check missing");
  let state;
  if (realBlocking.length > 0) state = "fail";
  else if (verdict.pending.length > 0) state = "pending";
  else if (verdict.blocking.length > 0) state = "fail";
  else state = "pass";
  return {
    state,
    pending: verdict.pending,
    blocking: verdict.blocking,
    informationalReds: verdict.informationalReds,
  };
}

function parseArgv(argv) {
  const prNumber = argv[0];
  // Default config lives under upstream-merge, since that's where the
  // required-checks allowlist is canonically owned (shared with pollPrChecks).
  let configPath = DEFAULT_CONFIG;
  let repo = "cmetech/otto-cli";
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--config") configPath = argv[++i];
    else if (argv[i] === "--repo") repo = argv[++i];
  }
  return { prNumber, configPath, repo };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { prNumber, configPath, repo } = parseArgv(process.argv.slice(2));
    if (!prNumber) throw new Error("Usage: node poll-pr-checks.mjs <pr-number> [--repo <owner/name>] [--config <path>]");
    const r = pollPrChecks({ prNumber, repo, configPath });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    // Always exit 0 — see header comment.
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
