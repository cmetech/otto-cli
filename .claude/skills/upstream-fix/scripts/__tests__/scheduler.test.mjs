import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, setLaneStatus } from "../ledger.mjs";
import { nextLanes } from "../scheduler.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-sched-")); }

function seed(path) {
  initLedger(path, {
    date: "d", filter: "x", integrationBranch: "b",
    lanes: [
      { id: 1, issues: ["63"], files: ["a.ts"] },
      { id: 2, issues: ["7"], files: ["b.ts"] },
      { id: 3, issues: ["8"], files: ["c.ts"] },
      { id: 4, issues: ["9"], files: ["d.ts"] },
    ],
    issues: [
      { number: "63", sha: "ce0e801", guidancePath: "g1", targetFiles: ["a.ts"] },
      { number: "7", sha: "abc1234", guidancePath: "g2", targetFiles: ["b.ts"] },
      { number: "8", sha: "bbb2222", guidancePath: "g3", targetFiles: ["c.ts"] },
      { number: "9", sha: "ccc3333", guidancePath: "g4", targetFiles: ["d.ts"] },
    ],
  });
}

test("returns at most cap=3 pending lanes when none in flight", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    const lanes = nextLanes(path, { cap: 3 });
    assert.equal(lanes.length, 3);
    assert.deepEqual(lanes.map((l) => l.id), [1, 2, 3]);
    assert.equal(lanes[0].branch, "fix/upstream-lane-1");
    assert.equal(lanes[0].issues[0].sha, "ce0e801");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("subtracts in-flight lanes from the cap", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    setLaneStatus(path, 1, "in-progress");
    setLaneStatus(path, 2, "in-progress");
    const lanes = nextLanes(path, { cap: 3 });
    assert.equal(lanes.length, 1); // 3 - 2 in flight
    assert.equal(lanes[0].id, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("returns [] when cap is saturated", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    setLaneStatus(path, 1, "in-progress");
    setLaneStatus(path, 2, "in-progress");
    setLaneStatus(path, 3, "in-progress");
    assert.deepEqual(nextLanes(path, { cap: 3 }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("skips done/merged/failed lanes", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    setLaneStatus(path, 1, "merged");
    setLaneStatus(path, 2, "failed");
    const lanes = nextLanes(path, { cap: 3 });
    assert.deepEqual(lanes.map((l) => l.id), [3, 4]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
