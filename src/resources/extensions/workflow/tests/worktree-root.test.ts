import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveWorktreeProjectRoot } from "../worktree-root.ts";

test("resolveWorktreeProjectRoot: explicit non-worktree cwd beats stale OTTO_PROJECT_ROOT", (t) => {
  const previous = process.env.OTTO_PROJECT_ROOT;
  const dir = mkdtempSync(join(tmpdir(), "gsd-root-"));
  const projectDir = join(dir, "project");
  mkdirSync(projectDir);
  process.env.OTTO_PROJECT_ROOT = "/Users/example";

  t.after(() => {
    if (previous === undefined) {
      delete process.env.OTTO_PROJECT_ROOT;
    } else {
      process.env.OTTO_PROJECT_ROOT = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(resolveWorktreeProjectRoot(projectDir), projectDir);
});

test("resolveWorktreeProjectRoot: external OTTO home is not treated as a project root", (t) => {
  const previous = process.env.OTTO_HOME;
  const dir = mkdtempSync(join(tmpdir(), "gsd-root-"));
  const fakeHome = join(dir, "home");
  const projectDir = join(fakeHome, "work", "project");
  mkdirSync(join(fakeHome, ".otto"), { recursive: true });
  mkdirSync(join(fakeHome, ".git"), { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  process.env.OTTO_HOME = join(fakeHome, ".otto");

  t.after(() => {
    if (previous === undefined) {
      delete process.env.OTTO_HOME;
    } else {
      process.env.OTTO_HOME = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(resolveWorktreeProjectRoot(projectDir), projectDir);
});

test("resolveWorktreeProjectRoot: OTTO_PROJECT_ROOT still anchors auto-worktree paths", (t) => {
  const previous = process.env.OTTO_PROJECT_ROOT;
  const dir = mkdtempSync(join(tmpdir(), "gsd-root-"));
  const projectDir = join(dir, "project");
  const worktreeDir = join(projectDir, ".otto/workflow", "worktrees", "M001");
  mkdirSync(worktreeDir, { recursive: true });
  process.env.OTTO_PROJECT_ROOT = projectDir;

  t.after(() => {
    if (previous === undefined) {
      delete process.env.OTTO_PROJECT_ROOT;
    } else {
      process.env.OTTO_PROJECT_ROOT = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(resolveWorktreeProjectRoot(worktreeDir), projectDir);
});
