import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { _clearWorkflowRootCache } from "../../paths.ts";
import { requireProject } from "./require-project.ts";

function makeCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
    },
  };
}

test("returns null and notifies when cwd is not in a project", () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-req-proj-"));
  const ctx = makeCtx();
  try {
    const result = requireProject(ctx as any, dir);
    assert.equal(result, null);
    assert.equal(ctx.notifications.length, 1);
    assert.match(ctx.notifications[0].message, /No OTTO project here/);
    assert.match(ctx.notifications[0].message, /\/otto init/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns the project root when cwd is inside a .otto/workflow/ project", () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-req-proj-yes-"));
  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  const ctx = makeCtx();
  try {
    const result = requireProject(ctx as any, dir);
    assert.ok(result, "should return project path");
    assert.match(result!, /\.otto\/workflow$/);
    assert.equal(ctx.notifications.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null and notifies when cwd is $HOME without a project", () => {
  _clearWorkflowRootCache();
  const ctx = makeCtx();
  const result = requireProject(ctx as any, homedir());
  if (result !== null) return;
  assert.equal(result, null);
  assert.equal(ctx.notifications.length, 1);
  assert.match(ctx.notifications[0].message, /No OTTO project here/);
});
