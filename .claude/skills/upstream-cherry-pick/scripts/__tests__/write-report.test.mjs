import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReport } from "../write-report.mjs";

const baseRunData = {
  upstream: { name: "pi-dev", ghRepo: "earendil-works/pi" },
  scope: { fromCommit: "v0.75.4", fromSha: "3533843dabcdef1234", toSha: "0897f175abcdef1234" },
  date: "2026-05-30",
  totals: { scanned: 187, filed: 24, notApplicable: 18, skipped: 134, unclassified: 11 },
  filed: {
    criticalSecurity: [],
    criticalStability: [
      { issueNumber: 1234, sha: "03e229dabc1234", subject: "fix: render bug", conflictRisk: "MEDIUM" },
    ],
    niceToHaveFix: [
      { issueNumber: 1235, sha: "5754851abc1234", subject: "fix: nicety", conflictRisk: "LOW" },
    ],
    feature: [
      { issueNumber: 1236, sha: "86e7d8babc1234", subject: "feat: x", conflictRisk: "LOW" },
    ],
  },
  notApplicable: [
    { sha: "a3f9c12abc", subject: "feat: bun compile", ruleId: "bun-distribution", reason: "OTTO is npm-only." },
  ],
  unclassified: [
    { sha: "1f3a92cabc", subject: "wip: stuff", note: "ambiguous" },
  ],
  skipped: [
    { sha: "886fa6cabc", subject: "chore: foo", reason: "prefix:chore:" },
  ],
  preflight: { passed: 10, autoCreatedLabels: 2 },
  stateAdvanceTo: "0897f175abcdef1234",
};

test("writes a file with the expected name", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const path = writeReport({ outputDir: dir, runData: baseRunData });
    assert.ok(existsSync(path));
    assert.match(path, /2026-05-30-pi-dev-audit\.md$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report header contains scope, totals, and date", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const path = writeReport({ outputDir: dir, runData: baseRunData });
    const md = readFileSync(path, "utf-8");
    assert.match(md, /# Upstream audit — pi-dev — 2026-05-30/);
    assert.match(md, /Commits scanned.*187/);
    assert.match(md, /Issues filed.*24/);
    assert.match(md, /Not applicable to OTTO.*18/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sections render filed issues with emoji and conflict-risk", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const path = writeReport({ outputDir: dir, runData: baseRunData });
    const md = readFileSync(path, "utf-8");
    assert.match(md, /## Critical — security/);
    assert.match(md, /\(none\)/, "empty section should say (none)");
    assert.match(md, /#1234.*🐛.*\[sha=03e229d\].*fix: render bug.*conflict-risk:medium/);
    assert.match(md, /#1235.*🩹.*fix: nicety/);
    assert.match(md, /#1236.*✨.*feat: x/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("not-applicable table includes rule and reason", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const path = writeReport({ outputDir: dir, runData: baseRunData });
    const md = readFileSync(path, "utf-8");
    assert.match(md, /## Not applicable to OTTO \(1\)/);
    assert.match(md, /\| `a3f9c12` \| feat: bun compile \| `bun-distribution` \| OTTO is npm-only\. \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skipped section uses <details>", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const path = writeReport({ outputDir: dir, runData: baseRunData });
    const md = readFileSync(path, "utf-8");
    assert.match(md, /<details>/);
    assert.match(md, /<summary>Expand<\/summary>/);
    assert.match(md, /886fa6c.*chore: foo.*prefix:chore:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run report relabels header and filed lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const dryData = {
      ...baseRunData,
      dryRun: true,
      filed: {
        criticalSecurity: [],
        criticalStability: [
          { issueNumber: null, sha: "03e229dabc1234", subject: "fix: render bug", conflictRisk: "MEDIUM" },
        ],
        niceToHaveFix: [
          { issueNumber: 1235, existingState: "OPEN", sha: "5754851abc1234", subject: "fix: nicety", conflictRisk: "LOW" },
        ],
        feature: [],
      },
    };
    const path = writeReport({ outputDir: dir, runData: dryData });
    const md = readFileSync(path, "utf-8");
    // Header reflects dry-run, not "Issues filed"
    assert.match(md, /DRY RUN|would be filed/i);
    assert.doesNotMatch(md, /^\*\*Issues filed\*\*/m);
    // New candidate rendered as "would file", not a fake number
    assert.match(md, /\[would file\].*fix: render bug/);
    assert.doesNotMatch(md, /#DRY-RUN/);
    // Already-existing issue still shows its number + state
    assert.match(md, /#1235.*exists.*OPEN/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty filed sections show (none)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-report-"));
  try {
    const empty = { ...baseRunData, filed: { criticalSecurity: [], criticalStability: [], niceToHaveFix: [], feature: [] } };
    const path = writeReport({ outputDir: dir, runData: empty });
    const md = readFileSync(path, "utf-8");
    // At least 4 occurrences of "(none)" — one per empty section
    const noneCount = (md.match(/\(none\)/g) || []).length;
    assert.ok(noneCount >= 4, `expected at least 4 (none) markers, got ${noneCount}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
