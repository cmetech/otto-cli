#!/usr/bin/env node
/**
 * baseline-gate.mjs — pre-flight: run full local gate against origin/main.
 * Aborts the swarm before any PRs open if main itself is rotten.
 * CLI: node baseline-gate.mjs --workdir <dir> --log <path> [--base origin/main]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve, dirname as pdir } from "node:path";
import { fileURLToPath } from "node:url";
import { provisionWorktreeNodeModules, registerWorktree } from "../../_common/scripts/worktree.mjs";

const HERE = pdir(fileURLToPath(import.meta.url));
const RUN_GATES = resolve(HERE, "..", "..", "_common", "scripts", "run-gates.mjs");
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

function defaultWorktreeRunner(args) { return { status: 0, stdout: execFileSync("git", args, { encoding: "utf-8" }), stderr: "" }; }

function defaultProvisionDeps({ workdir }) {
  // Same filesystem, same lock at origin/main vs HEAD in 99% of cases;
  // correctness comes from the lock being unchanged between root and
  // base. If you ever break this assumption, swap to
  // `npm ci --prefer-offline --no-audit`.
  provisionWorktreeNodeModules(workdir, REPO_ROOT);
}

async function defaultGateRunner({ workdir, logPath }) {
  // Dynamic import so unit tests don't require run-gates on disk.
  const { runGate } = await import(RUN_GATES);
  return runGate({ gate: "full", cwd: workdir, logPath });
}

const DEFAULT_REGISTRY = ".planning/upstream-swarms/.worktree-registry.json";

export function runBaselineGate({ workdir, logPath, base = "origin/main", uniqueSuffix = String(process.pid), registryPath = DEFAULT_REGISTRY, worktreeRunner = defaultWorktreeRunner, provisionDeps = defaultProvisionDeps, gateRunner = defaultGateRunner }) {
  mkdirSync(dirname(logPath), { recursive: true });
  // Per-process worktree path. The Workflow runtime auto-retries a stalled
  // ctl agent (e.g. the ~180s cold-start), which can spawn a SECOND baseline
  // gate while the first is still running its suite. With a fixed workdir, the
  // retry's `worktree remove --force` deletes the first's cwd mid-suite →
  // `ENOENT: uv_cwd`. Suffixing the worktree with the process id makes the two
  // invocations use distinct paths, so a retry never clobbers a live gate.
  const wd = uniqueSuffix ? `${workdir}-${uniqueSuffix}` : workdir;
  // Idempotent: a prior failed gate may have left this worktree on disk
  // (it's deliberately kept for inspection). Force-remove it first so the
  // add below doesn't throw "worktree already exists". Best-effort.
  try { worktreeRunner(["worktree", "remove", "--force", wd]); } catch { /* nothing to remove */ }
  // Create a detached worktree at base.
  worktreeRunner(["worktree", "add", "--detach", wd, base]);
  try { registerWorktree(registryPath, { path: wd, owner: "swarm-baseline", createdAt: Date.now() }); }
  catch { /* best-effort */ }
  // Provision node_modules so the gate can actually run.
  provisionDeps({ workdir: wd });
  // gateRunner may be sync (tests) or async (real). Normalize.
  const out = gateRunner({ workdir: wd, logPath });
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
