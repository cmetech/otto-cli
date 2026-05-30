#!/usr/bin/env node
/**
 * write-report.mjs — render the run-state ledger into a markdown fix report.
 * CLI: node write-report.mjs <ledger-path> <out-dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readLedger } from "./ledger.mjs";

function gatesLine(g) {
  const mark = (v) => (v === true ? "✅" : v === false ? "❌" : "—");
  return `regression ${mark(g.regression)} · build ${mark(g.build)} · targeted ${mark(g.targeted)}`;
}

export function renderReport(ledger) {
  const issues = Object.entries(ledger.issues);
  const resolved = issues.filter(([, i]) => i.status === "applied" || i.status === "resolved");
  const unresolved = issues.filter(([, i]) => i.status === "unresolved" || i.status === "rejected");
  const laneCount = Object.keys(ledger.lanes).length;

  const lines = [];
  lines.push(`# Upstream-Fix Report — ${ledger.date}`);
  lines.push("");
  lines.push(`**Filter:** \`${ledger.filter}\``);
  lines.push("");
  lines.push("## Roll-up");
  lines.push("");
  lines.push(`- ${resolved.length} resolved / ${unresolved.length} unresolved`);
  lines.push(`- ${laneCount} lanes`);
  lines.push(`- Integration branch: \`${ledger.integrationBranch}\``);
  lines.push(`- PR: ${ledger.prUrl ?? "_not opened_"}`);
  lines.push(`- Final suite: ${ledger.finalSuite ?? "_not run_"}`);
  lines.push("");
  lines.push("## Resolved");
  lines.push("");
  if (resolved.length === 0) lines.push("_none_");
  for (const [num, i] of resolved) {
    lines.push(`- **#${num}** (sha ${i.sha}) → \`${i.commitSha ?? "?"}\` — reviewer: ${i.reviewer ?? "—"}`);
    lines.push(`  - gates: ${gatesLine(i.gates)}`);
    if (i.reason) lines.push(`  - ${i.reason}`);
  }
  lines.push("");
  lines.push("## Unresolved");
  lines.push("");
  if (unresolved.length === 0) lines.push("_none_");
  for (const [num, i] of unresolved) {
    const why = i.status === "rejected" ? i.reviewerReason : i.reason;
    lines.push(`- **#${num}** (sha ${i.sha}) — ${i.status}: ${why ?? "no reason recorded"}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(ledger, outDir) {
  mkdirSync(outDir, { recursive: true });
  const markdown = renderReport(ledger);
  const path = join(outDir, `${ledger.date}-fix-report.md`);
  writeFileSync(path, markdown);
  return { path, markdown };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledgerPath = process.argv[2];
    const outDir = process.argv[3];
    if (!ledgerPath || !outDir) throw new Error("Usage: node write-report.mjs <ledger-path> <out-dir>");
    const ledger = readLedger(ledgerPath);
    if (!ledger) throw new Error(`ledger not found at ${ledgerPath}`);
    const { path } = writeReport(ledger, outDir);
    process.stdout.write(JSON.stringify({ path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
