#!/usr/bin/env node
/**
 * record-result.mjs — fold a thin subagent result line into the ledger.
 * Line grammar: #<num> <resolved|unresolved> <sha|none> "<reason>"
 * CLI: node record-result.mjs <ledger-path> '<result-line>'
 */
import { recordIssueResult, setLaneStatus } from "./ledger.mjs";

export function parseResultLine(line) {
  const m = line.trim().match(/^#(\d+)\s+(resolved|unresolved)\s+(\S+)\s+"([\s\S]*)"\s*$/);
  if (!m) throw new Error(`unparseable result line: ${line}`);
  const [, number, status, shaRaw, reason] = m;
  const commitSha = shaRaw === "none" ? null : shaRaw;
  return { number, status, commitSha, reason };
}

export function foldResult(ledgerPath, line) {
  const { number, status, commitSha, reason } = parseResultLine(line);
  recordIssueResult(ledgerPath, { number, status, commitSha, reason });
  return `#${number} ${status}${commitSha ? ` ${commitSha}` : ""}`;
}

export function recordLaneResult(ledgerPath, laneId, status = "done") {
  setLaneStatus(ledgerPath, laneId, status);
  return `lane ${laneId} ${status}`;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledgerPath = process.argv[2];
    const line = process.argv[3];
    if (!ledgerPath || !line) throw new Error("Usage: node record-result.mjs <ledger-path> '<result-line>'");
    process.stdout.write(foldResult(ledgerPath, line) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
