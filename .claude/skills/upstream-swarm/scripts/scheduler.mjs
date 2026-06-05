#!/usr/bin/env node
/**
 * scheduler.mjs — pure backpressure loop for upstream-swarm.
 * Given the durable ledger and caps, returns the actions the runtime
 * should execute this tick. Pure; safe to call repeatedly.
 *
 * Action kinds: start-fix, poll-ci, run-local-gate, run-refute, merge-pr
 */

const IN_FLIGHT_FIX_STATES = new Set(["planning", "fixing", "retrying"]);
const OPEN_PR_STATES = new Set([
  "awaiting-ci",
  "ci-green",
  "ci-red",
  "local-gate-pending",
  "local-gate-failed",
  "refute-pending",
  "approved",
  "refuted",
  "pending-human-review",
]);

function countByState(ledger, predicate) {
  let n = 0;
  for (const i of Object.values(ledger.issues)) if (predicate(i.state)) n++;
  return n;
}

export function nextActions(ledger, caps) {
  const actions = [];
  const fixesInFlight = countByState(ledger, (s) => IN_FLIGHT_FIX_STATES.has(s));
  const openPrs = countByState(ledger, (s) => OPEN_PR_STATES.has(s));
  const refutesInFlight = countByState(ledger, (s) => s === "refute-pending");

  // 1. Start new fixes if there is fix-lane slack AND pr-window slack.
  let fixSlack = Math.max(0, caps.fixConcurrency - fixesInFlight);
  const prSlack = Math.max(0, caps.prWindow - openPrs);
  const startCap = Math.min(fixSlack, prSlack);
  const startable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "selected")
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, startCap);
  for (const [number] of startable) actions.push({ kind: "start-fix", issueNumber: Number(number) });

  // 2. Poll CI for awaiting-ci issues.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "awaiting-ci") actions.push({ kind: "poll-ci", issueNumber: Number(number) });
  }

  // 3. Local gate on ci-green.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "ci-green") actions.push({ kind: "run-local-gate", issueNumber: Number(number) });
  }

  // 4. Refute panel on local-gate-pending, up to refuteConcurrency.
  const refuteSlack = Math.max(0, caps.refuteConcurrency - refutesInFlight);
  const refutable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "local-gate-pending")
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, refuteSlack);
  for (const [number] of refutable) actions.push({ kind: "run-refute", issueNumber: Number(number) });

  // 5. Merge approved.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "approved") actions.push({ kind: "merge-pr", issueNumber: Number(number) });
  }

  return actions;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledger = JSON.parse(process.argv[2] ?? "{\"issues\":{}}");
    const caps = JSON.parse(process.argv[3] ?? "{\"fixConcurrency\":3,\"prWindow\":10,\"refuteConcurrency\":5}");
    process.stdout.write(JSON.stringify(nextActions(ledger, caps), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
