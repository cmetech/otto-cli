import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initMergeLedger, readLedger, recordVerdict, recordMerge } from "../merge-ledger.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "um-ledger-")); }

test("initMergeLedger seeds one queued record per PR", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    const led = initMergeLedger(path, { date: "2026-05-31", prs: [
      { number: 64, headRef: "integration/upstream-fix-2026-05-30", isDraft: false },
    ] });
    assert.equal(led.version, 1);
    assert.equal(led.prs["64"].status, "queued");
    assert.equal(led.prs["64"].headRef, "integration/upstream-fix-2026-05-30");
    assert.equal(readLedger(path).prs["64"].mergeSha, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordVerdict and recordMerge mutate and persist", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initMergeLedger(path, { date: "2026-05-31", prs: [{ number: 64, headRef: "x", isDraft: false }] });
    recordVerdict(path, 64, { status: "confirmed", checks: { pass: true }, localGate: { pass: true } });
    assert.equal(readLedger(path).prs["64"].status, "confirmed");
    assert.equal(readLedger(path).prs["64"].checks.pass, true);
    recordMerge(path, 64, { status: "merged", mergeSha: "abc1234" });
    const led = readLedger(path);
    assert.equal(led.prs["64"].status, "merged");
    assert.equal(led.prs["64"].mergeSha, "abc1234");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordVerdict throws on unknown PR", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initMergeLedger(path, { date: "2026-05-31", prs: [] });
    assert.throws(() => recordVerdict(path, 999, { status: "confirmed" }), /unknown PR/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
