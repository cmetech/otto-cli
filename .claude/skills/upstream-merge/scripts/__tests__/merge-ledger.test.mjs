import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initMergeLedger, readLedger, recordVerdict, recordMerge, recordRefute, requeuePr } from "../merge-ledger.mjs";

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

test("initMergeLedger seeds refute = null and recordRefute persists all lenses + tally", () => {
  const dir = mkdtempSync(join(tmpdir(), "ml-refute-"));
  try {
    const path = join(dir, "led.json");
    initMergeLedger(path, { date: "2026-06-13", prs: [{ number: 9, headRef: "x" }] });
    assert.equal(readLedger(path).prs["9"].refute, null);

    const verdicts = [
      { lens: "upstream-alignment", verdict: "approve", confidence: 0.9, reason: "ok", blocking: false },
      { lens: "scope-discipline", verdict: "abstain", confidence: 0.2, reason: "n/a", blocking: false },
      { lens: "test-quality", verdict: "approve", confidence: 0.8, reason: "good", blocking: false },
      { lens: "blast-radius", verdict: "approve", confidence: 0.7, reason: "small", blocking: false },
    ];
    const tally = { panelVerdict: "approve", approves: 3, refutes: 0, abstains: 1, reason: "3 approve / 1 abstain / 0 refute" };
    recordRefute(path, 9, { panelVerdict: "approve", verdicts, tally });

    const pr = readLedger(path).prs["9"];
    assert.equal(pr.refute.panelVerdict, "approve");
    assert.equal(pr.refute.verdicts.length, 4);
    assert.equal(pr.refute.verdicts[0].confidence, 0.9);
    assert.equal(pr.refute.verdicts[0].blocking, false);
    assert.equal(pr.refute.tally.abstains, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requeuePr resets a blocked PR to queued and clears stale gate fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "ml-retry-"));
  try {
    const path = join(dir, "led.json");
    initMergeLedger(path, { date: "d", prs: [{ number: 9, headRef: "x" }] });
    recordVerdict(path, 9, { status: "blocked", checks: { pass: false }, localGate: { pass: false }, reason: "ci red" });

    const pr = requeuePr(path, 9, { reason: "manual retry" });
    assert.equal(pr.status, "queued");
    assert.equal(pr.checks, null);
    assert.equal(pr.localGate, null);
    assert.equal(pr.reason, "manual retry");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requeuePr refuses to reset an already-merged PR", () => {
  const dir = mkdtempSync(join(tmpdir(), "ml-retry2-"));
  try {
    const path = join(dir, "led.json");
    initMergeLedger(path, { date: "d", prs: [{ number: 9, headRef: "x" }] });
    recordMerge(path, 9, { status: "merged", mergeSha: "abc1234" });
    assert.throws(() => requeuePr(path, 9, { reason: "nope" }), /merged/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
