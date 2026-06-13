import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, INFRA_PATTERNS } from "../transient-classifier.mjs";

test("CI flake (red on first run, green on rerun) → transient", () => {
  const r = classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: true });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /ci-flake/);
});

test("CI persistent red across reruns → real", () => {
  const r = classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: false });
  assert.equal(r.category, "real");
});

test("baseline-rot signature (same failure on origin/main) → transient", () => {
  const r = classifyFailure({
    stage: "local-gate",
    failTail: "Error: missing dist-test/vendor/xlsx-0.20.3.tgz",
    baselineFailTail: "Error: missing dist-test/vendor/xlsx-0.20.3.tgz",
  });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /baseline-rot/);
});

test("local-gate failure not present on baseline → real", () => {
  const r = classifyFailure({
    stage: "local-gate",
    failTail: "AssertionError: expected 1 got 2",
    baselineFailTail: "",
  });
  assert.equal(r.category, "real");
});

test("infra signatures (EACCES, ENOSPC, OOM, network) → transient", () => {
  for (const pat of INFRA_PATTERNS) {
    const r = classifyFailure({ stage: "fix", failTail: `something\n${pat} happened\nmore` });
    assert.equal(r.category, "transient", `expected transient for pattern ${pat}`);
    assert.match(r.reason, /infra/);
  }
});

test("fix-stage reviewer rejection → real", () => {
  const r = classifyFailure({ stage: "fix-reviewer", reviewerVerdict: "reject", reviewerReason: "regression test does not pin the bug" });
  assert.equal(r.category, "real");
});

test("regression test won't reproduce → real", () => {
  const r = classifyFailure({ stage: "regression-gate", regressionPassesOnMain: true });
  assert.equal(r.category, "real");
});

test("skill-level uncaught exception → abort", () => {
  const r = classifyFailure({ stage: "swarm", thrown: new Error("undefined is not a function") });
  assert.equal(r.category, "abort");
});

test("rebase conflict, main moved, touched files DISJOINT from new commits → transient", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: true, conflictMarkers: true, touchedFilesDisjoint: true });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /rebase/);
});

test("rebase conflict where our touched files OVERLAP the new commits → real (no blind retry)", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: true, conflictMarkers: true, touchedFilesDisjoint: false });
  assert.equal(r.category, "real");
  assert.match(r.reason, /touched files|manual/i);
});

test("rebase failure without main moving → real", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: false, conflictMarkers: true, touchedFilesDisjoint: true });
  assert.equal(r.category, "real");
});
