#!/usr/bin/env node
/**
 * write-sweep-report.mjs — §4 plain-language report for the Phase 6 backlog
 * sweep. Lists issues newly tagged status:superseded (with the superseding
 * evidence), advisory `rewritten` candidates (NOT tagged), and the feature
 * issues that need an alignment re-check (the agent judges those against
 * docs/OTTO-ALIGNMENT.md and applies alignment:* labels). No issue is closed by
 * the tool — a human always makes the final call.
 *
 * API:  writeSweepReport({ outputDir, runData, date }) → absoluteFilePath
 *       renderSweepMarkdown({ runData, date }) → markdown string
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

function renderSupersededSection(items) {
  const header = `## Tagged \`status:superseded\` (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const intro = "Deterministic Class-A hits — reverted or closed-as-unwanted upstream. Labeled + commented with evidence; **not closed**.";
  const rows = items.map((it) => {
    const ev =
      it.rule === "reverted"
        ? `reverted by \`${it.evidence?.revertingSha ?? "?"}\` (${it.evidence?.revertingSubject ?? ""})`
        : `upstream closed as \`${it.evidence?.stateReason ?? "?"}\``;
    return `- **#${it.number}** \`[sha=${it.sha}]\` — \`${it.rule}\`: ${ev}`;
  });
  return [header, "", intro, "", ...rows].join("\n");
}

function renderAdvisorySection(items) {
  const header = `## Advisory — possibly rewritten (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const intro = "Later commits touched the same files. **Advisory only — NOT tagged** (the least precise Class-A signal). A human should confirm before marking superseded.";
  const rows = items.map(
    (it) => `- **#${it.number}** \`[sha=${it.sha}]\` — ${it.evidence?.fileCount ?? "?"} file(s) later touched by: ${(it.evidence?.laterCommits ?? []).join("; ")}`,
  );
  return [header, "", intro, "", ...rows].join("\n");
}

function renderFeaturesSection(items) {
  const header = `## Feature issues needing an alignment re-check (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const intro = "Re-evaluate each against the current `docs/OTTO-ALIGNMENT.md` §5 and (re)apply `alignment:{core,adjacent,out-of-scope}` + a one-line reason via `issue-update.mjs`. Advisory — never auto-closed.";
  const rows = items.map((it) => `- **#${it.number}** \`[sha=${it.sha}]\` — ${it.title ?? ""}`);
  return [header, "", intro, "", ...rows].join("\n");
}

function renderSkippedSection(items) {
  const header = `## Skipped (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const rows = items.map((it) => `- **#${it.number}** — ${it.reason}`);
  return [header, "", ...rows].join("\n");
}

export function renderSweepMarkdown({ runData, date }) {
  const { scanned, superseded = [], advisory = [], features = [], skipped = [] } = runData;
  return [
    `# Upstream backlog sweep — ${date}`,
    "",
    `**Open actionable issues scanned**: ${scanned}`,
    `**Newly tagged \`status:superseded\`**: ${superseded.length}`,
    `**Advisory (rewritten, not tagged)**: ${advisory.length}`,
    `**Feature issues for alignment re-check**: ${features.length}`,
    "",
    "> Class A only (deterministic upstream-history). **No issue is closed by the tool** — every verdict is a label + evidence comment for a human to action.",
    "",
    renderSupersededSection(superseded),
    "",
    renderAdvisorySection(advisory),
    "",
    renderFeaturesSection(features),
    "",
    renderSkippedSection(skipped),
    "",
  ].join("\n");
}

export function writeSweepReport({ outputDir, runData, date }) {
  const markdown = renderSweepMarkdown({ runData, date });
  const absOutputDir = resolve(outputDir);
  mkdirSync(absOutputDir, { recursive: true });
  const filePath = join(absOutputDir, `${date}-backlog-sweep.md`);
  writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}
