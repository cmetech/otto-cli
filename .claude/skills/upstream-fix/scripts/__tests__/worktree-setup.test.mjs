import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWorktree } from "../worktree-setup.mjs";

function recordingRunner(branchExists = false) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      if (!branchExists) { const e = new Error("unknown rev"); e.status = 128; throw e; }
      return "abc1234\n";
    }
    return "";
  };
  runner.calls = calls;
  return runner;
}

test("creates a new branch worktree off main when branch absent", () => {
  const runner = recordingRunner(false);
  const r = setupWorktree({ laneId: 1, base: "main", gitRunner: runner });
  assert.equal(r.worktree, ".worktrees/upstream-fix-lane-1");
  assert.equal(r.branch, "fix/upstream-lane-1");
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-1", "-b", "fix/upstream-lane-1", "main"]);
});

test("reuses an existing branch on resume (no -b)", () => {
  const runner = recordingRunner(true);
  setupWorktree({ laneId: 2, base: "main", gitRunner: runner });
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-2", "fix/upstream-lane-2"]);
});

test("rejects unsafe base names", () => {
  const runner = recordingRunner(false);
  assert.throws(() => setupWorktree({ laneId: 1, base: "main; rm -rf /", gitRunner: runner }), /unsafe/i);
});
