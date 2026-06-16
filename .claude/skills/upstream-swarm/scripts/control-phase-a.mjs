#!/usr/bin/env node
/**
 * control-phase-a.mjs — Phase A controller subcommands: `preflight`
 * (clean-main + baseline gate) and `select` (select + partition + wave-plan +
 * ledger init). Thin wrappers over the existing exported functions.
 */
import { preflightCleanMain } from "./preflight-clean-main.mjs";
import { runBaselineGate } from "./baseline-gate.mjs";
import { selectAndPartition } from "./select-issues.mjs";
import { planWaves } from "./wave-plan.mjs";
import { initSwarmLedger } from "./swarm-ledger.mjs";

export async function preflight({
  workdir, log, base = "origin/main", skipBaseline = false,
  gitRunner, worktreeRunner, provisionDeps, gateRunner,
} = {}) {
  // Only forward injectable runners when provided (tests); otherwise let the
  // reused functions use their real defaults (production CLI path).
  const cm = preflightCleanMain(gitRunner ? { base, gitRunner } : { base });
  let baseline = null;
  if (!skipBaseline) {
    const gateOpts = { workdir, logPath: log, base };
    if (worktreeRunner) gateOpts.worktreeRunner = worktreeRunner;
    if (provisionDeps) gateOpts.provisionDeps = provisionDeps;
    if (gateRunner) gateOpts.gateRunner = gateRunner;
    baseline = await runBaselineGate(gateOpts);
  }
  const ok = cm.clean && (skipBaseline || (baseline && baseline.pass));
  return { clean: cm.clean, cleanMessage: cm.message, baseline, ok };
}

export function select({ filter, configPath, repo, guidanceDir, out, ledgerOut, date, maxWaveSize = 3 }) {
  const filterObj = typeof filter === "string" ? JSON.parse(filter) : (filter ?? {});
  const part = selectAndPartition({ filter: filterObj, configPath, repo, guidanceDir, outPath: out });
  const allIssues = [...part.autoTier, ...part.humanTier];
  const waves = planWaves(allIssues, { maxWaveSize: Number(maxWaveSize) });
  let ledger = null;
  if (ledgerOut) {
    initSwarmLedger(ledgerOut, { date, filter: JSON.stringify(filterObj), issues: allIssues });
    ledger = ledgerOut;
  }
  const waveCount = waves.length;
  return { totalAuto: part.totalAuto, totalHuman: part.totalHuman, totalNeedsTriage: part.totalNeedsTriage, totalDeferred: part.totalDeferred, waveCount, ledger };
}
