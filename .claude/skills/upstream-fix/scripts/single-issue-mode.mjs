#!/usr/bin/env node
/**
 * single-issue-mode.mjs — naming + PR-title helpers for upstream-fix --single-issue.
 * Pure functions. The actual scheduling in --single-issue mode is one issue
 * in one lane on one branch; these helpers keep names consistent.
 */

const MAX_TITLE = 72;

export function singleIssueBranch(issueNumber, sha) {
  return `fix/upstream-issue-${issueNumber}-${sha}`;
}

export function singleIssueIntegrationBranch(issueNumber, sha) {
  // In --single-issue, there is no separate integration step; the fix branch
  // IS the integration branch. Returning the same name centralizes the
  // assumption.
  return singleIssueBranch(issueNumber, sha);
}

export function singleIssuePrTitle({ number, subject }) {
  const closesSuffix = ` (closes #${number})`;
  const prefix = "fix(upstream): ";
  const budget = MAX_TITLE - prefix.length - closesSuffix.length;
  const subjectClipped = (subject ?? "").length > budget ? (subject ?? "").slice(0, budget - 1).trimEnd() + "…" : (subject ?? "");
  return `${prefix}${subjectClipped}${closesSuffix}`;
}
