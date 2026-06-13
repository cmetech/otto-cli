#!/usr/bin/env node
/**
 * merge-ledger.mjs — upstream-merge run-state ledger. Read/write come from
 * _common/base-ledger.mjs; this module owns the merge-specific API.
 */
import { readLedger, writeLedger, SCHEMA_VERSION } from "../../_common/scripts/base-ledger.mjs";
export { readLedger, writeLedger };

export function initMergeLedger(path, { date, prs }) {
  const ledger = { version: SCHEMA_VERSION, date, prs: {} };
  for (const pr of prs) {
    ledger.prs[String(pr.number)] = {
      headRef: pr.headRef ?? null,
      isDraft: pr.isDraft ?? false,
      status: "queued",        // queued | confirmed | merged | blocked | skipped
      checks: null,            // evaluateChecks() result
      localGate: null,         // { pass, failTail }
      mergeSha: null,
      reason: null,
    };
  }
  writeLedger(path, ledger);
  return ledger;
}

function mutatePr(path, number, fn) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const pr = ledger.prs[String(number)];
  if (!pr) throw new Error(`unknown PR #${number} in ledger`);
  fn(pr);
  writeLedger(path, ledger);
  return pr;
}

export function recordVerdict(path, number, { status = null, checks = null, localGate = null, reason = null }) {
  return mutatePr(path, number, (pr) => {
    if (status !== null) pr.status = status;
    if (checks !== null) pr.checks = checks;
    if (localGate !== null) pr.localGate = localGate;
    if (reason !== null) pr.reason = reason;
  });
}

export function recordMerge(path, number, { status = "merged", mergeSha = null }) {
  return mutatePr(path, number, (pr) => {
    pr.status = status;
    if (mergeSha !== null) pr.mergeSha = mergeSha;
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) { process.stderr.write(JSON.stringify({ error: "Usage: node merge-ledger.mjs <ledger-path>" }) + "\n"); process.exit(1); }
  process.stdout.write(JSON.stringify(readLedger(path), null, 2) + "\n");
}
