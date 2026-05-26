/**
 * gitignore-tracked-gsd.test.ts — Regression tests for #1364.
 *
 * Verifies that ensureGitignore() does NOT add ".otto/workflow" to .gitignore
 * when .otto/workflow/ contains git-tracked files, and that migrateToExternalState()
 * aborts migration for tracked .otto/workflow/ directories.
 *
 * Uses real temporary git repos — no mocks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureGitignore, hasGitTrackedWorkflowFiles } from "../../gitignore.ts";
import { migrateToExternalState } from "../../migrate-external.ts";

// ─── Helpers ─────────────────────────────────────────────────────────

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf-8" }).trim();
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-gitignore-test-"));
  git(dir, "init");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# init\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  git(dir, "branch", "-M", "main");
  return dir;
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ─── hasGitTrackedWorkflowFiles ───────────────────────────────────────────

test("hasGitTrackedWorkflowFiles returns false when .otto/workflow/ does not exist", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  assert.equal(hasGitTrackedWorkflowFiles(dir), false);
});

test("hasGitTrackedWorkflowFiles returns true when .otto/workflow/ has tracked files", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  mkdirSync(join(dir, ".otto/workflow", "milestones"), { recursive: true });
  writeFileSync(join(dir, ".otto/workflow", "PROJECT.md"), "# Test Project\n");
  git(dir, "add", ".otto/workflow/PROJECT.md");
  git(dir, "commit", "-m", "add gsd");
  assert.equal(hasGitTrackedWorkflowFiles(dir), true);
});

test("hasGitTrackedWorkflowFiles returns false when .otto/workflow/ exists but is untracked", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  writeFileSync(join(dir, ".otto/workflow", "STATE.md"), "state\n");
  // Not git-added — should return false
  assert.equal(hasGitTrackedWorkflowFiles(dir), false);
});

// ─── ensureGitignore — tracked .otto/workflow/ protection ─────────────────────

test("ensureGitignore does NOT add .otto/workflow when .otto/workflow/ has tracked files (#1364)", (t) => {
  const dir = makeTempRepo();
  try {
    // Set up .otto/workflow/ with tracked files
    mkdirSync(join(dir, ".otto/workflow", "milestones"), { recursive: true });
    writeFileSync(join(dir, ".otto/workflow", "PROJECT.md"), "# Test Project\n");
    writeFileSync(join(dir, ".otto/workflow", "DECISIONS.md"), "# Decisions\n");
    git(dir, "add", ".otto/workflow/");
    git(dir, "commit", "-m", "track gsd state");

    // Run ensureGitignore
    ensureGitignore(dir);

    // Verify .otto/workflow is NOT in .gitignore
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    const lines = gitignore.split("\n").map((l) => l.trim());
    assert.ok(
      !lines.includes(".otto/workflow"),
      `Expected .otto/workflow NOT to appear in .gitignore, but it does:\n${gitignore}`,
    );

    // Other baseline patterns should still be present
    assert.ok(lines.includes(".DS_Store"), "Expected .DS_Store in .gitignore");
    assert.ok(lines.includes("node_modules/"), "Expected node_modules/ in .gitignore");
    assert.ok(lines.includes(".mcp.json"), "Expected .mcp.json in .gitignore");
  } finally {
    cleanup(dir);
  }
});

test("ensureGitignore adds .otto/workflow when .otto/workflow/ has NO tracked files", (t) => {
  const dir = makeTempRepo();
  try {
    // Run ensureGitignore (no .otto/workflow/ at all)
    ensureGitignore(dir);

    // Verify .otto/workflow IS in .gitignore
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    const lines = gitignore.split("\n").map((l) => l.trim());
    assert.ok(
      lines.includes(".otto/workflow"),
      `Expected .otto/workflow in .gitignore, but it's missing:\n${gitignore}`,
    );
  } finally {
    cleanup(dir);
  }
});

test("ensureGitignore respects manageGitignore: false", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  const result = ensureGitignore(dir, { manageGitignore: false });
  assert.equal(result, false);
  assert.ok(!existsSync(join(dir, ".gitignore")), "Should not create .gitignore");
});

// ─── ensureGitignore — verify no tracked files become invisible ─────

test("ensureGitignore with tracked .otto/workflow/ does not cause git to see files as deleted", (t) => {
  const dir = makeTempRepo();
  try {
    // Create tracked .otto/workflow/ files
    mkdirSync(join(dir, ".otto/workflow", "milestones", "M001"), { recursive: true });
    writeFileSync(join(dir, ".otto/workflow", "PROJECT.md"), "# Project\n");
    writeFileSync(
      join(dir, ".otto/workflow", "milestones", "M001", "M001-CONTEXT.md"),
      "# M001\n",
    );
    git(dir, "add", ".otto/workflow/");
    git(dir, "commit", "-m", "track gsd state");

    // Run ensureGitignore
    ensureGitignore(dir);

    // git status should show NO deleted files under .otto/workflow/
    const status = git(dir, "status", "--porcelain", ".otto/workflow/");

    // Filter for deletions (lines starting with " D" or "D ")
    const deletions = status
      .split("\n")
      .filter((l) => l.match(/^\s*D\s/) || l.match(/^D\s/));

    assert.equal(
      deletions.length,
      0,
      `Expected no deleted .otto/workflow/ files, but found:\n${deletions.join("\n")}`,
    );
  } finally {
    cleanup(dir);
  }
});

test("hasGitTrackedWorkflowFiles returns true (fail-safe) when git is not available", (t) => {
  const dir = makeTempRepo();
  try {
    // Create and track .otto/workflow/ files
    mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
    writeFileSync(join(dir, ".otto/workflow", "PROJECT.md"), "# Project\n");
    git(dir, "add", ".otto/workflow/");
    git(dir, "commit", "-m", "track gsd");

    // Corrupt the git index to simulate git failure
    const indexPath = join(dir, ".git", "index.lock");
    writeFileSync(indexPath, "locked");

    // Should fail safe — assume tracked rather than silently returning false
    // (The index lock causes git ls-files to fail; rev-parse also fails → true)
    const result = hasGitTrackedWorkflowFiles(dir);
    assert.equal(result, true, "Should return true (fail-safe) when git is unavailable");
  } finally {
    cleanup(dir);
  }
});

// ─── migrateToExternalState — tracked .otto/workflow/ protection ──────────────

test("migrateToExternalState aborts when .otto/workflow/ has tracked files (#1364)", (t) => {
  const dir = makeTempRepo();
  try {
    // Create tracked .otto/workflow/ files
    mkdirSync(join(dir, ".otto/workflow", "milestones"), { recursive: true });
    writeFileSync(join(dir, ".otto/workflow", "PROJECT.md"), "# Project\n");
    git(dir, "add", ".otto/workflow/");
    git(dir, "commit", "-m", "track gsd state");

    // Attempt migration — should abort without moving anything
    const result = migrateToExternalState(dir);

    assert.equal(result.migrated, false, "Should NOT migrate tracked .otto/workflow/");
    assert.equal(result.error, undefined, "Should not report an error — just skip");

    // .otto/workflow/ should still be a real directory, not a symlink
    assert.ok(existsSync(join(dir, ".otto/workflow", "PROJECT.md")), ".otto/workflow/PROJECT.md should still exist");

    // No .otto/workflow.migrating should exist
    assert.ok(
      !existsSync(join(dir, ".otto/workflow.migrating")),
      ".otto/workflow.migrating should not exist",
    );
  } finally {
    cleanup(dir);
  }
});

test("migrateToExternalState cleans git index so tracked files don't show as deleted (#1364 path 2)", (t) => {
  const dir = makeTempRepo();
  try {
    // Track .otto/workflow/ files, then untrack them so migration proceeds
    mkdirSync(join(dir, ".otto/workflow", "milestones", "M001"), { recursive: true });
    writeFileSync(join(dir, ".otto/workflow", "PROJECT.md"), "# Project\n");
    writeFileSync(join(dir, ".otto/workflow", "milestones", "M001", "PLAN.md"), "# Plan\n");
    git(dir, "add", ".otto/workflow/");
    git(dir, "commit", "-m", "track gsd state");
    git(dir, "rm", "-r", "--cached", ".otto/workflow/");
    git(dir, "commit", "-m", "untrack gsd (simulates pre-migration project)");

    const result = migrateToExternalState(dir);
    assert.equal(result.migrated, true, "Migration should succeed");

    // git status must show NO deleted files after migration
    const status = git(dir, "status", "--porcelain");
    const deletions = status.split("\n").filter((l) => /^\s*D\s/.test(l) || /^D\s/.test(l));
    assert.equal(
      deletions.length,
      0,
      `Expected no deleted files after migration, but found:\n${deletions.join("\n")}`,
    );
  } finally {
    cleanup(dir);
  }
});
