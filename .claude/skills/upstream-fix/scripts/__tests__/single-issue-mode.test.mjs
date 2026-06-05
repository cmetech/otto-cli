import { test } from "node:test";
import assert from "node:assert/strict";
import { singleIssueBranch, singleIssuePrTitle, singleIssueIntegrationBranch } from "../single-issue-mode.mjs";

test("singleIssueBranch derives a stable per-issue branch name", () => {
  assert.equal(singleIssueBranch(53, "baf4028"), "fix/upstream-issue-53-baf4028");
});

test("singleIssuePrTitle includes the upstream-fix prefix and 'closes #N'", () => {
  const t = singleIssuePrTitle({ number: 53, subject: "use the right basedir for patterns" });
  assert.equal(t, "fix(upstream): use the right basedir for patterns (closes #53)");
});

test("singleIssuePrTitle truncates very long subjects to <=72 chars", () => {
  const long = "x".repeat(200);
  const t = singleIssuePrTitle({ number: 1, subject: long });
  // GitHub recommends ≤72 chars total title; we hard-cap.
  assert.ok(t.length <= 72, `title was ${t.length} chars`);
  assert.match(t, /closes #1/);
});

test("singleIssueIntegrationBranch returns the same per-issue branch (no integration step)", () => {
  // For 1:1 cardinality, the fix branch IS the integration branch.
  assert.equal(singleIssueIntegrationBranch(53, "baf4028"), "fix/upstream-issue-53-baf4028");
});
