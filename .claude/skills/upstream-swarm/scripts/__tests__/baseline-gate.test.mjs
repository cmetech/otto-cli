import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBaselineGate } from "../baseline-gate.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "baseline-gate-")); }

test("returns pass when run-gates returns pass", async () => {
  const dir = tmp();
  try {
    const r = runBaselineGate({
      workdir: dir,
      logPath: join(dir, "baseline.log"),
      worktreeRunner: (args) => ({ status: 0, stdout: "worktree created", stderr: "" }),
      gateRunner: () => ({ pass: true, failTail: "" }),
    });
    assert.equal(r.pass, true);
    assert.equal(r.failTail, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("returns pass:false + failTail when run-gates returns fail", () => {
  const dir = tmp();
  try {
    const r = runBaselineGate({
      workdir: dir,
      logPath: join(dir, "baseline.log"),
      worktreeRunner: () => ({ status: 0, stdout: "", stderr: "" }),
      gateRunner: () => ({ pass: false, failTail: "AssertionError: foo\n2 failures" }),
    });
    assert.equal(r.pass, false);
    assert.match(r.failTail, /AssertionError/);
    assert.equal(r.logPath, join(dir, "baseline.log"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("uses a fresh worktree at origin/main by default", () => {
  let observed = null;
  runBaselineGate({
    workdir: "/tmp/x",
    logPath: "/tmp/x/baseline.log",
    base: "origin/main",
    worktreeRunner: (args) => { observed = args; return { status: 0 }; },
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.ok(observed.includes("origin/main"), "worktree should be created at origin/main");
});
