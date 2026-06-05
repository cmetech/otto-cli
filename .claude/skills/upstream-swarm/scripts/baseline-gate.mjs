#!/usr/bin/env node
/**
 * baseline-gate.mjs — pre-flight: run full local gate against origin/main.
 * Aborts the swarm before any PRs open if main itself is rotten.
 * CLI: node baseline-gate.mjs --workdir <dir> --log <path> [--base origin/main]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as pdir, resolve } from "node:path";

const HERE = pdir(fileURLToPath(import.meta.url));
const RUN_GATES = resolve(HERE, "..", "..", "upstream-fix", "scripts", "run-gates.mjs");

function defaultWorktreeRunner(args) { return { status: 0, stdout: execFileSync("git", args, { encoding: "utf-8" }), stderr: "" }; }

async function defaultGateRunner({ workdir, logPath }) {
  // Dynamic import so unit tests don't require run-gates on disk.
  const { runGate } = await import(RUN_GATES);
  return runGate({ gate: "full", cwd: workdir, logPath });
}

export function runBaselineGate({ workdir, logPath, base = "origin/main", worktreeRunner = defaultWorktreeRunner, gateRunner = defaultGateRunner }) {
  mkdirSync(dirname(logPath), { recursive: true });
  // Create a detached worktree at base.
  worktreeRunner(["worktree", "add", "--detach", workdir, base]);
  // gateRunner may be sync (tests) or async (real). Normalize.
  const out = gateRunner({ workdir, logPath });
  if (out && typeof out.then === "function") {
    // Async path
    return out.then((r) => ({ pass: r.pass, failTail: r.failTail ?? "", logPath }));
  }
  return { pass: out.pass, failTail: out.failTail ?? "", logPath };
}

function parseArgv(argv) {
  let workdir = null, logPath = null, base = "origin/main";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workdir") workdir = argv[++i];
    else if (argv[i] === "--log") logPath = argv[++i];
    else if (argv[i] === "--base") base = argv[++i];
  }
  return { workdir, logPath, base };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  (async () => {
    try {
      const { workdir, logPath, base } = parseArgv(process.argv.slice(2));
      if (!workdir || !logPath) throw new Error("Usage: node baseline-gate.mjs --workdir <dir> --log <path> [--base origin/main]");
      const r = await runBaselineGate({ workdir, logPath, base });
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      if (!r.pass) process.exit(2);
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
      process.exit(1);
    }
  })();
}
