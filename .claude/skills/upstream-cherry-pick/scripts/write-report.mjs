#!/usr/bin/env node
/**
 * write-report.mjs — render audit report per §12 of the spec.
 *
 * API:
 *   writeReport({ outputDir, runData }) → absoluteFilePath
 *
 * CLI:
 *   node write-report.mjs <outputDir> < runData.json
 *   → emits the written file path to stdout
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return first 7 chars of a sha. */
function shortSha(sha) {
  return (sha ?? "").slice(0, 7);
}

/** Emoji per section key. */
const SECTION_EMOJI = {
  criticalSecurity: "🛡️",
  criticalStability: "🐛",
  niceToHaveFix: "🩹",
  feature: "✨",
};

/** Human heading per section key. */
const SECTION_HEADING = {
  criticalSecurity: "Critical — security",
  criticalStability: "Critical — stability",
  niceToHaveFix: "Nice-to-have fixes",
  feature: "Features",
};

/**
 * Render a single filed issue line.
 * Format: "- #{issueNumber} — {emoji} [sha={shortSha}] {subject} — `conflict-risk:{risk-lower}`"
 */
function renderFiledLine(item, emoji) {
  const sha7 = shortSha(item.sha);
  const risk = (item.conflictRisk ?? "unknown").toLowerCase();
  return `- #${item.issueNumber} — ${emoji} [sha=${sha7}] ${item.subject} — \`conflict-risk:${risk}\``;
}

/**
 * Render a filed section (criticalSecurity, criticalStability, etc.).
 */
function renderFiledSection(key, items) {
  const heading = SECTION_HEADING[key];
  const emoji = SECTION_EMOJI[key];
  const count = items.length;
  const lines =
    count === 0
      ? ["(none)"]
      : items.map((item) => renderFiledLine(item, emoji));
  return [`## ${heading} (${count})`, "", ...lines].join("\n");
}

/**
 * Render the unclassified section.
 */
function renderUnclassifiedSection(items) {
  const count = items.length;
  const lines =
    count === 0
      ? ["(none)"]
      : items.map((item) => `- \`${shortSha(item.sha)}\` — ${item.subject} (${item.note})`);
  return [`## Unclassified — needs manual triage (${count})`, "", ...lines].join("\n");
}

/**
 * Render the not-applicable section.
 */
function renderNotApplicableSection(items) {
  const count = items.length;
  const header = `## Not applicable to OTTO (${count})`;
  const intro =
    "These commits were reviewed against the applicability rules in `.planning/upstream-sync-config.json` and intentionally not filed as issues.";

  if (count === 0) {
    return [header, "", "(none)"].join("\n");
  }

  const tableHeader = "| Commit | Subject | Rule | Reason |";
  const tableSep = "|---|---|---|---|";
  const tableRows = items.map(
    (item) => `| \`${shortSha(item.sha)}\` | ${item.subject} | \`${item.ruleId}\` | ${item.reason} |`
  );

  return [header, "", intro, "", tableHeader, tableSep, ...tableRows].join("\n");
}

/**
 * Render the skipped section with a <details> block.
 */
function renderSkippedSection(items) {
  const count = items.length;
  const header = `## Skipped (${count})`;
  const intro =
    "Mechanical filter — `chore:` / `docs:` / `test:` / `ci:` / `style:` / `refactor:` / `build:` prefixes plus merge commits and PatchDeck syncs. No applicability or severity judgment made; not filed.";

  const detailLines = items.map(
    (item) => `- \`${shortSha(item.sha)}\` ${item.subject} — \`${item.reason}\``
  );

  const details = [
    "<details>",
    "<summary>Expand</summary>",
    "",
    ...detailLines,
    "",
    "</details>",
  ].join("\n");

  return [header, "", intro, "", details].join("\n");
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Write the audit report markdown to disk.
 *
 * @param {{ outputDir: string, runData: object }} opts
 * @returns {string} absolute path of the written file
 */
export function writeReport({ outputDir, runData }) {
  const {
    upstream,
    scope,
    date,
    totals,
    filed,
    notApplicable,
    unclassified,
    skipped,
    preflight,
    stateAdvanceTo,
  } = runData;

  const fromSha7 = shortSha(scope.fromSha);
  const toSha7 = shortSha(scope.toSha);
  const stateSha7 = shortSha(stateAdvanceTo);

  // Build each section
  const filedSections = [
    renderFiledSection("criticalSecurity", filed.criticalSecurity ?? []),
    renderFiledSection("criticalStability", filed.criticalStability ?? []),
    renderFiledSection("niceToHaveFix", filed.niceToHaveFix ?? []),
    renderFiledSection("feature", filed.feature ?? []),
  ];

  const sections = [
    // Header
    `# Upstream audit — ${upstream.name} — ${date}`,
    "",
    `**Scope**: ${scope.fromCommit} (${fromSha7}) → HEAD (${toSha7})`,
    `**Commits scanned**: ${totals.scanned}`,
    `**Issues filed**: ${totals.filed}`,
    `**Not applicable to OTTO**: ${totals.notApplicable} (matched applicability rules)`,
    `**Skipped (mechanical)**: ${totals.skipped} (merge / chore / docs / already filed)`,
    `**Unclassified (manual triage)**: ${totals.unclassified}`,
    "",
    // Filed sections
    filedSections.join("\n\n"),
    "",
    // Unclassified
    renderUnclassifiedSection(unclassified ?? []),
    "",
    // Not applicable
    renderNotApplicableSection(notApplicable ?? []),
    "",
    // Skipped
    renderSkippedSection(skipped ?? []),
    "",
    // Preflight
    "## Preflight results",
    "",
    `- All ${preflight.passed} required checks passed`,
    `- Auto-created labels: ${preflight.autoCreatedLabels}`,
    "",
    "---",
    "",
    `State advanced: \`lastAnalyzedCommit\` → \`${stateSha7}\` (${upstream.name} HEAD as of ${date}).`,
    "",
  ];

  const markdown = sections.join("\n");

  // Ensure output directory exists
  const absOutputDir = resolve(outputDir);
  mkdirSync(absOutputDir, { recursive: true });

  const filename = `${date}-${upstream.name}-audit.md`;
  const filePath = join(absOutputDir, filename);

  writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// CLI mode: node write-report.mjs <outputDir> < runData.json
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputDir = process.argv[2];
  if (!outputDir) {
    process.stderr.write("Usage: node write-report.mjs <outputDir> < runData.json\n");
    process.exit(1);
  }

  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const runData = JSON.parse(stdin);
      const filePath = writeReport({ outputDir, runData });
      process.stdout.write(filePath + "\n");
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message, details: err.stack }) + "\n");
      process.exit(1);
    }
  });
}
