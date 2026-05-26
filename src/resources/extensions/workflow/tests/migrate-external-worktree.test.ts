import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { migrateToExternalState, recoverFailedMigration } from "../migrate-external.ts";

function run(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

describe("migrate-external worktree guard (#2970)", () => {
  let base: string;
  let stateDir: string;
  let worktreePath: string;

  before(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-migrate-wt-")));
    stateDir = realpathSync(mkdtempSync(join(tmpdir(), "gsd-state-")));
    process.env.OTTO_STATE_DIR = stateDir;

    // Create a git repo with a remote
    run("git init -b main", base);
    run('git config user.name "Test"', base);
    run('git config user.email "test@example.com"', base);
    run('git remote add origin git@github.com:example/repo.git', base);
    writeFileSync(join(base, "README.md"), "# Test\n", "utf-8");
    run("git add README.md", base);
    run('git commit -m "init"', base);

    // Create a worktree
    worktreePath = join(base, ".otto/workflow", "worktrees", "M001");
    run(`git worktree add -b milestone/M001 ${worktreePath}`, base);

    // Populate worktree with a .otto/workflow directory (simulating syncWorkflowStateToWorktree)
    const worktreeGsd = join(worktreePath, ".otto/workflow");
    mkdirSync(worktreeGsd, { recursive: true });
    writeFileSync(join(worktreeGsd, "PREFERENCES.md"), "# prefs\n", "utf-8");
  });

  after(() => {
    delete process.env.OTTO_STATE_DIR;
    // Remove worktree before cleaning up
    try { run(`git worktree remove --force ${worktreePath}`, base); } catch { /* ok */ }
    rmSync(base, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("migrateToExternalState skips when basePath is a git worktree", () => {
    // The worktree has a real .otto/workflow directory — migration would normally run.
    // But since this is a worktree, it should be skipped.
    const result = migrateToExternalState(worktreePath);

    assert.equal(result.migrated, false, "should not migrate inside a worktree");
    assert.equal(result.error, undefined, "should not report an error");

    // .otto/workflow should still exist as a real directory (not renamed/removed)
    assert.ok(
      existsSync(join(worktreePath, ".otto/workflow")),
      ".otto/workflow directory should still exist after skipped migration"
    );

    // .otto/workflow.migrating should NOT exist
    assert.ok(
      !existsSync(join(worktreePath, ".otto/workflow.migrating")),
      ".otto/workflow.migrating should not be created in a worktree"
    );
  });

  test("migrateToExternalState does not leave .otto/workflow.migrating on failed migration", () => {
    // Regression: #5571 — .otto/workflow.migrating orphaned when cpSync succeeds but rmSync fails.
    // Here we verify the invariant: after migrateToExternalState returns migrated:false,
    // no .otto/workflow.migrating exists in the worktree (which is always skipped by the guard).
    const result = migrateToExternalState(worktreePath);
    assert.equal(result.migrated, false);
    assert.ok(
      !existsSync(join(worktreePath, ".otto/workflow.migrating")),
      ".otto/workflow.migrating must not be left behind after a skipped/failed migration"
    );
  });

  test("migrateToExternalState still works on main repo", () => {
    // Create a fresh temp repo to test main repo migration path
    const mainBase = realpathSync(mkdtempSync(join(tmpdir(), "gsd-migrate-main-")));
    try {
      run("git init -b main", mainBase);
      run('git config user.name "Test"', mainBase);
      run('git config user.email "test@example.com"', mainBase);
      run('git remote add origin git@github.com:example/main-repo.git', mainBase);
      writeFileSync(join(mainBase, "README.md"), "# Test\n", "utf-8");
      run("git add README.md", mainBase);
      run('git commit -m "init"', mainBase);

      // Create a .otto/workflow directory with content
      mkdirSync(join(mainBase, ".otto/workflow"), { recursive: true });
      writeFileSync(join(mainBase, ".otto/workflow", "PREFERENCES.md"), "# prefs\n", "utf-8");

      const result = migrateToExternalState(mainBase);
      assert.equal(result.migrated, true, "should migrate on main repo");
    } finally {
      rmSync(mainBase, { recursive: true, force: true });
    }
  });
});

// Regression tests for #5571 — recoverFailedMigration handles orphaned .otto/workflow.migrating
describe("recoverFailedMigration (#5571)", () => {
  test("returns false when .otto/workflow.migrating does not exist", () => {
    const base = mkdtempSync(join(tmpdir(), "gsd-recover-"));
    try {
      const result = recoverFailedMigration(base);
      assert.equal(result, false, "should return false when no .otto/workflow.migrating exists");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("returns false and leaves both dirs untouched when both .otto/workflow and .otto/workflow.migrating exist", () => {
    const base = mkdtempSync(join(tmpdir(), "gsd-recover-ambiguous-"));
    try {
      mkdirSync(join(base, ".otto/workflow"), { recursive: true });
      mkdirSync(join(base, ".otto/workflow.migrating"), { recursive: true });

      const result = recoverFailedMigration(base);
      assert.equal(result, false, "ambiguous state must not be auto-resolved");
      assert.ok(existsSync(join(base, ".otto/workflow")), ".otto/workflow should remain");
      assert.ok(existsSync(join(base, ".otto/workflow.migrating")), ".otto/workflow.migrating should remain");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("renames .otto/workflow.migrating to .otto/workflow and returns true when only .otto/workflow.migrating exists", () => {
    // This is the primary recovery path for issue #5571:
    // cpSync succeeded (creating .otto/workflow.migrating) but rmSync(localGsd) failed
    // (EPERM file lock). The fix now cleans up .otto/workflow.migrating in that path,
    // but if cleanup also fails, recoverFailedMigration handles the next boot.
    const base = mkdtempSync(join(tmpdir(), "gsd-recover-rename-"));
    try {
      mkdirSync(join(base, ".otto/workflow.migrating"), { recursive: true });
      writeFileSync(join(base, ".otto/workflow.migrating", "PREFERENCES.md"), "# prefs\n", "utf-8");

      const result = recoverFailedMigration(base);
      assert.equal(result, true, "should rename .otto/workflow.migrating to .otto/workflow");
      assert.ok(existsSync(join(base, ".otto/workflow")), ".otto/workflow should exist after recovery");
      assert.ok(existsSync(join(base, ".otto/workflow", "PREFERENCES.md")), "contents should be preserved");
      assert.ok(!existsSync(join(base, ".otto/workflow.migrating")), ".otto/workflow.migrating should be gone");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
