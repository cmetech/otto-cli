import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, readLedger, writeLedger, recordIssueResult, setLaneStatus } from "../ledger.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-ledger-")); }

test("readLedger returns null for missing file", () => {
  const dir = tmp();
  try { assert.equal(readLedger(join(dir, "x.json")), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("initLedger builds lanes+issues maps from inputs and round-trips", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    const lanes = [{ id: 1, issues: ["63"], files: ["a.ts"] }];
    const issues = [{ number: "63", sha: "ce0e801", guidancePath: "g.md", targetFiles: ["a.ts"] }];
    initLedger(path, { date: "2026-05-30", filter: "--issues 63", integrationBranch: "integration/upstream-fix-2026-05-30", lanes, issues });
    const led = readLedger(path);
    assert.equal(led.version, 1);
    assert.equal(led.lanes["1"].status, "pending");
    assert.equal(led.lanes["1"].branch, "fix/upstream-lane-1");
    assert.equal(led.lanes["1"].worktree, ".worktrees/upstream-fix-lane-1");
    assert.equal(led.issues["63"].lane, 1);
    assert.equal(led.issues["63"].status, "pending");
    assert.equal(led.issues["63"].sha, "ce0e801");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordIssueResult sets resolved fields", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    initLedger(path, { date: "2026-05-30", filter: "x", integrationBranch: "b", lanes: [{ id: 1, issues: ["63"], files: ["a.ts"] }], issues: [{ number: "63", sha: "ce0e801", guidancePath: "g.md", targetFiles: ["a.ts"] }] });
    recordIssueResult(path, { number: "63", status: "resolved", commitSha: "deadbee", touchedFiles: ["a.ts"], reason: "ported" });
    const led = readLedger(path);
    assert.equal(led.issues["63"].status, "resolved");
    assert.equal(led.issues["63"].commitSha, "deadbee");
    assert.deepEqual(led.issues["63"].touchedFiles, ["a.ts"]);
    assert.equal(led.issues["63"].reason, "ported");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordIssueResult on unknown issue throws", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    initLedger(path, { date: "d", filter: "x", integrationBranch: "b", lanes: [], issues: [] });
    assert.throws(() => recordIssueResult(path, { number: "999", status: "resolved" }), /unknown issue/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("setLaneStatus updates lane and preserves issues", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    initLedger(path, { date: "d", filter: "x", integrationBranch: "b", lanes: [{ id: 2, issues: ["7"], files: ["b.ts"] }], issues: [{ number: "7", sha: "abc1234", guidancePath: "g", targetFiles: ["b.ts"] }] });
    setLaneStatus(path, 2, "in-progress");
    assert.equal(readLedger(path).lanes["2"].status, "in-progress");
    assert.equal(readLedger(path).issues["7"].status, "pending");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
