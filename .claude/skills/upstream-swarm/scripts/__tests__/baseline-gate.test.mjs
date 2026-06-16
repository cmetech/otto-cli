import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBaselineGate } from "../baseline-gate.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "baseline-gate-")); }

// All gate calls register to a throwaway registry by default, so this unit
// suite never pollutes the real .worktree-registry.json when it runs inside
// the swarm's own baseline gate (a per-call registryPath still wins).
const REG = join(mkdtempSync(join(tmpdir(), "bg-reg-")), "registry.json");
const rbg = (opts) => runBaselineGate(Object.assign({ registryPath: REG }, opts));

test("returns pass when run-gates returns pass", async () => {
  const dir = tmp();
  try {
    const r = rbg({
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
    const r = rbg({
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
  rbg({
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
  rbg({
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

test("isolates concurrent gates: distinct uniqueSuffix → distinct worktree paths (no clobber)", () => {
  const adds = [];
  const run = (suffix) => rbg({
    workdir: ".worktrees/base", logPath: "/tmp/b.log", uniqueSuffix: suffix,
    worktreeRunner: (args) => { if (args[1] === "add") adds.push(args[3]); return { status: 0 }; },
    provisionDeps: () => {}, gateRunner: () => ({ pass: true, failTail: "" }),
  });
  run("100"); run("200");
  assert.equal(adds.length, 2);
  assert.notEqual(adds[0], adds[1], "a retried gate (different process) must not share the first's worktree");
  assert.match(adds[0], /-100$/);
  assert.match(adds[1], /-200$/);
});

test("runs the gate (and remove/provision) in the per-process worktree", () => {
  let gateCwd = null, removed = null, provisioned = null;
  rbg({
    workdir: ".worktrees/base", logPath: "/tmp/b.log", uniqueSuffix: "77",
    worktreeRunner: (args) => { if (args[1] === "remove") removed = args[3]; return { status: 0 }; },
    provisionDeps: ({ workdir }) => { provisioned = workdir; },
    gateRunner: ({ workdir }) => { gateCwd = workdir; return { pass: true, failTail: "" }; },
  });
  assert.match(gateCwd, /-77$/);
  assert.match(removed, /-77$/);
  assert.match(provisioned, /-77$/);
});

test("registers to the injected registryPath (so tests/suites don't pollute the real registry)", () => {
  const dir = tmp();
  try {
    const reg = join(dir, "registry.json");
    rbg({
      workdir: join(dir, "wt"), logPath: join(dir, "b.log"), registryPath: reg, uniqueSuffix: "1",
      worktreeRunner: () => ({ status: 0 }), provisionDeps: () => {}, gateRunner: () => ({ pass: true, failTail: "" }),
    });
    assert.ok(existsSync(reg), "the injected registry receives the entry");
    const entries = JSON.parse(readFileSync(reg, "utf-8"));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].owner, "swarm-baseline");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runBaselineGate force-removes a leaked worktree before re-adding", async () => {
  const calls = [];
  const worktreeRunner = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "remove") throw new Error("fatal: ... is not a working tree"); // clean run: nothing to remove
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = await rbg({
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
