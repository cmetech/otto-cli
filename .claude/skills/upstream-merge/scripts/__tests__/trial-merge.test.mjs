import { test } from "node:test";
import assert from "node:assert/strict";
import { trialMerge } from "../trial-merge.mjs";

function recorder(opts = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args.join(" "));
    if (opts.failOn && args.join(" ").includes(opts.failOn)) throw new Error("merge conflict");
    return "";
  };
  return { runner, calls };
}

function noopProvisionDeps() { /* no-op for unit tests */ }

test("clean merge fetches, adds detached worktree at base, merges PR head", () => {
  const { runner, calls } = recorder();
  const r = trialMerge({ prNumber: 64, headRef: "integration/upstream-fix-2026-05-30", gitRunner: runner, provisionDeps: noopProvisionDeps });
  assert.equal(r.conflict, false);
  assert.equal(r.merged, true);
  assert.equal(r.worktree, ".worktrees/upstream-merge-pr-64");
  assert.ok(calls.some((c) => c.startsWith("fetch origin")));
  assert.ok(calls.some((c) => c.includes("worktree add --detach .worktrees/upstream-merge-pr-64 origin/main")));
  assert.ok(calls.some((c) => c.includes("merge --no-ff --no-edit origin/integration/upstream-fix-2026-05-30")));
});

test("idempotent: force-removes a stale worktree before add (so retries don't hit 'already exists')", () => {
  const { runner, calls } = recorder();
  trialMerge({ prNumber: 403, headRef: "fix/upstream-issue-61-088987b", gitRunner: runner, provisionDeps: noopProvisionDeps });
  const removeIdx = calls.findIndex((c) => c.includes("worktree remove --force .worktrees/upstream-merge-pr-403"));
  const addIdx = calls.findIndex((c) => c.includes("worktree add --detach .worktrees/upstream-merge-pr-403"));
  assert.ok(removeIdx >= 0, "force-remove is attempted");
  assert.ok(removeIdx < addIdx, "remove happens before add");
});

test("a throwing worktree-remove (nothing to remove) is swallowed, add still proceeds", () => {
  const { runner, calls } = recorder({ failOn: "worktree remove" });
  const r = trialMerge({ prNumber: 403, headRef: "fix/x", gitRunner: runner, provisionDeps: noopProvisionDeps });
  assert.equal(r.conflict, false);
  assert.ok(calls.some((c) => c.includes("worktree add --detach")), "add still runs after a failed remove");
});

test("conflict aborts the merge and reports conflict:true", () => {
  const { runner, calls } = recorder({ failOn: "merge --no-ff" });
  const r = trialMerge({ prNumber: 64, headRef: "integration/upstream-fix-2026-05-30", gitRunner: runner, provisionDeps: noopProvisionDeps });
  assert.equal(r.merged, false);
  assert.equal(r.conflict, true);
  assert.ok(calls.some((c) => c.includes("merge --abort")));
});

test("rejects unsafe ref names", () => {
  const { runner } = recorder();
  assert.throws(
    () => trialMerge({ prNumber: 64, headRef: "evil; rm -rf /", gitRunner: runner, provisionDeps: noopProvisionDeps }),
    /unsafe/,
  );
});

test("provisions node_modules after worktree add, before merge", () => {
  const { runner, calls } = recorder();
  const provisionCalls = [];
  const provisionDeps = ({ workdir }) => {
    provisionCalls.push({ workdir, snapshotAtCall: [...calls] });
  };
  trialMerge({ prNumber: 99, headRef: "fix/upstream-issue-99-2c830cd", gitRunner: runner, provisionDeps });
  assert.equal(provisionCalls.length, 1, "provisionDeps called exactly once");
  assert.equal(provisionCalls[0].workdir, ".worktrees/upstream-merge-pr-99");
  // provisionDeps must run AFTER the worktree exists but BEFORE the merge,
  // so the merge itself can resolve any node tooling it needs.
  const snapshot = provisionCalls[0].snapshotAtCall;
  assert.ok(snapshot.some((c) => c.includes("worktree add --detach")), "worktree was added before provision");
  assert.ok(!snapshot.some((c) => c.includes("merge --no-ff")), "merge had not yet happened when provision was called");
});

test("respects provisionDeps:false (opt-out for callers that npm ci themselves)", () => {
  const { runner } = recorder();
  let called = false;
  // Passing the literal `false` should skip provisioning entirely.
  trialMerge({ prNumber: 100, headRef: "fix/x", gitRunner: runner, provisionDeps: false });
  assert.equal(called, false, "no provisionDeps invocation");
});
