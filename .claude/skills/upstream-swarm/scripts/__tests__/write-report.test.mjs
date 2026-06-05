import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../write-report.mjs";

const LEDGER = {
  version: 1,
  date: "2026-06-05",
  filter: "status:triaged",
  startedAt: "2026-06-05T14:00:00Z",
  baselineGate: { pass: true, logPath: "x" },
  waves: [
    { n: 1, issues: [1, 2, 3], startedAt: "..." },
  ],
  issues: {
    "1": { state: "merged", prNumber: 74, prUrl: "https://x/74", mergeSha: "abc123", severity: "nice-to-have-fix", retryCount: 0, refute: { tally: { panelVerdict: "approve", approves: 3, refutes: 0, abstains: 1 } } },
    "2": { state: "pending-human-review", prNumber: 75, prUrl: "https://x/75", mergeSha: null, severity: "feature", retryCount: 0, refute: { tally: { panelVerdict: "approve" } } },
    "3": { state: "quarantined", prNumber: null, severity: "nice-to-have-fix", retryCount: 1, retryReason: "ci-flake", reason: "regression test won't reproduce" },
  },
};

test("renderReport shows the outcome counts", () => {
  const md = renderReport(LEDGER);
  assert.match(md, /Merged.*1/i);
  assert.match(md, /Pending-human-review.*1/i);
  assert.match(md, /Quarantined.*1/i);
});

test("renderReport includes a per-issue table with state, PR URL, mergeSha", () => {
  const md = renderReport(LEDGER);
  assert.match(md, /\| #1 \|/);
  assert.match(md, /merged/);
  assert.match(md, /abc123/);
  assert.match(md, /https:\/\/x\/74/);
});

test("renderReport includes retry log entries for retried issues", () => {
  const md = renderReport(LEDGER);
  assert.match(md, /Retry log/);
  assert.match(md, /#3.*ci-flake/);
});

test("empty ledger renders without throwing and reports zeros", () => {
  const empty = { ...LEDGER, issues: {} };
  const md = renderReport(empty);
  assert.match(md, /Merged.*0/i);
});
