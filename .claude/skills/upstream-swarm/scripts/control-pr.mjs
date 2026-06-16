#!/usr/bin/env node
/**
 * control-pr.mjs — PR-side controller subcommands: `poll` (one non-blocking CI
 * check) and `merge` (verdict-gated squash-merge). `merge` reads the recorded
 * refute panel verdict from the ledger and refuses unless it is exactly
 * "approve" — defense-in-depth on top of merge-pr's own --auto gate.
 */
import { pollPrChecks } from "./poll-pr-checks.mjs";
import { readRefuteVerdict, readLedger } from "./swarm-ledger.mjs";
import { mergePr } from "../../upstream-merge/scripts/merge-pr.mjs";

export function poll({ pr, repo, configPath, ghRunner }) {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) throw new Error(`poll requires integer --pr: ${pr}`);
  return pollPrChecks(ghRunner ? { prNumber, repo, configPath, ghRunner } : { prNumber, repo, configPath });
}

export function merge({
  pr, issue, ledger, repo, refuteReason,
  mergeFn = mergePr,
  readLedgerFn = readLedger,
}) {
  const prNumber = Number(pr);
  const issueNumber = Number(issue);
  if (!Number.isInteger(prNumber)) throw new Error(`merge requires integer --pr: ${pr}`);
  if (!Number.isInteger(issueNumber)) throw new Error(`merge requires integer --issue: ${issue}`);
  if (!ledger) throw new Error("merge requires --ledger <path>");

  const led = readLedgerFn(ledger);
  const verdict = readRefuteVerdict(led, issueNumber);
  if (verdict !== "approve") {
    return { merged: false, blockedBy: "refute", reason: `refute verdict is ${verdict ?? "missing"}; refusing to merge` };
  }
  return mergeFn({ number: prNumber, repo, auto: true, refuteVerdict: "approve", refuteReason: refuteReason ?? "" });
}
