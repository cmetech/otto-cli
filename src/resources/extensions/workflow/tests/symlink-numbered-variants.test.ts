/**
 * Tests for macOS numbered symlink variant cleanup (#2205).
 *
 * macOS can rename `.otto/workflow` to `.otto/workflow 2`, `.otto/workflow 3`, etc. when a directory
 * already exists at the target path. ensureWorkflowSymlink() must detect and
 * remove these numbered variants so the real `.otto/workflow` symlink is always
 * the one in use.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  symlinkSync,
  readlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { ensureWorkflowSymlink, externalWorkflowRoot } from "../repo-identity.ts";
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';


function run(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

describe('symlink-numbered-variants', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-symlink-variants-")));
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "gsd-state-variants-")));

  try {
    process.env.OTTO_STATE_DIR = stateDir;

    // Set up a minimal git repo
    run("git init -b main", base);
    run('git config user.name "Pi Test"', base);
    run('git config user.email "pi@example.com"', base);
    run('git remote add origin git@github.com:example/repo.git', base);
    writeFileSync(join(base, "README.md"), "# Test Repo\n", "utf-8");
    run("git add README.md", base);
    run('git commit -m "chore: init"', base);

    const externalPath = externalWorkflowRoot(base);

    // ── Test: numbered variant directories are cleaned up ──────────────
    console.log("\n=== ensureWorkflowSymlink removes numbered .otto/workflow variants (#2205) ===");
    {
      // Simulate macOS creating numbered variants: ".otto/workflow 2", ".otto/workflow 3"
      mkdirSync(join(base, ".otto/workflow 2"), { recursive: true });
      mkdirSync(join(base, ".otto/workflow 3"), { recursive: true });
      mkdirSync(join(base, ".otto/workflow 4"), { recursive: true });

      const result = ensureWorkflowSymlink(base);
      assert.deepStrictEqual(result, externalPath, "ensureWorkflowSymlink returns external path");
      assert.ok(existsSync(join(base, ".otto/workflow")), ".otto/workflow exists after ensureWorkflowSymlink");
      assert.ok(lstatSync(join(base, ".otto/workflow")).isSymbolicLink(), ".otto/workflow is a symlink");

      // The numbered variants must have been removed
      assert.ok(!existsSync(join(base, ".otto/workflow 2")), '".otto/workflow 2" directory was cleaned up');
      assert.ok(!existsSync(join(base, ".otto/workflow 3")), '".otto/workflow 3" directory was cleaned up');
      assert.ok(!existsSync(join(base, ".otto/workflow 4")), '".otto/workflow 4" directory was cleaned up');
    }

    // ── Test: numbered variant symlinks are cleaned up ─────────────────
    console.log("\n=== ensureWorkflowSymlink removes numbered symlink variants ===");
    {
      // Clean slate
      rmSync(join(base, ".otto/workflow"), { recursive: true, force: true });

      // Simulate: ".otto/workflow 2" is a symlink to the correct target (the real .otto/workflow)
      // and ".otto/workflow" doesn't exist — this is the actual macOS scenario
      const staleTarget = join(stateDir, "projects", "stale-target");
      mkdirSync(staleTarget, { recursive: true });
      symlinkSync(externalPath, join(base, ".otto/workflow 2"), "junction");
      symlinkSync(staleTarget, join(base, ".otto/workflow 3"), "junction");

      const result = ensureWorkflowSymlink(base);
      assert.deepStrictEqual(result, externalPath, "ensureWorkflowSymlink returns external path when variants exist");
      assert.ok(existsSync(join(base, ".otto/workflow")), ".otto/workflow exists");
      assert.ok(lstatSync(join(base, ".otto/workflow")).isSymbolicLink(), ".otto/workflow is a symlink");

      assert.ok(!existsSync(join(base, ".otto/workflow 2")), '".otto/workflow 2" symlink variant was cleaned up');
      assert.ok(!existsSync(join(base, ".otto/workflow 3")), '".otto/workflow 3" symlink variant was cleaned up');
    }

    // ── Test: real .otto/workflow directory blocks symlink, but variants still cleaned ──
    console.log("\n=== ensureWorkflowSymlink cleans variants even when .otto/workflow is a real directory ===");
    {
      // Clean slate
      rmSync(join(base, ".otto/workflow"), { recursive: true, force: true });

      // .otto/workflow is a real directory (git-tracked) and numbered variants exist
      mkdirSync(join(base, ".otto/workflow", "milestones"), { recursive: true });
      writeFileSync(join(base, ".otto/workflow", "milestones", "M001.md"), "# M001\n", "utf-8");
      mkdirSync(join(base, ".otto/workflow 2"), { recursive: true });
      mkdirSync(join(base, ".otto/workflow 3"), { recursive: true });

      const result = ensureWorkflowSymlink(base);
      // When .otto/workflow is a real directory, ensureWorkflowSymlink preserves it
      assert.deepStrictEqual(result, join(base, ".otto/workflow"), "real .otto/workflow directory preserved");
      assert.ok(lstatSync(join(base, ".otto/workflow")).isDirectory(), ".otto/workflow remains a directory");

      // But the numbered variants should still be cleaned up
      assert.ok(!existsSync(join(base, ".otto/workflow 2")), '".otto/workflow 2" cleaned even when .otto/workflow is a directory');
      assert.ok(!existsSync(join(base, ".otto/workflow 3")), '".otto/workflow 3" cleaned even when .otto/workflow is a directory');
    }

    // ── Test: only numeric-suffixed variants are removed ───────────────
    console.log("\n=== ensureWorkflowSymlink only removes .otto/workflow + space + digit variants ===");
    {
      rmSync(join(base, ".otto/workflow"), { recursive: true, force: true });

      // These should NOT be touched
      mkdirSync(join(base, ".otto/workflow-backup"), { recursive: true });
      mkdirSync(join(base, ".otto_old"), { recursive: true });

      // These SHOULD be removed (macOS collision pattern)
      mkdirSync(join(base, ".otto/workflow 2"), { recursive: true });
      mkdirSync(join(base, ".otto/workflow 10"), { recursive: true });

      ensureWorkflowSymlink(base);

      assert.ok(existsSync(join(base, ".otto/workflow-backup")), ".otto/workflow-backup is NOT removed");
      assert.ok(existsSync(join(base, ".otto_old")), ".otto_old is NOT removed");
      assert.ok(!existsSync(join(base, ".otto/workflow 2")), '".otto/workflow 2" removed');
      assert.ok(!existsSync(join(base, ".otto/workflow 10")), '".otto/workflow 10" removed');

      // Cleanup non-variant dirs
      rmSync(join(base, ".otto/workflow-backup"), { recursive: true, force: true });
      rmSync(join(base, ".otto_old"), { recursive: true, force: true });
    }

  } finally {
    delete process.env.OTTO_STATE_DIR;
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
