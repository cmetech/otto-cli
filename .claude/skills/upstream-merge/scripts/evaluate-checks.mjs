#!/usr/bin/env node
/**
 * evaluate-checks.mjs — evaluate `gh pr checks --json name,bucket,state` output
 * against a required-checks allowlist. Pure; returns a compact verdict.
 * CLI: node evaluate-checks.mjs <pr-number> [--config <path>] [--repo <owner/name>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RED_BUCKETS = new Set(["fail", "cancel"]);

/** @returns {{pass, pending:string[], blocking:{name,reason}[], informationalReds:string[]}} */
export function evaluateChecks(checks, allowlist) {
  const required = new Set(allowlist);
  const byName = new Map();
  for (const c of checks) byName.set(c.name, c.bucket);

  const blocking = [];
  const pending = [];
  for (const name of allowlist) {
    const bucket = byName.get(name);
    if (bucket === undefined) blocking.push({ name, reason: "required check missing" });
    else if (bucket === "pending") pending.push(name);
    else if (bucket === "pass") { /* ok */ }
    else blocking.push({ name, reason: `required check ${bucket}` });
  }

  const informationalReds = checks
    .filter((c) => !required.has(c.name) && RED_BUCKETS.has(c.bucket))
    .map((c) => c.name);

  return { pass: blocking.length === 0 && pending.length === 0, pending, blocking, informationalReds };
}

export function loadAllowlist(configPath) {
  const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!Array.isArray(cfg.requiredChecks)) throw new Error("config.requiredChecks must be an array");
  return cfg.requiredChecks;
}

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }); }

export function fetchAndEvaluate({ prNumber, repo = "cmetech/otto-cli", configPath, ghRunner = defaultGhRunner }) {
  const raw = ghRunner(["pr", "checks", String(prNumber), "--repo", repo, "--json", "name,bucket,state"]);
  const checks = JSON.parse(raw);
  return evaluateChecks(checks, loadAllowlist(configPath));
}

function parseArgv(argv) {
  const prNumber = argv[0];
  const here = dirname(fileURLToPath(import.meta.url));
  let configPath = join(here, "..", "config.json");
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
    if (!prNumber) throw new Error("Usage: node evaluate-checks.mjs <pr-number> [--config <path>] [--repo <owner/name>]");
    const r = fetchAndEvaluate({ prNumber, repo, configPath });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.pass) process.exit(2);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
