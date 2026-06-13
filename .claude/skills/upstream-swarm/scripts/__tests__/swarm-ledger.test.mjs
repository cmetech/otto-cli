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

test("VALID_TRANSITIONS allows fix-ok → pending-human-review (severity routing path)", () => {
  const allowed = VALID_TRANSITIONS["fix-ok"];
  assert.ok(allowed.includes("awaiting-ci"), "auto-tier path must remain");
  assert.ok(allowed.includes("pending-human-review"), "human-tier path must be allowed");
});

test("VALID_TRANSITIONS includes the skip→selected re-entry edge", () => {
  assert.ok((VALID_TRANSITIONS["skipped"] ?? []).includes("selected"));
});

// -----------------------------------------------------------------------
// Recovery edges: quarantined / pending-human-review → selected
// Autonomous swarm runs need a documented re-attempt path. Both states
// were terminal in v1, which forced hand-edits to recover. Re-entry to
// `selected` puts the issue back at the queue head while preserving
// retryCount / refute / reason audit fields on the issue record.
// -----------------------------------------------------------------------

test("VALID_TRANSITIONS allows quarantined → selected (operator re-attempt)", () => {
  assert.ok((VALID_TRANSITIONS["quarantined"] ?? []).includes("selected"));
});

test("VALID_TRANSITIONS allows pending-human-review → selected (after human resolves blocker)", () => {
  assert.ok((VALID_TRANSITIONS["pending-human-review"] ?? []).includes("selected"));
});

test("recordTransition: quarantined → selected preserves retryCount and refute audit fields", () => {
  const dir = tmp();
  const path = join(dir, "state.json");
  initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: [{ number: 42, severity: "nice-to-have-fix", sha: "abc" }] });
  // Walk through retry + quarantine, then re-attempt.
  recordTransition(path, 42, "planning");
  recordTransition(path, 42, "fixing");
  recordTransition(path, 42, "fix-failed");
  recordRetry(path, 42, "transient CI flake");
  recordTransition(path, 42, "fixing");
  recordTransition(path, 42, "fix-failed");
  recordTransition(path, 42, "quarantined", { reason: "retry cap hit" });
  // Operator's recovery action:
  recordTransition(path, 42, "selected", { reason: "human resolved upstream flake" });
  const issue = readLedger(path).issues["42"];
  assert.equal(issue.state, "selected");
  assert.equal(issue.retryCount, 1, "retryCount must persist across re-attempt");
  assert.equal(issue.retryReason, "transient CI flake", "retryReason must persist for audit");
  assert.equal(issue.reason, "human resolved upstream flake");
});

test("recordTransition: pending-human-review → selected (severity:feature re-tier example)", () => {
  const dir = tmp();
  const path = join(dir, "state.json");
  initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: [{ number: 99, severity: "feature", sha: "def" }] });
  recordTransition(path, 99, "planning");
  recordTransition(path, 99, "fixing");
  recordTransition(path, 99, "fix-ok", { prNumber: 200 });
  recordTransition(path, 99, "pending-human-review");
  recordTransition(path, 99, "selected", { reason: "re-classified to nice-to-have-fix" });
  const issue = readLedger(path).issues["99"];
  assert.equal(issue.state, "selected");
  assert.equal(issue.prNumber, 200, "prNumber audit must persist");
});

test("merged stays a true dead-end (no recovery edge)", () => {
  assert.deepEqual(VALID_TRANSITIONS["merged"], [], "merged must remain terminal");
});

test("VALID_TRANSITIONS allows active fix states to be quarantined on timeout", () => {
  assert.ok((VALID_TRANSITIONS["fixing"] ?? []).includes("quarantined"));
  assert.ok((VALID_TRANSITIONS["planning"] ?? []).includes("quarantined"));
  assert.ok((VALID_TRANSITIONS["retrying"] ?? []).includes("quarantined"));
});

test("initSwarmLedger seeds fixStartedAt = null on each issue", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "swl-"));
  try {
    const path = join(dir, "led.json");
    const led = initSwarmLedger(path, { date: "2026-06-13", filter: {}, issues: [{ number: 5 }] });
    assert.equal(led.issues["5"].fixStartedAt, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("initSwarmLedger seeds polling backoff fields", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "swl-"));
  try {
    const path = join(dir, "led.json");
    const led = initSwarmLedger(path, { date: "d", filter: {}, issues: [{ number: 5 }] });
    assert.equal(led.issues["5"].lastPolledAt, null);
    assert.equal(led.issues["5"].pollNoChangeCount, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("initSwarmLedger seeds an empty abortStreak", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "swl-"));
  try {
    const path = join(dir, "led.json");
    const led = initSwarmLedger(path, { date: "d", filter: {}, issues: [] });
    assert.deepEqual(led.abortStreak, { signature: null, count: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
