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

test("clean merge fetches, adds detached worktree at base, merges PR head", () => {
  const { runner, calls } = recorder();
  const r = trialMerge({ prNumber: 64, headRef: "integration/upstream-fix-2026-05-30", gitRunner: runner });
  assert.equal(r.conflict, false);
  assert.equal(r.merged, true);
  assert.equal(r.worktree, ".worktrees/upstream-merge-pr-64");
  assert.ok(calls.some((c) => c.startsWith("fetch origin")));
  assert.ok(calls.some((c) => c.includes("worktree add --detach .worktrees/upstream-merge-pr-64 origin/main")));
  assert.ok(calls.some((c) => c.includes("merge --no-ff --no-edit origin/integration/upstream-fix-2026-05-30")));
});

test("conflict aborts the merge and reports conflict:true", () => {
  const { runner, calls } = recorder({ failOn: "merge --no-ff" });
  const r = trialMerge({ prNumber: 64, headRef: "integration/upstream-fix-2026-05-30", gitRunner: runner });
  assert.equal(r.merged, false);
  assert.equal(r.conflict, true);
  assert.ok(calls.some((c) => c.includes("merge --abort")));
});

test("rejects unsafe ref names", () => {
  const { runner } = recorder();
  assert.throws(() => trialMerge({ prNumber: 64, headRef: "evil; rm -rf /", gitRunner: runner }), /unsafe/);
});
