#!/usr/bin/env node
/**
 * state-read.mjs — read one upstream's entry from the state file.
 *
 * CLI:   node state-read.mjs <upstream-name> [state-file-path]
 *        Emits the entry as JSON to stdout, or {} if absent.
 *
 * As module: import { readState } from "./state-read.mjs"
 */
import { readFileSync, existsSync } from "node:fs";

const DEFAULT_STATE_PATH = ".planning/upstream-sync-state.json";

export function readState(path = DEFAULT_STATE_PATH, upstream) {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.upstreams?.[upstream] ?? {};
  } catch (err) {
    process.stderr.write(`state-read: ${err.message}\n`);
    return {};
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const upstream = process.argv[2];
  const path = process.argv[3] ?? DEFAULT_STATE_PATH;
  if (!upstream) {
    process.stderr.write(JSON.stringify({ error: "missing <upstream-name>" }) + "\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(readState(path, upstream), null, 2) + "\n");
}
