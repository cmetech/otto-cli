#!/usr/bin/env node
/**
 * parse-ledger.mjs — extract HeavyFiles + HeavyPackages from
 * docs/UPSTREAM-SYNC.md for use by score-conflict-risk.mjs.
 *
 * CLI:   node parse-ledger.mjs [path/to/UPSTREAM-SYNC.md]
 *        defaults to docs/UPSTREAM-SYNC.md relative to cwd.
 *        Emits {heavyFiles: [...], heavyPackages: [...]} JSON to stdout.
 *
 * As module: `import { parseLedger } from "./parse-ledger.mjs"`
 *        Returns {heavyFiles: Set, heavyPackages: Set, degraded: bool}.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_LEDGER_PATH = "docs/UPSTREAM-SYNC.md";

// File-heading pattern: ### `path/to/file`
const FILE_HEADING_RE = /^###\s+`([^`]+)`\s*$/;

// Divergence-table row: | `packages/foo` | **Heavy** | ... |
const TABLE_ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*\*\*(Heavy|Moderate)\*\*\s*\|/i;

export function parseLedger(path = DEFAULT_LEDGER_PATH) {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) {
    return { heavyFiles: new Set(), heavyPackages: new Set(), degraded: true };
  }
  const content = readFileSync(fullPath, "utf-8");
  const heavyFiles = new Set();
  const heavyPackages = new Set();

  for (const line of content.split("\n")) {
    const fileMatch = line.match(FILE_HEADING_RE);
    if (fileMatch) {
      heavyFiles.add(fileMatch[1]);
      continue;
    }
    const pkgMatch = line.match(TABLE_ROW_RE);
    if (pkgMatch) {
      heavyPackages.add(pkgMatch[1]);
    }
  }

  return { heavyFiles, heavyPackages, degraded: false };
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? DEFAULT_LEDGER_PATH;
  const { heavyFiles, heavyPackages, degraded } = parseLedger(path);
  process.stdout.write(
    JSON.stringify(
      {
        heavyFiles: [...heavyFiles].sort(),
        heavyPackages: [...heavyPackages].sort(),
        degraded,
      },
      null,
      2,
    ) + "\n",
  );
}
