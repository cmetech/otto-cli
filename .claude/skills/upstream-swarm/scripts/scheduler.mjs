#!/usr/bin/env node
/**
 * scheduler.mjs — pure backpressure loop for upstream-swarm.
 * Given the durable ledger and caps, returns the actions the runtime
 * should execute this tick. Pure; safe to call repeatedly.
 *
 * Action kinds: start-fix, quarantine-timeout, poll-ci-batch, run-local-gate, run-refute, merge-pr
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

// Severity tiers for scheduling priority (lower = ship first). Issues without a
// known severity sort last, then by number — preserving FIFO for untagged work.
const SEVERITY_RANK = {
  "critical-security": 0,
  "critical-stability": 1,
  "feature": 2,
  "nice-to-have-fix": 3,
};
function severityRank(sev) {
  return SEVERITY_RANK[sev] ?? 99;
}
function bySeverityThenNumber([na, a], [nb, b]) {
  return (severityRank(a.severity) - severityRank(b.severity)) || (Number(na) - Number(nb));
}

function countByState(ledger, predicate) {
  let n = 0;
  for (const i of Object.values(ledger.issues)) if (predicate(i.state)) n++;
  return n;
}

export function nextActions(ledger, caps, now = null) {
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
    .sort(bySeverityThenNumber)
    .slice(0, startCap);
  for (const [number] of startable) actions.push({ kind: "start-fix", issueNumber: Number(number) });

  // 1b. Per-issue circuit-breaker: an active-fix issue over its wall-clock
  // budget is quarantined so a stuck lane cannot block the swarm. Disabled
  // when now is unknown, no budget is set, or the issue was never stamped.
  if (now != null && caps.issueTimeoutMs) {
    for (const [number, issue] of Object.entries(ledger.issues)) {
      if (!IN_FLIGHT_FIX_STATES.has(issue.state)) continue;
      if (!issue.fixStartedAt) continue;
      if (now - issue.fixStartedAt > caps.issueTimeoutMs) {
        actions.push({ kind: "quarantine-timeout", issueNumber: Number(number), reason: `issue-timeout (>${caps.issueTimeoutMs}ms in ${issue.state})` });
      }
    }
  }

  // 2. Poll CI — one batched action, gated by per-issue exponential backoff.
  const basePollMs = caps.basePollMs ?? 60_000;
  const maxPollMs = caps.maxPollMs ?? 480_000;
  const shiftAfter = caps.pollBackoffAfter ?? 1; // start doubling after K no-change polls
  const duePolls = [];
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state !== "awaiting-ci") continue;
    const noChange = issue.pollNoChangeCount ?? 0;
    const shift = Math.max(0, noChange - shiftAfter + 1);
    const interval = Math.min(basePollMs * 2 ** shift, maxPollMs);
    const due = now == null || (now - (issue.lastPolledAt ?? 0)) >= interval;
    if (due) duePolls.push(Number(number));
  }
  if (duePolls.length) actions.push({ kind: "poll-ci-batch", issueNumbers: duePolls });

  // 3. Local gate on ci-green.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "ci-green") actions.push({ kind: "run-local-gate", issueNumber: Number(number) });
  }

  // 4. Refute panel on local-gate-pending, up to refuteConcurrency.
  const refuteSlack = Math.max(0, caps.refuteConcurrency - refutesInFlight);
  const refutable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "local-gate-pending")
    .sort(bySeverityThenNumber)
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
    process.stdout.write(JSON.stringify(nextActions(ledger, caps, Date.now()), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
