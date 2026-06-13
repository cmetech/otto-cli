#!/usr/bin/env node
/**
 * swarm-ledger.mjs — durable state-machine ledger for upstream-swarm.
 * As module: import { initSwarmLedger, readLedger, recordTransition, recordRetry, VALID_TRANSITIONS } from "./swarm-ledger.mjs"
 */
import { readLedger, writeLedger, validateTransition, SCHEMA_VERSION } from "../../_common/scripts/base-ledger.mjs";
export { readLedger, writeLedger };

const RETRY_CAP = 1;

export const VALID_TRANSITIONS = {
  "selected": ["planning", "skipped"],
  "planning": ["fixing", "skipped"],
  "fixing": ["fix-ok", "fix-failed"],
  "fix-ok": ["awaiting-ci", "pending-human-review"],
  "awaiting-ci": ["ci-green", "ci-red"],
  "ci-green": ["local-gate-pending"],
  "ci-red": ["retrying", "quarantined"],
  "local-gate-pending": ["refute-pending", "local-gate-failed"],
  "local-gate-failed": ["quarantined"],
  "refute-pending": ["approved", "refuted", "pending-human-review"],
  "approved": ["merged"],
  "refuted": ["quarantined"],
  "merged": [],
  // `pending-human-review` and `quarantined` were terminal in v1 — a
  // resumable swarm needs a way to re-attempt an issue once the human has
  // fixed the underlying cause (e.g. rebased away contamination, repaired
  // a flaky test). `selected` puts the issue back at the head of the
  // queue without losing audit history (retryCount / refute / reason are
  // preserved on the issue record).
  "pending-human-review": ["selected"],
  "quarantined": ["selected"],
  "skipped": ["selected"],
  "fix-failed": ["retrying", "quarantined"],
  "retrying": ["fixing"],
};

export function initSwarmLedger(path, { date, filter, issues }) {
  const ledger = { version: SCHEMA_VERSION, date, filter, startedAt: null, baselineGate: null, waves: [], issues: {} };
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
    validateTransition(issue.state, nextState, VALID_TRANSITIONS, `issue #${number}`);
    issue.state = nextState;
    for (const [k, v] of Object.entries(payload)) issue[k] = v;
  });
}

export function recordRetry(path, number, reason) {
  return mutateIssue(path, number, (issue) => {
    if (issue.retryCount >= RETRY_CAP) {
      throw new Error(`retry cap exceeded for issue #${number}`);
    }
    validateTransition(issue.state, "retrying", VALID_TRANSITIONS, `issue #${number}`);
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
