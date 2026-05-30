import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySeverity } from "../classify-severity.mjs";

const rubric = {
  securityRegex: /\b(cve|vulnerab|auth\s*bypass|sandbox\s*escape|secret\s*leak|exfiltr|rce|injection|xss|csrf)\b/i,
  stabilityRegex: /\b(crash|hang|oom|infinite\s*loop|data\s*loss|corrupt|lockup|deadlock|panic|unrecover)\b/i,
  skipPrefixes: ["chore:", "docs:", "test:", "ci:", "style:", "refactor:", "build:"],
};

test("CRITICAL_SECURITY for CVE mention", () => {
  const r = classifySeverity({ subject: "fix: patch CVE-2026-12345 in oauth flow", body: "" }, rubric);
  assert.equal(r.severity, "CRITICAL_SECURITY");
});

test("CRITICAL_STABILITY for crash keyword", () => {
  const r = classifySeverity({ subject: "fix: prevent crash on empty config", body: "" }, rubric);
  assert.equal(r.severity, "CRITICAL_STABILITY");
});

test("FEATURE for feat: prefix", () => {
  const r = classifySeverity({ subject: "feat(theme): add cool-mint variant", body: "" }, rubric);
  assert.equal(r.severity, "FEATURE");
});

test("NICE_TO_HAVE_FIX for plain fix: prefix", () => {
  const r = classifySeverity({ subject: "fix(ui): truncate long labels", body: "" }, rubric);
  assert.equal(r.severity, "NICE_TO_HAVE_FIX");
});

test("SKIP for chore: prefix", () => {
  const r = classifySeverity({ subject: "chore: bump deps", body: "" }, rubric);
  assert.equal(r.severity, "SKIP");
});

test("SKIP for merge commit", () => {
  const r = classifySeverity({ subject: "Merge pull request #138 from foo/bar", body: "" }, rubric);
  assert.equal(r.severity, "SKIP");
});

test("UNCLASSIFIED for ambiguous", () => {
  const r = classifySeverity({ subject: "wip update", body: "" }, rubric);
  assert.equal(r.severity, "UNCLASSIFIED");
});

test("severity check runs against body too", () => {
  const r = classifySeverity(
    { subject: "fix: minor", body: "Closes a possible RCE in the parser." },
    rubric,
  );
  assert.equal(r.severity, "CRITICAL_SECURITY");
});
