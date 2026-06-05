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
