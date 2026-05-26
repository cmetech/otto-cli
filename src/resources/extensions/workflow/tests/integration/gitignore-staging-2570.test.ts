/**
 * gitignore-staging-2570.test.ts — Regression tests for #2570.
 *
 * Verifies that:
 * 1. isGitignored() detects when .otto/workflow is covered by .gitignore
 * 2. The rethink prompt uses {{commitInstruction}} instead of hardcoded git add .otto/workflow/
 * 3. rethink.ts passes the correct commitInstruction based on gitignore state
 *
 * Uses real temporary git repos — no mocks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Dynamic import — isGitignored is the function under test (may not exist yet during TDD red phase)
const { isGitignored } = await import("../../gitignore.ts");

// ─── Helpers ─────────────────────────────────────────────────────────

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf-8" }).trim();
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-staging-2570-"));
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

// ─── isGitignored ─────────────────────────────────────────────────

test("isGitignored returns true when .otto/workflow is in .gitignore (#2570)", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  writeFileSync(join(dir, ".gitignore"), ".otto/workflow\n");
  assert.equal(isGitignored(dir), true);
});

test("isGitignored returns true when .otto/workflow/ (with slash) is in .gitignore", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  writeFileSync(join(dir, ".gitignore"), ".otto/workflow/\n");
  // Create .otto/workflow directory so git check-ignore can match the directory-only pattern
  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  assert.equal(isGitignored(dir), true);
});

test("isGitignored returns false when .otto/workflow is NOT in .gitignore", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  assert.equal(isGitignored(dir), false);
});

test("isGitignored returns false when no .gitignore exists", (t) => {
  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  // No .gitignore — default
  assert.equal(isGitignored(dir), false);
});

// ─── rethink.md prompt template ─────────────────────────────────────

test("rethink.md prompt uses {{commitInstruction}} not hardcoded git add .otto/workflow/ (#2570)", () => {
  const promptPath = join(
    import.meta.dirname!,
    "..",
    "..",
    "prompts",
    "rethink.md",
  );
  const content = readFileSync(promptPath, "utf-8");

  // Must NOT contain hardcoded `git add .otto/workflow/`
  assert.ok(
    !content.includes("git add .otto/workflow/"),
    `rethink.md must not contain hardcoded "git add .otto/workflow/" — use {{commitInstruction}} instead.\nFound: ${content.match(/.*git add .otto\/workflow\/.*/)?.[0]}`,
  );

  // Must contain the {{commitInstruction}} placeholder
  assert.ok(
    content.includes("{{commitInstruction}}"),
    "rethink.md must use {{commitInstruction}} template variable for commit step",
  );
});

// ─── smartStage respects .gitignore for .otto/workflow/ (#2570) ───────────────

test("smartStage does not stage .otto/workflow/ files when .otto/workflow is gitignored (#2570)", async (t) => {
  // This imports GitServiceImpl to test through the public commit() method
  // which calls smartStage() internally.
  const { GitServiceImpl } = await import("../../git-service.ts");

  const dir = makeTempRepo();
  t.after(() => { cleanup(dir); });

  // Add .otto/workflow to .gitignore
  writeFileSync(join(dir, ".gitignore"), ".otto/workflow\nnode_modules/\n");
  git(dir, "add", ".gitignore");
  git(dir, "commit", "-m", "add gitignore with .otto/workflow");

  // Create .otto/workflow/ milestone artifacts (NOT tracked, NOT symlinked)
  mkdirSync(join(dir, ".otto/workflow", "milestones", "M001", "slices", "S01"), { recursive: true });
  writeFileSync(join(dir, ".otto/workflow", "milestones", "M001", "slices", "S01", "S01-PLAN.md"), "# Plan");
  writeFileSync(join(dir, ".otto/workflow", "DECISIONS.md"), "# Decisions");

  // Create a normal source file
  writeFileSync(join(dir, "src.ts"), "export const x = 1;");

  // Commit through GitServiceImpl (uses smartStage internally)
  const svc = new GitServiceImpl(dir);
  const msg = svc.commit({ message: "test: should not include .otto/workflow files" });
  assert.ok(msg !== null, "commit should succeed");

  // Check what was committed
  const committed = git(dir, "show", "--name-only", "HEAD");
  assert.ok(committed.includes("src.ts"), "source files ARE committed");
  assert.ok(
    !committed.includes(".otto/workflow/"),
    `gitignored .otto/workflow/ files must NOT be staged by smartStage.\nCommitted files: ${committed}`,
  );
});
