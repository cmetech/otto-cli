#!/usr/bin/env node
/**
 * worktree.mjs — provision a worktree's node_modules by
 * symlinking the repo root's installation.
 *
 * Why: a fresh `git worktree add` produces an empty checkout. Gates that
 * invoke `npm test` or `npm run verify:pr` (baseline-gate, per-PR local
 * gate via trial-merge) fail at the first require("esbuild") unless
 * node_modules is provisioned. A full `npm ci` per worktree is wasteful
 * — the lockfile at origin/main vs HEAD almost never differs for the
 * worktree base we use. Symlinking the repo root's node_modules is
 * orders of magnitude faster and correct in the steady state.
 *
 * Caller contracts:
 *   - Idempotent: no-op if the symlink already exists.
 *   - Throws if the repo-root node_modules doesn't exist (run `npm ci`).
 *   - Resolves repo root via the second argument; callers pass their
 *     own resolved path so this helper doesn't have to know about the
 *     skill directory layout.
 */
import { symlinkSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Symlink `<repoRoot>/node_modules` into `<workdir>/node_modules`.
 * No-op if the destination already exists.
 *
 * @param {string} workdir absolute path to the worktree
 * @param {string} repoRoot absolute path to the repo root
 * @param {object} [opts]
 * @param {function} [opts.symlinker] override for tests; default symlinkSync
 * @param {function} [opts.checkExists] override for tests; default existsSync
 */
export function provisionWorktreeNodeModules(workdir, repoRoot, opts = {}) {
  const symlinker = opts.symlinker ?? symlinkSync;
  const checkExists = opts.checkExists ?? existsSync;
  const src = resolve(repoRoot, "node_modules");
  const dest = resolve(workdir, "node_modules");
  if (!checkExists(src)) {
    throw new Error(`repo-root node_modules missing at ${src}; run npm ci first`);
  }
  if (checkExists(dest)) return { linked: false, dest, src };
  symlinker(src, dest, "dir");
  return { linked: true, dest, src };
}

// ---- worktree registry: track + prune lane/baseline worktrees ----

export function readRegistry(registryPath) {
  if (!existsSync(registryPath)) return [];
  try { const v = JSON.parse(readFileSync(registryPath, "utf-8")); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// Cross-process lock around the registry read-modify-write. mkdir is atomic:
// creation fails with EEXIST if the dir already exists. Breaks a stale lock
// left by a crashed process; gives up after maxWaitMs rather than hang a lane.
function withRegistryLock(registryPath, fn, { staleMs = 10_000, retryMs = 25, maxWaitMs = 5000 } = {}) {
  const lockDir = registryPath + ".lock";
  const start = Date.now();
  for (;;) {
    try { mkdirSync(lockDir); break; }
    catch (err) {
      if (err.code !== "EEXIST") throw err;
      // Break a stale lock left by a crashed process.
      try { if (Date.now() - statSync(lockDir).mtimeMs > staleMs) { rmSync(lockDir, { recursive: true, force: true }); continue; } } catch { /* race on stat; retry */ }
      if (Date.now() - start > maxWaitMs) { // give up waiting; proceed unlocked rather than hang the lane
        try { return fn(); } finally { /* no lock to release */ }
      }
      // busy-wait briefly (synchronous; these are short-lived CLI processes)
      const until = Date.now() + retryMs; while (Date.now() < until) { /* spin */ }
      continue;
    }
  }
  try { return fn(); } finally { try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ } }
}

function writeRegistry(registryPath, entries) {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(entries, null, 2) + "\n");
}

// Record (or update) a worktree entry keyed by absolute path.
export function registerWorktree(registryPath, { path, owner, createdAt }) {
  const abs = resolve(path);
  return withRegistryLock(registryPath, () => {
    const entries = readRegistry(registryPath).filter((e) => resolve(e.path) !== abs);
    entries.push({ path: abs, owner, createdAt });
    writeRegistry(registryPath, entries);
    return entries;
  });
}

// Assumes CWD is inside the target repo for `git worktree remove`; the rmSync
// fallback uses the absolute stored path so removal still works out of-tree.
function defaultRemover(path) {
  // Best-effort: ask git to remove the worktree, then delete the dir.
  try { execFileSync("git", ["worktree", "remove", "--force", path], { encoding: "utf-8" }); }
  catch { /* fall through to fs removal */ }
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

// Remove registered worktrees older than ttlMs (by createdAt). Returns { pruned: [...] }.
export function pruneWorktrees(registryPath, { ttlMs, now = Date.now(), remover = defaultRemover } = {}) {
  const entries = readRegistry(registryPath);
  const keep = [];
  const pruned = [];
  for (const e of entries) {
    if (now - e.createdAt >= ttlMs) { remover(e.path); pruned.push(e.path); }
    else keep.push(e);
  }
  writeRegistry(registryPath, keep);
  return { pruned };
}
