import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { workflowRootOrNull, _clearWorkflowRootCache } from "./paths.ts";

function tmpScratch(): string {
  return mkdtempSync(join(tmpdir(), "otto-wf-root-null-"));
}

test("returns null for cwd in $HOME when no .otto/workflow/ exists", () => {
  _clearWorkflowRootCache();
  const home = homedir();
  const hasMarker = existsSync(join(home, ".otto", "workflow"));
  if (hasMarker) return;
  assert.equal(workflowRootOrNull(home), null);
});

test("returns null in a fresh tmpdir with no project markers", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  try {
    assert.equal(workflowRootOrNull(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores .otto/workflow/ when no .otto/workflow/ exists", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  try {
    assert.equal(workflowRootOrNull(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns path when .otto/workflow/ exists in cwd", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  try {
    const result = workflowRootOrNull(dir);
    assert.ok(result, "should return a path, not null");
    assert.match(result.replaceAll("\\", "/"), /\.otto\/workflow$/, "should end with .otto/workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns .otto/workflow/ even when stale .otto/workflow/ also exists", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  try {
    const result = workflowRootOrNull(dir);
    assert.match(result!.replaceAll("\\", "/"), /\.otto\/workflow$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walks past a .otto/ that has only user-config (no workflow/ subdir)", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".otto"), { recursive: true });
  try {
    assert.equal(workflowRootOrNull(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
