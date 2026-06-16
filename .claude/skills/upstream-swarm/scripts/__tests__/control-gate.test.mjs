import { test } from "node:test";
import assert from "node:assert/strict";
import { gateForPr } from "../control-gate.mjs";

const baseArgs = { pr: 400, headRef: "fix/x", targets: ["repo-registry.ts"], logDir: "/tmp/gatelogs" };

test("conflict on trial-merge short-circuits with verdict=conflict", () => {
  const r = gateForPr({ ...baseArgs, trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: false, conflict: true }), runGateFn: () => { throw new Error("should not run gate on conflict"); } });
  assert.equal(r.verdict, "conflict");
  assert.equal(r.pass, false);
});

test("clean pass returns verdict=pass without re-run", () => {
  let runs = 0;
  const r = gateForPr({ ...baseArgs, trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }), runGateFn: () => { runs++; return { pass: true, failTail: "" }; } });
  assert.equal(r.verdict, "pass");
  assert.equal(r.pass, true);
  assert.equal(runs, 1);
});

test("fail then clean re-run = flake", () => {
  let runs = 0;
  const r = gateForPr({ ...baseArgs, trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }), runGateFn: () => { runs++; return runs === 1 ? { pass: false, failTail: "not ok 214 - headless --output-format stream-json" } : { pass: true, failTail: "" }; } });
  assert.equal(r.verdict, "flake");
  assert.equal(r.pass, true);
  assert.equal(r.reran, true);
  assert.equal(runs, 2);
});

test("fail twice = real", () => {
  const r = gateForPr({ ...baseArgs, trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }), runGateFn: () => ({ pass: false, failTail: "not ok 9 - some unrelated test" }) });
  assert.equal(r.verdict, "real");
  assert.equal(r.pass, false);
  assert.equal(r.reran, true);
});

test("failTail naming a changed target file is real without re-run (suspicious overlap)", () => {
  let runs = 0;
  const r = gateForPr({ ...baseArgs, trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }), runGateFn: () => { runs++; return { pass: false, failTail: "FAIL repo-registry.ts > resolves root" }; } });
  assert.equal(r.verdict, "real");
  assert.equal(r.pass, false);
  assert.equal(r.suspiciousOverlap, true);
  assert.equal(runs, 1);
});
