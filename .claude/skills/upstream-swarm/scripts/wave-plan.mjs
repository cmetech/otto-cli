#!/usr/bin/env node
/**
 * wave-plan.mjs — greedy file-disjoint partitioner for issue lists.
 * As module: import { planWaves } from "./wave-plan.mjs"
 * CLI: node wave-plan.mjs <selected-issues.json> [--max-wave-size N]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @param {Array<{number:number, targetFiles:string[]}>} issues
 * @param {{maxWaveSize:number}} opts
 * @returns {Array<Array<{number, targetFiles}>>} waves (outer = wave index)
 */
export function planWaves(issues, { maxWaveSize = 3 } = {}) {
  if (!issues.length) return [];
  const remaining = [...issues].sort((a, b) => a.number - b.number);
  const waves = [];

  while (remaining.length) {
    const wave = [];
    const usedFiles = new Set();
    for (let i = 0; i < remaining.length && wave.length < maxWaveSize; i++) {
      const issue = remaining[i];
      const files = issue.targetFiles ?? [];
      const conflicts = files.some((f) => usedFiles.has(f));
      if (conflicts) continue;
      wave.push(issue);
      for (const f of files) usedFiles.add(f);
    }
    for (const placed of wave) {
      const idx = remaining.indexOf(placed);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    if (!wave.length) {
      // Defensive: should never happen because the first remaining issue
      // is always placeable into an empty wave. Bail to avoid infinite loop.
      throw new Error("wave planner made no progress — bug");
    }
    waves.push(wave);
  }
  return waves;
}

function parseArgv(argv) {
  let inPath = null, maxWaveSize = 3, outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-wave-size") maxWaveSize = Number(argv[++i]);
    else if (argv[i] === "--out") outPath = argv[++i];
    else if (!inPath) inPath = argv[i];
  }
  return { inPath, maxWaveSize, outPath };
}

/**
 * Accept either a flat array of issues OR a select-issues.mjs output object
 * ({autoTier, humanTier, needsTriage}). Only autoTier flows through the
 * scheduler's pipelined waves; humanTier issues skip Phase B–C entirely
 * (they go straight to pending-human-review) and needsTriage issues are
 * skipped with a comment. See SKILL.md "Phase A — selection".
 */
export function extractWaveCandidates(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.autoTier)) return parsed.autoTier;
  throw new Error("wave-plan input must be an array or {autoTier:[]}");
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { inPath, maxWaveSize, outPath } = parseArgv(process.argv.slice(2));
    if (!inPath) throw new Error("Usage: node wave-plan.mjs <selected-issues.json> [--max-wave-size N] [--out <path>]");
    const parsed = JSON.parse(readFileSync(inPath, "utf-8"));
    const issues = extractWaveCandidates(parsed);
    const plan = planWaves(issues, { maxWaveSize });
    const out = { waves: plan.length, total: issues.length, plan };
    if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n"); }
    process.stdout.write(JSON.stringify({ waves: out.waves, total: out.total, out: outPath }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
