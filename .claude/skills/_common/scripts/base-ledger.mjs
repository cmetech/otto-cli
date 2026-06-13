#!/usr/bin/env node
/**
 * base-ledger.mjs — shared run-state ledger primitives for the upstream-port
 * skills. Owns JSON read/write, the schema version, and state-machine
 * transition validation. Skill ledgers (upstream-fix/ledger.mjs,
 * upstream-merge/merge-ledger.mjs, upstream-swarm/swarm-ledger.mjs) build their
 * init/record helpers on top of these and re-export read/write.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;

export function readLedger(path) {
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf-8"));
  // Backfill for ledgers written before versioning existed (treat as v0).
  if (data && typeof data === "object" && data.version == null) data.version = 0;
  return data;
}

export function writeLedger(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Validate a state-machine transition against a transitions table.
 * @param {string} from current state
 * @param {string} to desired next state
 * @param {Record<string,string[]>} table allowed transitions
 * @param {string} [label] context for the error message
 * @throws if `to` is not in table[from]
 */
export function validateTransition(from, to, table, label = "") {
  const allowed = table[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`invalid transition: ${from} → ${to}${label ? ` for ${label}` : ""}`);
  }
}
