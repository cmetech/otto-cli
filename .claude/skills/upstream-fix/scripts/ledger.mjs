#!/usr/bin/env node
/**
 * ledger.mjs — run-state ledger primitives (source of truth on disk).
 * As module: import { initLedger, readLedger, writeLedger, recordIssueResult,
 *   setLaneStatus, setIssueStatus } from "./ledger.mjs"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function readLedger(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeLedger(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function initLedger(path, { date, filter, integrationBranch, lanes, issues }) {
  const ledger = { version: 1, date, filter, integrationBranch, prUrl: null, finalSuite: null, lanes: {}, issues: {} };
  for (const lane of lanes) {
    ledger.lanes[String(lane.id)] = {
      issues: lane.issues.map(String),
      files: lane.files,
      branch: `fix/upstream-lane-${lane.id}`,
      worktree: `.worktrees/upstream-fix-lane-${lane.id}`,
      status: "pending",
    };
  }
  const laneOf = (num) => {
    for (const lane of lanes) if (lane.issues.map(String).includes(String(num))) return lane.id;
    return null;
  };
  for (const iss of issues) {
    ledger.issues[String(iss.number)] = {
      lane: laneOf(iss.number),
      sha: iss.sha ?? null,
      guidancePath: iss.guidancePath ?? null,
      targetFiles: iss.targetFiles ?? [],
      status: "pending",
      commitSha: null,
      touchedFiles: [],
      gates: { regression: null, build: null, targeted: null },
      reviewer: null,
      reviewerReason: null,
      reason: null,
    };
  }
  writeLedger(path, ledger);
  return ledger;
}

export function recordIssueResult(path, { number, status, commitSha = null, touchedFiles = null, reason = null, gates = null }) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const iss = ledger.issues[String(number)];
  if (!iss) throw new Error(`unknown issue #${number} in ledger`);
  iss.status = status;
  if (commitSha !== null) iss.commitSha = commitSha;
  if (touchedFiles !== null) iss.touchedFiles = touchedFiles;
  if (reason !== null) iss.reason = reason;
  if (gates !== null) iss.gates = { ...iss.gates, ...gates };
  writeLedger(path, ledger);
  return iss;
}

export function setIssueStatus(path, number, status, extra = {}) {
  return recordIssueResult(path, { number, status, ...extra });
}

export function setLaneStatus(path, laneId, status) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const lane = ledger.lanes[String(laneId)];
  if (!lane) throw new Error(`unknown lane ${laneId} in ledger`);
  lane.status = status;
  writeLedger(path, ledger);
  return lane;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) { process.stderr.write(JSON.stringify({ error: "Usage: node ledger.mjs <ledger-path>" }) + "\n"); process.exit(1); }
  const led = readLedger(path);
  process.stdout.write(JSON.stringify(led, null, 2) + "\n");
}
