import { test } from "node:test";
import assert from "node:assert/strict";
import { applyContextUpgrades } from "../apply-context-upgrades.mjs";

const baseFirstPass = { severity: "NICE_TO_HAVE_FIX", matchedBy: "fix-prefix" };

test("upgrades to CRITICAL_SECURITY when label matches", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: { kind: "pr", data: { labels: [{ name: "security" }], reviews: [], comments: [] } },
    issueContexts: [],
  });
  assert.equal(result.severity, "CRITICAL_SECURITY");
  assert.match(result.upgradeReason, /security/i);
});

test("upgrades to CRITICAL_STABILITY for regression label", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: null,
    issueContexts: [{ kind: "issue", data: { labels: [{ name: "regression" }], state: "OPEN", comments: [] } }],
  });
  assert.equal(result.severity, "CRITICAL_STABILITY");
});

test("upgrades to CRITICAL_STABILITY for backport in review comment", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: {
      kind: "pr",
      data: {
        labels: [],
        reviews: [{ body: "Looks good. Backport to v1.0.x?", state: "COMMENTED" }],
        comments: [],
      },
    },
    issueContexts: [],
  });
  assert.equal(result.severity, "CRITICAL_STABILITY");
});

test("downgrades to SKIP when all linked issues are wontfix", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: null,
    issueContexts: [
      { kind: "issue", data: { labels: [], state: "CLOSED", stateReason: "NOT_PLANNED", comments: [] } },
    ],
  });
  assert.equal(result.severity, "SKIP");
});

test("UNCLASSIFIED + bug label + 2 approvals → NICE_TO_HAVE_FIX", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "UNCLASSIFIED" },
    prContext: {
      kind: "pr",
      data: {
        labels: [{ name: "bug" }],
        reviews: [{ state: "APPROVED" }, { state: "APPROVED" }],
        comments: [],
      },
    },
    issueContexts: [],
  });
  assert.equal(result.severity, "NICE_TO_HAVE_FIX");
});

test("UNCLASSIFIED + enhancement label → FEATURE", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "UNCLASSIFIED" },
    prContext: { kind: "pr", data: { labels: [{ name: "enhancement" }], reviews: [], comments: [] } },
    issueContexts: [],
  });
  assert.equal(result.severity, "FEATURE");
});

test("no upgrade returns firstPass unchanged", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: null,
    issueContexts: [],
  });
  assert.equal(result.severity, "NICE_TO_HAVE_FIX");
  assert.equal(result.upgradeReason, undefined);
});

test("UNCLASSIFIED stays UNCLASSIFIED when no signal", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "UNCLASSIFIED" },
    prContext: null,
    issueContexts: [],
  });
  assert.equal(result.severity, "UNCLASSIFIED");
});

test("body keyword 'production' upgrades to CRITICAL_STABILITY", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "NICE_TO_HAVE_FIX" },
    prContext: null,
    issueContexts: [
      { kind: "issue", data: { labels: [], state: "OPEN", body: "This crashes for all users in production.", comments: [] } },
    ],
  });
  assert.equal(result.severity, "CRITICAL_STABILITY");
});

// --- Additional edge-case tests ---

test("security wins over stability when both labels present (rule priority 1 > 2)", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: {
      kind: "pr",
      data: {
        labels: [{ name: "regression" }, { name: "cve-2026-0001" }],
        reviews: [],
        comments: [],
      },
    },
    issueContexts: [],
  });
  assert.equal(result.severity, "CRITICAL_SECURITY");
  assert.match(result.upgradeReason, /cve/i);
});

test("SKIP fires only when ALL issues are closed/wontfix (mixed open+closed stays unchanged)", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: null,
    issueContexts: [
      { kind: "issue", data: { labels: [], state: "CLOSED", stateReason: "NOT_PLANNED", comments: [] } },
      { kind: "issue", data: { labels: [], state: "OPEN", stateReason: null, comments: [] } },
    ],
  });
  // not all closed → no SKIP upgrade → firstPass unchanged
  assert.equal(result.severity, "NICE_TO_HAVE_FIX");
});

test("UNCLASSIFIED + bug label + only 1 approval does NOT upgrade to NICE_TO_HAVE_FIX", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "UNCLASSIFIED" },
    prContext: {
      kind: "pr",
      data: {
        labels: [{ name: "bug" }],
        reviews: [{ state: "APPROVED" }],
        comments: [],
      },
    },
    issueContexts: [],
  });
  // only 1 approval, no enhancement label → stays UNCLASSIFIED
  assert.equal(result.severity, "UNCLASSIFIED");
});

test("backport in PR comment (not review) also upgrades to CRITICAL_STABILITY", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: {
      kind: "pr",
      data: {
        labels: [],
        reviews: [],
        comments: [{ body: "Please backport this to the 2.x branch." }],
      },
    },
    issueContexts: [],
  });
  assert.equal(result.severity, "CRITICAL_STABILITY");
  assert.match(result.upgradeReason, /backport/i);
});

test("vulnerability label on issue (not PR) triggers CRITICAL_SECURITY", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: null,
    issueContexts: [
      { kind: "issue", data: { labels: [{ name: "vulnerability" }], state: "OPEN", comments: [] } },
    ],
  });
  assert.equal(result.severity, "CRITICAL_SECURITY");
});

test("enhancement label on issue (not PR) upgrades UNCLASSIFIED to FEATURE", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "UNCLASSIFIED" },
    prContext: null,
    issueContexts: [
      { kind: "issue", data: { labels: [{ name: "enhancement" }], state: "OPEN", comments: [] } },
    ],
  });
  assert.equal(result.severity, "FEATURE");
});

test("non-UNCLASSIFIED is not upgraded to FEATURE by enhancement label", () => {
  const result = applyContextUpgrades({
    firstPass: { severity: "NICE_TO_HAVE_FIX", matchedBy: "fix-prefix" },
    prContext: { kind: "pr", data: { labels: [{ name: "enhancement" }], reviews: [], comments: [] } },
    issueContexts: [],
  });
  // NICE_TO_HAVE_FIX is not UNCLASSIFIED → rule 7 doesn't fire
  assert.equal(result.severity, "NICE_TO_HAVE_FIX");
  assert.equal(result.upgradeReason, undefined);
});

test("duplicate stateReason triggers SKIP", () => {
  const result = applyContextUpgrades({
    firstPass: baseFirstPass,
    prContext: null,
    issueContexts: [
      { kind: "issue", data: { labels: [], state: "CLOSED", stateReason: "DUPLICATE", comments: [] } },
    ],
  });
  assert.equal(result.severity, "SKIP");
});
