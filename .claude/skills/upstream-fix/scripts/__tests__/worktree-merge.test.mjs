import { test } from "node:test";
import assert from "node:assert/strict";
import { detectOverlap, mergeLane } from "../worktree-merge.mjs";

test("detectOverlap finds files touched outside declared set", () => {
  const stray = detectOverlap(["a.ts", "b.ts"], ["a.ts", "c.ts"]);
  assert.deepEqual(stray, ["c.ts"]);
});

test("detectOverlap allows a new co-located test file next to a declared source file", () => {
  const stray = detectOverlap(["packages/pi-ai/src/x.ts"], ["packages/pi-ai/src/x.ts", "packages/pi-ai/src/x.test.ts"]);
  assert.deepEqual(stray, []);
});

test("detectOverlap returns [] when actual ⊆ declared", () => {
  assert.deepEqual(detectOverlap(["a.ts", "b.ts"], ["a.ts"]), []);
});

test("mergeLane returns merged:true on clean merge", () => {
  const calls = [];
  const gitRunner = (args) => { calls.push(args); return ""; };
  const r = mergeLane({ laneBranch: "fix/upstream-lane-1", integrationBranch: "integration/upstream-fix-x", gitRunner });
  assert.equal(r.merged, true);
  assert.equal(r.conflict, false);
  assert.ok(calls.some((c) => c[0] === "merge" && c.includes("--no-ff") && c.includes("fix/upstream-lane-1")));
});

test("mergeLane aborts and reports conflict on merge failure", () => {
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "merge") { const e = new Error("CONFLICT"); e.status = 1; throw e; }
    return "";
  };
  const r = mergeLane({ laneBranch: "fix/upstream-lane-2", integrationBranch: "integration/upstream-fix-x", gitRunner });
  assert.equal(r.merged, false);
  assert.equal(r.conflict, true);
  assert.ok(calls.some((c) => c[0] === "merge" && c[1] === "--abort"));
});

test("mergeLane rejects unsafe branch names", () => {
  assert.throws(() => mergeLane({ laneBranch: "x; rm -rf /", integrationBranch: "y", gitRunner: () => "" }), /unsafe/i);
});
