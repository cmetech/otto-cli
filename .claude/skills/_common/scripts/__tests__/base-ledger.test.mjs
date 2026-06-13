import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLedger, writeLedger, validateTransition, SCHEMA_VERSION,
} from "../base-ledger.mjs";

test("readLedger returns null for a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-"));
  try { assert.equal(readLedger(join(dir, "nope.json")), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("write then read round-trips and writes a trailing newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-"));
  try {
    const p = join(dir, "sub", "led.json");
    writeLedger(p, { version: SCHEMA_VERSION, hello: "world" });
    assert.deepEqual(readLedger(p), { version: SCHEMA_VERSION, hello: "world" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readLedger backfills version:0 for pre-versioning ledgers", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-"));
  try {
    const p = join(dir, "old.json");
    writeFileSync(p, JSON.stringify({ issues: {} }) + "\n");
    assert.equal(readLedger(p).version, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validateTransition allows a legal edge and throws on an illegal one", () => {
  const table = { a: ["b"], b: [] };
  assert.doesNotThrow(() => validateTransition("a", "b", table));
  assert.throws(() => validateTransition("a", "c", table, "issue #1"), /invalid transition: a → c for issue #1/);
});
