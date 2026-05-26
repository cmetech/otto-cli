// the agent + db-writer path containment: regression tests for path.relative-based traversal guard

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, closeDatabase } from "../db.ts";
import { createWorkspace, scopeMilestone } from "../workspace.ts";
import {
  saveArtifactToDbForWorkspace,
  saveArtifactToDbByScope,
} from "../db-writer.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProjectDir(base: string): string {
  mkdirSync(join(base, ".otto/workflow", "milestones"), { recursive: true });
  return base;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("saveArtifactToDbForWorkspace: path.relative containment guard", () => {
  let tmp: string;
  let projectDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gsd-path-contain-fw-"));
    projectDir = makeProjectDir(tmp);
    openDatabase(join(projectDir, ".otto/workflow", "otto.db"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmp, { recursive: true, force: true });
  });

  // Attack: /foo/.otto/workflow-other/file resolves to a path that startsWith("/foo/.otto/workflow")
  // but is NOT inside /foo/.otto/workflow/. The path.relative fix correctly detects this.
  test("rejects sibling directory that startsWith would have accepted", async () => {
    // Create a sibling directory next to .otto/workflow that shares the prefix
    const sibling = join(projectDir, ".otto/workflow-other");
    mkdirSync(sibling, { recursive: true });

    const ws = createWorkspace(projectDir);
    // Craft an opts.path that traverses out of .otto/workflow into .otto/workflow-other
    // resolve(workflowDir, "../.otto/workflow-other/evil.md") === projectDir + "/.otto/workflow-other/evil.md"
    // which startsWith(projectDir + "/.otto/workflow") because ".otto/workflow-other" starts with ".otto/workflow"
    const traversalPath = "../.otto/workflow-other/evil.md";

    await assert.rejects(
      () =>
        saveArtifactToDbForWorkspace(ws, {
          path: traversalPath,
          artifact_type: "CONTEXT",
          content: "attack",
        }),
      /path escapes \.otto\/workflow\/ directory/,
    );
  });

  test("rejects absolute path input", async () => {
    const ws = createWorkspace(projectDir);
    await assert.rejects(
      () =>
        saveArtifactToDbForWorkspace(ws, {
          path: "/etc/passwd",
          artifact_type: "CONTEXT",
          content: "attack",
        }),
      /path escapes \.otto\/workflow\/ directory/,
    );
  });

  test("accepts a legitimate path inside .otto/workflow/", async () => {
    const ws = createWorkspace(projectDir);
    // Should not throw — CONTEXT.md inside .otto/workflow is valid
    await assert.doesNotReject(() =>
      saveArtifactToDbForWorkspace(ws, {
        path: "CONTEXT.md",
        artifact_type: "CONTEXT",
        content: "# Context\n",
      }),
    );
  });
});

describe("saveArtifactToDbByScope: path.relative containment guard", () => {
  let tmp: string;
  let projectDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gsd-path-contain-bs-"));
    projectDir = makeProjectDir(tmp);
    openDatabase(join(projectDir, ".otto/workflow", "otto.db"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("rejects sibling directory that startsWith would have accepted", async () => {
    const sibling = join(projectDir, ".otto/workflow-other");
    mkdirSync(sibling, { recursive: true });

    const ws = createWorkspace(projectDir);
    const scope = scopeMilestone(ws, "M001");
    const traversalPath = "../.otto/workflow-other/evil.md";

    await assert.rejects(
      () =>
        saveArtifactToDbByScope(scope, {
          path: traversalPath,
          artifact_type: "CONTEXT",
          content: "attack",
        }),
      /path escapes \.otto\/workflow\/ directory/,
    );
  });

  test("rejects absolute path input", async () => {
    const ws = createWorkspace(projectDir);
    const scope = scopeMilestone(ws, "M001");
    await assert.rejects(
      () =>
        saveArtifactToDbByScope(scope, {
          path: "/etc/passwd",
          artifact_type: "CONTEXT",
          content: "attack",
        }),
      /path escapes \.otto\/workflow\/ directory/,
    );
  });

  test("accepts a legitimate milestone-relative path inside .otto/workflow/", async () => {
    mkdirSync(join(projectDir, ".otto/workflow", "milestones", "M001"), {
      recursive: true,
    });
    const ws = createWorkspace(projectDir);
    const scope = scopeMilestone(ws, "M001");
    await assert.doesNotReject(() =>
      saveArtifactToDbByScope(scope, {
        path: "milestones/M001/M001-CONTEXT.md",
        artifact_type: "CONTEXT",
        content: "# Context\n",
      }),
    );
  });
});
