#!/usr/bin/env node
/**
 * swarm-ledger.mjs — durable state-machine ledger for upstream-swarm.
 * As module: import { initSwarmLedger, readLedger, recordTransition, recordRetry, VALID_TRANSITIONS } from "./swarm-ledger.mjs"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const RETRY_CAP = 1;

export const VALID_TRANSITIONS = {
  "selected": ["planning", "skipped"],
  "planning": ["fixing", "skipped"],
  "fixing": ["fix-ok", "fix-failed"],
  "fix-ok": ["awaiting-ci"],
  "awaiting-ci": ["ci-green", "ci-red"],
  "ci-green": ["local-gate-pending"],
  "ci-red": ["retrying", "quarantined"],
  "local-gate-pending": ["refute-pending", "local-gate-failed"],
  "local-gate-failed": ["quarantined"],
  "refute-pending": ["approved", "refuted", "pending-human-review"],
  "approved": ["merged"],
  "refuted": ["quarantined"],
  "merged": [],
  "pending-human-review": [],
  "quarantined": [],
  "skipped": ["selected"],
  "fix-failed": ["retrying", "quarantined"],
  "retrying": ["fixing"],
};

export function readLedger(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeLedger(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function initSwarmLedger(path, { date, filter, issues }) {
  const ledger = { version: 1, date, filter, startedAt: null, baselineGate: null, waves: [], issues: {} };
  for (const i of issues) {
    ledger.issues[String(i.number)] = {
      severity: i.severity ?? null,
      conflictRisk: i.conflictRisk ?? null,
      sha: i.sha ?? null,
      targetFiles: i.targetFiles ?? [],
      state: "selected",
      retryCount: 0,
      retryReason: null,
      wave: null,
      prNumber: null,
      prUrl: null,
      checks: null,
      localGate: null,
      refute: null,
      mergeSha: null,
      reason: null,
    };
  }
  writeLedger(path, ledger);
  return ledger;
}

function mutateIssue(path, number, fn) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const issue = ledger.issues[String(number)];
  if (!issue) throw new Error(`unknown issue #${number} in ledger`);
  fn(issue, ledger);
  writeLedger(path, ledger);
  return issue;
}

export function recordTransition(path, number, nextState, payload = {}) {
  return mutateIssue(path, number, (issue) => {
    const allowed = VALID_TRANSITIONS[issue.state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(`invalid transition: ${issue.state} → ${nextState} for issue #${number}`);
    }
    issue.state = nextState;
    for (const [k, v] of Object.entries(payload)) issue[k] = v;
  });
}

export function recordRetry(path, number, reason) {
  return mutateIssue(path, number, (issue) => {
    if (issue.retryCount >= RETRY_CAP) {
      throw new Error(`retry cap exceeded for issue #${number}`);
    }
    const allowed = VALID_TRANSITIONS[issue.state] ?? [];
    if (!allowed.includes("retrying")) {
      throw new Error(`invalid transition: ${issue.state} → retrying for issue #${number}`);
    }
    issue.state = "retrying";
    issue.retryCount += 1;
    issue.retryReason = reason;
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) { process.stderr.write(JSON.stringify({ error: "Usage: node swarm-ledger.mjs <ledger-path>" }) + "\n"); process.exit(1); }
  process.stdout.write(JSON.stringify(readLedger(path), null, 2) + "\n");
}
