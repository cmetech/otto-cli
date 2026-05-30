#!/usr/bin/env node
/**
 * ensure-labels.mjs — idempotently provision the §11.1 label taxonomy.
 *
 * CLI:   node ensure-labels.mjs <targetRepo>
 *        Emits result JSON to stdout.
 *        Exits 1 with error JSON on stderr on preflight failure.
 *
 * As module: `import { ensureLabels } from "./ensure-labels.mjs"`
 *        Returns { created, existing, errors }.
 */
import { execFileSync } from "node:child_process";

// ─── Canonical label taxonomy (spec §11.1) ───────────────────────────────────

const LABEL_TAXONOMY = [
  // Upstream
  { name: "upstream:pi-dev", color: "5319e7", description: "Source: earendil-works/pi" },
  { name: "upstream:gsd-pi", color: "0052cc", description: "Source: open-gsd/gsd-pi" },
  // Type
  { name: "type:cherry-pick-candidate", color: "0e8a16", description: "Mechanical cherry-pick from upstream" },
  { name: "type:port-required", color: "d93f0b", description: "Manual port required (high conflict-risk)" },
  // Severity
  { name: "severity:critical-security", color: "b60205", description: "Critical security fix" },
  { name: "severity:critical-stability", color: "d93f0b", description: "Critical stability fix (crash, data-loss, regression)" },
  { name: "severity:nice-to-have-fix", color: "fbca04", description: "Bug fix worth applying when convenient" },
  { name: "severity:feature", color: "0075ca", description: "Feature worth porting" },
  // Conflict-risk
  { name: "conflict-risk:none", color: "c2e0c6", description: "No overlap with OTTO divergence" },
  { name: "conflict-risk:low", color: "ddf4ff", description: "Touches pi-* but no HeavyFile" },
  { name: "conflict-risk:medium", color: "fff5b1", description: "Touches HeavyFile; hand-review needed" },
  { name: "conflict-risk:high", color: "f9d0c4", description: "Touches HeavyFile heavily; manual port" },
  // Status
  { name: "status:triaged", color: "ededed", description: "Filed by upstream-cherry-pick skill" },
  { name: "status:in-spec", color: "a2eeef", description: "Port spec in progress" },
  { name: "status:in-plan", color: "a2eeef", description: "Port plan in progress" },
  { name: "status:in-progress", color: "1d76db", description: "Cherry-pick or port underway" },
  { name: "status:applied", color: "5319e7", description: "Cherry-pick or port applied" },
  // Tag
  { name: "claude-pickup", color: "7057ff", description: "Opt-in for autonomous Claude handling" },
];

// Sanity check at module load time — catches taxonomy drift
if (LABEL_TAXONOMY.length !== 18) {
  throw new Error(
    `LABEL_TAXONOMY must have exactly 18 entries, found ${LABEL_TAXONOMY.length}`,
  );
}

// ─── Default gh runner ───────────────────────────────────────────────────────

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8" });
}

// ─── Core implementation ─────────────────────────────────────────────────────

/**
 * Idempotently ensures every entry in LABEL_TAXONOMY exists in `targetRepo`.
 *
 * @param {object} options
 * @param {string} options.targetRepo   - e.g. "cmetech/otto-cli"
 * @param {Function} [options.ghRunner] - optional DI; defaults to execFileSync("gh", ...)
 * @returns {Promise<{ created: string[], existing: string[], errors: { label: string, error: string }[] }>}
 */
export async function ensureLabels({ targetRepo, ghRunner = defaultGhRunner }) {
  // 1. List existing labels
  const raw = ghRunner([
    "label", "list",
    "--repo", targetRepo,
    "--json", "name",
    "--jq", ".[].name",
  ]);

  const existingSet = new Set(
    raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const created = [];
  const existing = [];
  const errors = [];

  // 2. Ensure each taxonomy entry
  for (const entry of LABEL_TAXONOMY) {
    if (existingSet.has(entry.name)) {
      existing.push(entry.name);
      continue;
    }

    try {
      ghRunner([
        "label", "create",
        entry.name,
        "--color", entry.color,
        "--description", entry.description,
        "--repo", targetRepo,
      ]);
      created.push(entry.name);
    } catch (err) {
      errors.push({
        label: entry.name,
        error: err.message ?? String(err),
      });
    }
  }

  return { created, existing, errors };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const targetRepo = process.argv[2];
  if (!targetRepo) {
    process.stderr.write(
      JSON.stringify({ error: "Usage: node ensure-labels.mjs <targetRepo>" }) + "\n",
    );
    process.exit(1);
  }

  // Preflight: verify gh is available
  try {
    execFileSync("gh", ["--version"], { encoding: "utf-8" });
  } catch {
    process.stderr.write(
      JSON.stringify({ error: "gh CLI not found or not executable" }) + "\n",
    );
    process.exit(1);
  }

  try {
    const result = await ensureLabels({ targetRepo });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ error: err.message ?? String(err) }) + "\n",
    );
    process.exit(1);
  }
}
