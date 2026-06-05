#!/usr/bin/env node
/**
 * select-issues.mjs — fetch triaged issues + partition by severity tier.
 * Wraps upstream-fix/scripts/select-issues.mjs and applies the swarm's
 * autoMergeSeverities / humanReviewSeverities config to split records.
 *
 * CLI: node select-issues.mjs --config <path> [--filter "<query>"] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectIssues as fixSelect } from "../../upstream-fix/scripts/select-issues.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = resolve(HERE, "..", "config.json");

export function loadConfig(path = DEFAULT_CONFIG) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * @param {Array<{number, severity, needsTriage}>} records
 * @param {{autoMergeSeverities:string[], humanReviewSeverities:string[]}} config
 */
export function partitionBySeverity(records, config) {
  const autoSet = new Set(config.autoMergeSeverities ?? []);
  const result = { autoTier: [], humanTier: [], needsTriage: [] };
  for (const r of records) {
    if (r.needsTriage) { result.needsTriage.push(r); continue; }
    if (r.severity && autoSet.has(r.severity)) result.autoTier.push(r);
    else result.humanTier.push(r);
  }
  return result;
}

export function selectAndPartition({ filter = {}, configPath = DEFAULT_CONFIG, repo, guidanceDir, outPath }) {
  const config = loadConfig(configPath);
  const fixResult = fixSelect({ filter, repo, guidanceDir });
  const part = partitionBySeverity(fixResult.records, config);
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ autoTier: part.autoTier, humanTier: part.humanTier, needsTriage: part.needsTriage }, null, 2) + "\n");
  }
  return { ...part, totalAuto: part.autoTier.length, totalHuman: part.humanTier.length, totalNeedsTriage: part.needsTriage.length };
}

function parseArgv(argv) {
  let configPath = DEFAULT_CONFIG, outPath = null, filter = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") configPath = argv[++i];
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--severity") filter.severity = argv[++i];
    else if (a === "--type") filter.type = argv[++i];
    else if (a === "--label") filter.label = argv[++i];
    else if (a === "--issues") filter.issues = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--all") filter.all = true;
  }
  return { filter, configPath, outPath };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { filter, configPath, outPath } = parseArgv(process.argv.slice(2));
    const r = selectAndPartition({ filter, configPath, outPath });
    process.stdout.write(JSON.stringify({ totalAuto: r.totalAuto, totalHuman: r.totalHuman, totalNeedsTriage: r.totalNeedsTriage, out: outPath }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
