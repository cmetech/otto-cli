#!/usr/bin/env node
/**
 * scheduler.mjs — return the next runnable lanes from the ledger.
 * CLI: node scheduler.mjs --next <ledger-path> [--cap 3]
 */
import { readLedger } from "./ledger.mjs";

export function nextLanes(ledgerPath, { cap = 3 } = {}) {
  const ledger = readLedger(ledgerPath);
  if (!ledger) throw new Error(`ledger not found at ${ledgerPath}`);
  const laneEntries = Object.entries(ledger.lanes).sort((a, b) => Number(a[0]) - Number(b[0]));
  const inFlight = laneEntries.filter(([, l]) => l.status === "in-progress").length;
  const budget = Math.max(0, cap - inFlight);
  const pending = laneEntries.filter(([, l]) => l.status === "pending").slice(0, budget);

  return pending.map(([id, lane]) => ({
    id: Number(id),
    branch: lane.branch,
    worktree: lane.worktree,
    issues: lane.issues.map((num) => {
      const iss = ledger.issues[num];
      return { number: num, sha: iss.sha, guidancePath: iss.guidancePath, targetFiles: iss.targetFiles };
    }),
  }));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const argv = process.argv.slice(2);
    if (!argv.includes("--next")) throw new Error("Usage: node scheduler.mjs --next <ledger-path> [--cap N]");
    const path = argv[argv.indexOf("--next") + 1];
    const capIdx = argv.indexOf("--cap");
    const cap = capIdx >= 0 ? Number(argv[capIdx + 1]) : 3;
    if (!path) throw new Error("missing ledger path after --next");
    process.stdout.write(JSON.stringify(nextLanes(path, { cap }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
