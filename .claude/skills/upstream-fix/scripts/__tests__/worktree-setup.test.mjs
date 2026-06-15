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
  const r = setupWorktree({ laneId: 1, base: "main", gitRunner: runner, fetch: false });
  assert.equal(r.worktree, ".worktrees/upstream-fix-lane-1");
  assert.equal(r.branch, "fix/upstream-lane-1");
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-1", "-b", "fix/upstream-lane-1", "main"]);
});

test("reuses an existing branch on resume (no -b)", () => {
  const runner = recordingRunner(true);
  setupWorktree({ laneId: 2, base: "main", gitRunner: runner, fetch: false });
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-2", "fix/upstream-lane-2"]);
});

test("rejects unsafe base names", () => {
  const runner = recordingRunner(false);
  assert.throws(() => setupWorktree({ laneId: 1, base: "main; rm -rf /", gitRunner: runner, fetch: false }), /unsafe/i);
});

test("defaults base to origin/main (prevents local-main contamination)", () => {
  const runner = recordingRunner(false);
  setupWorktree({ laneId: 7, gitRunner: runner, fetch: false });
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-7", "-b", "fix/upstream-lane-7", "origin/main"]);
});

test("fetches origin first when base starts with origin/ (default fetch:true)", () => {
  const runner = recordingRunner(false);
  setupWorktree({ laneId: 8, gitRunner: runner });
  assert.deepEqual(runner.calls[0], ["fetch", "origin", "--prune"]);
});

test("does NOT fetch when base is a local ref (no `origin/` prefix)", () => {
  const runner = recordingRunner(false);
  setupWorktree({ laneId: 9, base: "main", gitRunner: runner });
  assert.ok(!runner.calls.some((c) => c[0] === "fetch"), "fetch must not be called for local-ref bases");
});

// --- single-issue mode (per-issue unique names; collision-safe across parallel lanes) ---

test("single-issue mode names worktree+branch by issue number and sha", () => {
  const runner = recordingRunner(false);
  const r = setupWorktree({ issueNumber: 344, sha: "066cee9", base: "main", gitRunner: runner, fetch: false });
  assert.equal(r.worktree, ".worktrees/upstream-fix-issue-344");
  assert.equal(r.branch, "fix/upstream-issue-344-066cee9");
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-issue-344", "-b", "fix/upstream-issue-344-066cee9", "main"]);
});

test("single-issue mode: two different issues never collide on worktree/branch", () => {
  const a = setupWorktree({ issueNumber: 237, sha: "97c2043", base: "main", gitRunner: recordingRunner(false), fetch: false });
  const b = setupWorktree({ issueNumber: 344, sha: "066cee9", base: "main", gitRunner: recordingRunner(false), fetch: false });
  assert.notEqual(a.worktree, b.worktree);
  assert.notEqual(a.branch, b.branch);
});

test("single-issue mode reuses an existing branch on resume (no -b)", () => {
  const runner = recordingRunner(true);
  setupWorktree({ issueNumber: 175, sha: "4954d5c", base: "main", gitRunner: runner, fetch: false });
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-issue-175", "fix/upstream-issue-175-4954d5c"]);
});

test("single-issue mode requires a sha", () => {
  const runner = recordingRunner(false);
  assert.throws(() => setupWorktree({ issueNumber: 344, base: "main", gitRunner: runner, fetch: false }), /sha/i);
});

test("single-issue mode still rejects unsafe base names", () => {
  const runner = recordingRunner(false);
  assert.throws(() => setupWorktree({ issueNumber: 344, sha: "066cee9", base: "main; rm -rf /", gitRunner: runner, fetch: false }), /unsafe/i);
});
