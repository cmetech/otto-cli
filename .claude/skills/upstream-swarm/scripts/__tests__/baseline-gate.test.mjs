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
      provisionDeps: () => {},
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
      provisionDeps: () => {},
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
    provisionDeps: () => {},
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.ok(observed.includes("origin/main"), "worktree should be created at origin/main");
});

test("provisions deps after worktree creation, before running the gate", () => {
  const order = [];
  runBaselineGate({
    workdir: "/tmp/x",
    logPath: "/tmp/x/baseline.log",
    worktreeRunner: (args) => {
      // Both the force-remove and the add are "worktree" ops; track both so
      // the ordering assertion remains meaningful.
      order.push("worktree:" + args[1]);
      return { status: 0 };
    },
    provisionDeps: () => { order.push("provision"); },
    gateRunner: () => { order.push("gate"); return { pass: true, failTail: "" }; },
  });
  // remove precedes add, add precedes provision, provision precedes gate.
  assert.ok(order[0] === "worktree:remove", "force-remove must come first");
  assert.ok(order[1] === "worktree:add",    "add must come second");
  assert.equal(order[2], "provision");
  assert.equal(order[3], "gate");
});

test("runBaselineGate force-removes a leaked worktree before re-adding", async () => {
  const calls = [];
  const worktreeRunner = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "remove") throw new Error("fatal: ... is not a working tree"); // clean run: nothing to remove
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = await runBaselineGate({
    workdir: ".worktrees/upstream-swarm-baseline",
    logPath: "/tmp/x.log",
    worktreeRunner,
    provisionDeps: () => {},
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.equal(r.pass, true);
  const removeIdx = calls.findIndex((c) => c.startsWith("worktree remove"));
  const addIdx = calls.findIndex((c) => c.startsWith("worktree add"));
  assert.ok(removeIdx >= 0, "must attempt a remove");
  assert.ok(removeIdx < addIdx, "remove must precede add");
  assert.ok(calls[removeIdx].includes("--force"), "remove must be --force");
});
