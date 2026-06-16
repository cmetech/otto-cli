#!/usr/bin/env node
/**
 * control-ledger.mjs — ledger-writer subcommands: `record` (validated state
 * transition) and `retry` (1-retry-cap enforced). The controller is the sole
 * writer of the ledger; illegal transitions throw (surfaced as a CLI error).
 */
import { recordTransition, recordRetry } from "./swarm-ledger.mjs";
import { readLedger, writeLedger } from "./swarm-ledger.mjs";
import { classifyFailure } from "./transient-classifier.mjs";
import { computeSignature, recordQuarantineSignature } from "./abort-streak.mjs";

export function record({ ledger, issue, state, payload }) {
  if (!ledger) throw new Error("record requires --ledger <path>");
  if (issue == null) throw new Error("record requires --issue <n>");
  if (!state) throw new Error("record requires --state <nextState>");
  const payloadObj = typeof payload === "string" ? JSON.parse(payload) : (payload ?? {});
  return recordTransition(ledger, Number(issue), state, payloadObj);
}

export function retry({ ledger, issue, reason }) {
  if (!ledger) throw new Error("retry requires --ledger <path>");
  if (issue == null) throw new Error("retry requires --issue <n>");
  return recordRetry(ledger, Number(issue), reason ?? "");
}

export function classify(ctx) {
  const { category, reason } = classifyFailure(ctx);
  const signature = computeSignature({ stage: ctx.stage, failTail: ctx.failTail });
  return { category, reason, signature };
}

export function abortCheck({ ledger, signature, threshold }) {
  if (!ledger) throw new Error("abort-check requires --ledger <path>");
  if (!signature) throw new Error("abort-check requires --signature <s>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  const res = recordQuarantineSignature(led, signature, { threshold: Number(threshold ?? 5) });
  writeLedger(ledger, led);
  return res;
}
