import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initSwarmLedger,
  readLedger,
  recordTransition,
  recordRetry,
  VALID_TRANSITIONS,
} from "../swarm-ledger.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "us-ledger-")); }

const ISSUES = [
  { number: 53, severity: "nice-to-have-fix", conflictRisk: "none", sha: "baf4028", targetFiles: ["a.ts"] },
  { number: 67, severity: "feature",          conflictRisk: "none", sha: "deadbee", targetFiles: ["b.ts"] },
];

test("initSwarmLedger seeds one selected record per issue", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    const led = initSwarmLedger(path, { date: "2026-06-05", filter: "status:triaged", issues: ISSUES });
    assert.equal(led.version, 1);
    assert.equal(led.date, "2026-06-05");
    assert.equal(led.issues["53"].state, "selected");
    assert.equal(led.issues["53"].retryCount, 0);
    assert.equal(led.issues["67"].severity, "feature");
    assert.deepEqual(led.issues["53"].targetFiles, ["a.ts"]);
    assert.deepEqual(readLedger(path).issues["53"].targetFiles, ["a.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordTransition applies valid transitions and persists payload", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    recordTransition(path, 53, "planning", { wave: 1 });
    recordTransition(path, 53, "fixing");
    recordTransition(path, 53, "fix-ok", { prNumber: 74 });
    const led = readLedger(path);
    assert.equal(led.issues["53"].state, "fix-ok");
    assert.equal(led.issues["53"].wave, 1);
    assert.equal(led.issues["53"].prNumber, 74);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordTransition rejects an invalid transition", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    assert.throws(
      () => recordTransition(path, 53, "merged"),
      /invalid transition: selected → merged/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordTransition throws on unknown issue", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    assert.throws(() => recordTransition(path, 999, "planning"), /unknown issue/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordRetry increments counter and stores reason", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    recordTransition(path, 53, "planning");
    recordTransition(path, 53, "fixing");
    recordTransition(path, 53, "fix-failed", { reason: "test won't reproduce" });
    recordRetry(path, 53, "ci-flake");
    const led = readLedger(path);
    assert.equal(led.issues["53"].state, "retrying");
    assert.equal(led.issues["53"].retryCount, 1);
    assert.equal(led.issues["53"].retryReason, "ci-flake");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordRetry refuses to retry past the hard cap of 1", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    recordTransition(path, 53, "planning");
    recordTransition(path, 53, "fixing");
    recordTransition(path, 53, "fix-failed");
    recordRetry(path, 53, "infra");
    assert.throws(() => recordRetry(path, 53, "infra"), /retry cap exceeded/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("VALID_TRANSITIONS includes the skip→selected re-entry edge", () => {
  assert.ok((VALID_TRANSITIONS["skipped"] ?? []).includes("selected"));
});
