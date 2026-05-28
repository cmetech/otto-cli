import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { workflowRoot, _clearWorkflowRootCache } from "../../paths.ts";
/** Create a tmp dir and resolve symlinks + 8.3 short names (macOS /var→/private/var, Windows RUNNER~1→runneradmin). */
function tmp(): string {
  const p = mkdtempSync(join(tmpdir(), "gsd-paths-test-"));
  try { return realpathSync.native(p); } catch { return p; }
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function initGit(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

describe('paths', () => {
  test('Case 1: .otto/workflow exists at basePath — fast path', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, ".otto/workflow"), { recursive: true });
      _clearWorkflowRootCache();
      const result = workflowRoot(root);
      assert.deepStrictEqual(result, join(root, ".otto/workflow"), "fast path: returns basePath/.otto/workflow");
    } finally { cleanup(root); }
  });

  test('Case 2: .otto/workflow exists at git root, cwd is a subdirectory', () => {
    const root = tmp();
    try {
      initGit(root);
      mkdirSync(join(root, ".otto/workflow"), { recursive: true });
      const sub = join(root, "src", "deep");
      mkdirSync(sub, { recursive: true });
      _clearWorkflowRootCache();
      const result = workflowRoot(sub);
      assert.deepStrictEqual(result, join(root, ".otto/workflow"), "git-root probe: finds .otto/workflow at git root from subdirectory");
    } finally { cleanup(root); }
  });

  test('Case 3: .otto/workflow in an ancestor — walk-up finds it', () => {
    const root = tmp();
    try {
      initGit(root);
      const project = join(root, "project");
      mkdirSync(join(project, ".otto/workflow"), { recursive: true });
      const deep = join(project, "src", "deep");
      mkdirSync(deep, { recursive: true });
      _clearWorkflowRootCache();
      const result = workflowRoot(deep);
      assert.deepStrictEqual(result, join(project, ".otto/workflow"), "walk-up: finds .otto/workflow in ancestor when git root has none");
    } finally { cleanup(root); }
  });

  test('Case 4: .otto/workflow nowhere — fallback returns original basePath/.otto/workflow', () => {
    const root = tmp();
    try {
      initGit(root);
      const sub = join(root, "src");
      mkdirSync(sub, { recursive: true });
      _clearWorkflowRootCache();
      const result = workflowRoot(sub);
      assert.deepStrictEqual(result, join(sub, ".otto/workflow"), "fallback: returns basePath/.otto/workflow when .otto/workflow not found anywhere");
    } finally { cleanup(root); }
  });

  test('Case 5: cache — second call returns same value without re-probing', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, ".otto/workflow"), { recursive: true });
      _clearWorkflowRootCache();
      const first = workflowRoot(root);
      const second = workflowRoot(root);
      assert.deepStrictEqual(first, second, "cache: same result returned on second call");
      assert.ok(first === second, "cache: identity check (same string)");
    } finally { cleanup(root); }
  });

  test('Case 6: .otto/workflow at basePath takes precedence over ancestor .otto/workflow', () => {
    const outer = tmp();
    try {
      initGit(outer);
      mkdirSync(join(outer, ".otto/workflow"), { recursive: true });
      const inner = join(outer, "nested");
      mkdirSync(join(inner, ".otto/workflow"), { recursive: true });
      _clearWorkflowRootCache();
      const result = workflowRoot(inner);
      assert.deepStrictEqual(result, join(inner, ".otto/workflow"), "precedence: nearest .otto/workflow wins over ancestor");
    } finally { cleanup(outer); }
  });
});
