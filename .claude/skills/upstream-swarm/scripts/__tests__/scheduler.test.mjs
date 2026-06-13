import { test } from "node:test";
import assert from "node:assert/strict";
import { nextActions } from "../scheduler.mjs";

const CAPS = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };

function led(states) {
  const issues = {};
  for (const [number, state] of Object.entries(states)) {
    issues[number] = { state, prNumber: state === "awaiting-ci" || state === "ci-green" ? Number(number) + 100 : null };
  }
  return { issues };
}

test("starts up to fixConcurrency lanes when fix-able issues exist", () => {
  const ledger = led({ 1: "selected", 2: "selected", 3: "selected", 4: "selected" });
  const actions = nextActions(ledger, CAPS);
  const fixes = actions.filter((a) => a.kind === "start-fix");
  assert.equal(fixes.length, 3);
  assert.deepEqual(fixes.map((a) => a.issueNumber).sort(), [1, 2, 3]);
});

test("backpressure: no new fixes when prWindow is full", () => {
  const ledger = led(Object.fromEntries(Array.from({length: 10}, (_, i) => [i + 1, "awaiting-ci"]).concat([[100, "selected"]])));
  const actions = nextActions(ledger, { ...CAPS, prWindow: 10 });
  assert.equal(actions.filter((a) => a.kind === "start-fix").length, 0);
});

test("polls CI for awaiting-ci issues (one poll-ci action each)", () => {
  const ledger = led({ 1: "awaiting-ci", 2: "awaiting-ci" });
  const actions = nextActions(ledger, CAPS);
  const polls = actions.filter((a) => a.kind === "poll-ci");
  assert.equal(polls.length, 2);
});

test("kicks local-gate on ci-green issues", () => {
  const ledger = led({ 1: "ci-green", 2: "ci-green" });
  const actions = nextActions(ledger, CAPS);
  const gates = actions.filter((a) => a.kind === "run-local-gate");
  assert.equal(gates.length, 2);
});

test("kicks refute panel on local-gate-pending issues up to refuteConcurrency", () => {
  const ledger = led({ 1: "local-gate-pending", 2: "local-gate-pending", 3: "local-gate-pending", 4: "local-gate-pending", 5: "local-gate-pending", 6: "local-gate-pending" });
  const actions = nextActions(ledger, { ...CAPS, refuteConcurrency: 5 });
  assert.equal(actions.filter((a) => a.kind === "run-refute").length, 5);
});

test("merges approved issues", () => {
  const ledger = led({ 1: "approved", 2: "approved" });
  const actions = nextActions(ledger, CAPS);
  const merges = actions.filter((a) => a.kind === "merge-pr");
  assert.equal(merges.length, 2);
});

test("returns empty array when there is no work", () => {
  const ledger = led({ 1: "merged", 2: "quarantined" });
  assert.deepEqual(nextActions(ledger, CAPS), []);
});

test("counts in-flight fixes correctly: fixing / retrying counts toward fixConcurrency cap", () => {
  const ledger = led({ 1: "fixing", 2: "retrying", 3: "selected", 4: "selected" });
  const actions = nextActions(ledger, { ...CAPS, fixConcurrency: 3 });
  // 2 already in-flight (fixing + retrying), cap is 3 → only 1 more start-fix.
  assert.equal(actions.filter((a) => a.kind === "start-fix").length, 1);
});

test("start-fix is ordered by severity tier, then number within a tier", () => {
  const ledger = { issues: {
    10: { state: "selected", severity: "nice-to-have-fix" },
    11: { state: "selected", severity: "critical-stability" },
    12: { state: "selected", severity: "feature" },
    13: { state: "selected", severity: "critical-security" },
    14: { state: "selected", severity: "critical-stability" },
  } };
  const actions = nextActions(ledger, { fixConcurrency: 5, prWindow: 10, refuteConcurrency: 5 });
  const order = actions.filter((a) => a.kind === "start-fix").map((a) => a.issueNumber);
  assert.deepEqual(order, [13, 11, 14, 12, 10]);
});

test("refute selection is also severity-ordered", () => {
  const ledger = { issues: {
    20: { state: "local-gate-pending", severity: "nice-to-have-fix" },
    21: { state: "local-gate-pending", severity: "critical-stability" },
  } };
  const actions = nextActions(ledger, { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 1 });
  const refutes = actions.filter((a) => a.kind === "run-refute").map((a) => a.issueNumber);
  assert.deepEqual(refutes, [21]);
});

test("emits quarantine-timeout for an active-fix issue over the wall-clock budget", () => {
  const now = 1_000_000;
  const ledger = { issues: {
    1: { state: "fixing", fixStartedAt: now - 50_000 },
    2: { state: "planning", fixStartedAt: now - 5_000 },
  } };
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, issueTimeoutMs: 30_000 };
  const actions = nextActions(ledger, caps, now);
  const timeouts = actions.filter((a) => a.kind === "quarantine-timeout").map((a) => a.issueNumber);
  assert.deepEqual(timeouts, [1]);
});

test("no timeout when caps.issueTimeoutMs is unset or now is null", () => {
  const ledger = { issues: { 1: { state: "fixing", fixStartedAt: 1 } } };
  assert.equal(nextActions(ledger, { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 }, 9_999_999).filter((a) => a.kind === "quarantine-timeout").length, 0);
  assert.equal(nextActions(ledger, { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, issueTimeoutMs: 1 }, null).filter((a) => a.kind === "quarantine-timeout").length, 0);
});

test("awaiting-ci is NOT subject to the fix timeout", () => {
  const now = 1_000_000;
  const ledger = { issues: { 1: { state: "awaiting-ci", fixStartedAt: now - 10_000_000, prNumber: 101 } } };
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, issueTimeoutMs: 30_000 };
  assert.equal(nextActions(ledger, caps, now).filter((a) => a.kind === "quarantine-timeout").length, 0);
});
