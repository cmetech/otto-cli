#!/usr/bin/env node
/**
 * state-write.mjs — atomically update one upstream's entry in the state file.
 *
 * CLI:   echo '{"lastAnalyzedCommit":"abc"}' | node state-write.mjs <upstream> [path]
 *
 * As module: import { writeState } from "./state-write.mjs"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_STATE_PATH = ".planning/upstream-sync-state.json";

export function writeState(path = DEFAULT_STATE_PATH, upstream, entry) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf-8"))
    : { version: 1, upstreams: {} };
  data.version ??= 1;
  data.upstreams ??= {};
  data.upstreams[upstream] = { ...(data.upstreams[upstream] ?? {}), ...entry };
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const upstream = process.argv[2];
  const path = process.argv[3] ?? DEFAULT_STATE_PATH;
  if (!upstream) {
    process.stderr.write(JSON.stringify({ error: "missing <upstream-name>" }) + "\n");
    process.exit(1);
  }
  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const entry = JSON.parse(stdin);
      writeState(path, upstream, entry);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
      process.exit(1);
    }
  });
}
