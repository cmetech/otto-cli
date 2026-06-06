#!/usr/bin/env node
/**
 * worktree-node-modules.mjs — provision a worktree's node_modules by
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
import { symlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
