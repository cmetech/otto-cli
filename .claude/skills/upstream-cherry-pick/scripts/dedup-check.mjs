#!/usr/bin/env node
/**
 * dedup-check.mjs — query target repo for an existing issue tracking a given SHA.
 *
 * CLI:   node dedup-check.mjs <targetRepo> <shaShort>
 *        Emits result JSON to stdout.
 *        Exits 1 with error JSON on stderr on failure.
 *
 * As module: `import { dedupCheck } from "./dedup-check.mjs"`
 *        Returns { existing: number | null, state: "OPEN" | "CLOSED" | null }.
 */
import { execFileSync } from "node:child_process";

// ─── Default gh runner ───────────────────────────────────────────────────────

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8" });
}

// ─── Core implementation ─────────────────────────────────────────────────────

/**
 * Query `targetRepo` for any existing issue whose body contains `sha=<shaShort>`.
 *
 * @param {object} options
 * @param {string} options.targetRepo   - e.g. "cmetech/otto-cli"
 * @param {string} options.shaShort     - 7-character SHA prefix
 * @param {Function} [options.ghRunner] - optional DI; defaults to execFileSync("gh", ...)
 * @returns {Promise<{ existing: number | null, state: "OPEN" | "CLOSED" | null }>}
 */
export async function dedupCheck({ targetRepo, shaShort, ghRunner = defaultGhRunner }) {
  let raw;
  try {
    raw = ghRunner([
      "issue", "list",
      "--repo", targetRepo,
      "--search", `sha=${shaShort} in:body`,
      "--state", "all",
      "--json", "number,state,body",
    ]);
  } catch (err) {
    throw new Error(
      `dedupCheck: gh issue list failed for repo "${targetRepo}" sha="${shaShort}": ${err.message ?? String(err)}`,
    );
  }

  let issues;
  try {
    issues = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `dedupCheck: failed to parse gh output as JSON: ${err.message ?? String(err)}\nraw output: ${raw}`,
    );
  }

  if (!Array.isArray(issues) || issues.length === 0) {
    return { existing: null, state: null };
  }

  // GitHub's full-text search tokenizes, so `sha=<short> in:body` also matches
  // issues that merely *mention* the sha in prose (e.g. "superseded by ce0e801").
  // Post-filter to the literal trailer substring so only the issue that actually
  // tracks this sha counts as a dup.
  const tracking = issues.filter((i) => (i.body ?? "").includes(`sha=${shaShort}`));
  if (tracking.length === 0) {
    return { existing: null, state: null };
  }

  const first = tracking[0];
  return {
    existing: first.number,
    state: first.state.toUpperCase(),
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const targetRepo = process.argv[2];
  const shaShort = process.argv[3];

  if (!targetRepo || !shaShort) {
    process.stderr.write(
      JSON.stringify({ error: "Usage: node dedup-check.mjs <targetRepo> <shaShort>" }) + "\n",
    );
    process.exit(1);
  }

  try {
    const result = await dedupCheck({ targetRepo, shaShort });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ error: err.message ?? String(err) }) + "\n",
    );
    process.exit(1);
  }
}
