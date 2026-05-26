// the agent + gsd-root-canonical: workflowRoot() result is realpath-canonicalized before caching

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { workflowRoot, _clearWorkflowRootCache } from "../paths.ts";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("workflowRoot: returns realpath-canonicalized result", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "gsd-root-canon-")));
    mkdirSync(join(projectDir, ".otto/workflow"), { recursive: true });
    _clearWorkflowRootCache();
  });

  afterEach(() => {
    _clearWorkflowRootCache();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("workflowRoot from a canonical project path returns a realpath-canonicalized result", () => {
    const result = workflowRoot(projectDir);
    const canonical = realpathSync(join(projectDir, ".otto/workflow"));
    assert.equal(result, canonical, "workflowRoot must return the realpath of the .otto/workflow directory");
  });

  test("workflowRoot via a symlinked project path returns the realpath-canonicalized .otto/workflow", (t) => {
    // Create a symlink pointing to projectDir
    const linkPath = join(tmpdir(), `gsd-root-link-${randomUUID()}`);
    symlinkSync(projectDir, linkPath);
    t.after(() => {
      try { rmSync(linkPath); } catch { /* ignore */ }
    });

    _clearWorkflowRootCache();

    const result = workflowRoot(linkPath);
    // The canonical .otto/workflow is under the realpath of projectDir, not the symlink
    const canonicalGsd = realpathSync(join(projectDir, ".otto/workflow"));

    assert.equal(
      result,
      canonicalGsd,
      `workflowRoot via symlink ("${linkPath}") must return the realpath'd .otto/workflow ("${canonicalGsd}"), not a symlink-based path`,
    );

    // Also verify that the result does NOT contain the symlink in its path
    assert.ok(
      !result.startsWith(linkPath),
      `workflowRoot result must not start with the symlink path "${linkPath}"`,
    );
  });
});
