import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _clearWorkflowRootCache } from "../../resources/extensions/workflow/paths.ts";
import { runInit } from "../../resources/extensions/workflow/commands/handlers/init.ts";

function makeCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: { notify(message: string, level: string) { notifications.push({ message, level }); } },
  };
}

test("end-to-end: runInit in a fresh dir produces a valid project", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-e2e-"));
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(existsSync(join(dir, ".otto", "workflow")));
    assert.equal(existsSync(join(dir, ".gsd")), false);
    const manifest = JSON.parse(readFileSync(join(dir, ".otto", "workflow", "manifest.json"), "utf-8"));
    assert.equal(manifest.version, 1);
    assert.ok(manifest.createdAt);
    assert.ok(manifest.otto);
    assert.equal(typeof readFileSync(join(dir, ".otto", "workflow", "STATE.md"), "utf-8"), "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
