import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { _clearWorkflowRootCache } from "../../paths.ts";
import { runInit } from "./init.ts";

function makeCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
    },
  };
}

test("creates .otto/workflow/ in a fresh dir", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-fresh-"));
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(existsSync(join(dir, ".otto", "workflow")), ".otto/workflow/ must exist");
    assert.equal(existsSync(join(dir, ".otto/workflow")), false, ".otto/workflow/ must not be created");
    assert.ok(existsSync(join(dir, ".otto", "workflow", "manifest.json")), "manifest.json must exist");
    assert.ok(existsSync(join(dir, ".otto", "workflow", "STATE.md")), "STATE.md must exist");
    const manifest = JSON.parse(readFileSync(join(dir, ".otto", "workflow", "manifest.json"), "utf-8"));
    assert.equal(typeof manifest.version, "number");
    assert.equal(typeof manifest.createdAt, "string");
    assert.equal(typeof manifest.otto, "string");
    assert.ok(ctx.notifications.some(n => /initialized at/i.test(n.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores stale .otto/workflow/ and initializes .otto/workflow/", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-existing-"));
  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(existsSync(join(dir, ".otto", "workflow", "manifest.json")));
    assert.ok(ctx.notifications.some(n => /initialized at/i.test(n.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses when .otto/workflow/ already exists", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-otto-existing-"));
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(ctx.notifications.some(n => /already initialized/i.test(n.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses when cwd === $HOME", async () => {
  _clearWorkflowRootCache();
  const manifestPath = join(homedir(), ".otto", "workflow", "manifest.json");
  const existedBefore = existsSync(manifestPath);
  const ctx = makeCtx();
  await runInit(ctx as any, homedir());
  assert.equal(
    existsSync(manifestPath),
    existedBefore,
    "must not create ~/.otto/workflow/manifest.json",
  );
  assert.ok(ctx.notifications.some(n => /refus|already|home/i.test(n.message)));
});
