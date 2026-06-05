#!/usr/bin/env node
/**
 * write-report.mjs — render the swarm ledger as a markdown rollup.
 * CLI: node write-report.mjs <ledger.json> <out.md>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STATE_TITLES = {
  "merged": "Merged",
  "pending-human-review": "Pending-human-review",
  "quarantined": "Quarantined",
  "refuted": "Refuted",
  "skipped": "Skipped",
};

function countStates(issues) {
  const counts = { merged: 0, "pending-human-review": 0, quarantined: 0, refuted: 0, skipped: 0 };
  for (const i of Object.values(issues)) if (counts[i.state] !== undefined) counts[i.state] += 1;
  return counts;
}

export function renderReport(ledger) {
  const counts = countStates(ledger.issues);
  const lines = [];
  lines.push(`# Upstream-Swarm Report — ${ledger.date}`);
  lines.push("");
  lines.push(`**Filter:** \`${ledger.filter ?? ""}\``);
  lines.push("");
  lines.push("## Outcome");
  lines.push("");
  for (const [state, label] of Object.entries(STATE_TITLES)) {
    lines.push(`- ${label}: **${counts[state]}**`);
  }
  lines.push("");
  lines.push("## Per-issue");
  lines.push("");
  lines.push("| Issue | State | PR | mergeSha | Sev | Retries | Refute |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  const numbers = Object.keys(ledger.issues).map(Number).sort((a, b) => a - b);
  for (const n of numbers) {
    const i = ledger.issues[String(n)];
    const refute = i.refute?.tally?.panelVerdict ?? "—";
    const prCell = i.prUrl ? `[#${i.prNumber}](${i.prUrl})` : "—";
    lines.push(`| #${n} | ${i.state} | ${prCell} | ${i.mergeSha ?? "—"} | ${i.severity ?? "—"} | ${i.retryCount ?? 0} | ${refute} |`);
  }
  lines.push("");
  const retried = numbers.filter((n) => (ledger.issues[String(n)].retryCount ?? 0) > 0);
  if (retried.length) {
    lines.push("## Retry log");
    lines.push("");
    for (const n of retried) {
      const i = ledger.issues[String(n)];
      lines.push(`- #${n}: ${i.retryReason ?? "—"} → ${i.state}`);
    }
    lines.push("");
  }
  if (ledger.baselineGate) {
    lines.push("## Baseline gate");
    lines.push("");
    lines.push(`- Pass: ${ledger.baselineGate.pass}`);
    if (ledger.baselineGate.logPath) lines.push(`- Log: \`${ledger.baselineGate.logPath}\``);
    lines.push("");
  }
  return lines.join("\n");
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const inPath = process.argv[2];
    const outPath = process.argv[3];
    if (!inPath || !outPath) throw new Error("Usage: node write-report.mjs <ledger.json> <out.md>");
    const ledger = JSON.parse(readFileSync(inPath, "utf-8"));
    const md = renderReport(ledger);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, md);
    process.stdout.write(JSON.stringify({ path: outPath }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
