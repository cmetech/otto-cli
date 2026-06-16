// .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record, retry } from "../control-ledger.mjs";
import { readLedger } from "../swarm-ledger.mjs";
import { classify, abortCheck } from "../control-ledger.mjs";
import { writeLedger } from "../swarm-ledger.mjs";

function tmpLedger() {
  const dir = mkdtempSync(join(tmpdir(), "ctl-led-"));
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify({
    version: 1, date: "d", filter: "f", abortStreak: { signature: null, count: 0 },
    issues: { "5": { state: "fixing", severity: "nice-to-have-fix", retryCount: 0, targetFiles: [], prNumber: null, refute: null } },
  }));
  return path;
}

test("record applies a valid transition with payload", () => {
  const path = tmpLedger();
  const issue = record({ ledger: path, issue: "5", state: "fix-ok", payload: JSON.stringify({ prNumber: 400 }) });
  assert.equal(issue.state, "fix-ok");
  assert.equal(issue.prNumber, 400);
  assert.equal(readLedger(path).issues["5"].state, "fix-ok");
});

function tmpLedgerInState(state) {
  const dir = mkdtempSync(join(tmpdir(), "ctl-led-"));
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify({
    version: 1, date: "d", filter: "f", abortStreak: { signature: null, count: 0 },
    issues: { "5": { state, severity: "nice-to-have-fix", retryCount: 0, targetFiles: [], prNumber: null, refute: null, fixStartedAt: null } },
  }));
  return path;
}

test("record stamps fixStartedAt from --now when transitioning to fixing (so the timeout breaker has a clock)", () => {
  const path = tmpLedgerInState("planning");
  const issue = record({ ledger: path, issue: "5", state: "fixing", now: 1234 });
  assert.equal(issue.state, "fixing");
  assert.equal(issue.fixStartedAt, 1234);
  assert.equal(readLedger(path).issues["5"].fixStartedAt, 1234);
});

test("record stamps a numeric fixStartedAt (Date.now) when --now is omitted", () => {
  const path = tmpLedgerInState("planning");
  const before = Date.now();
  const issue = record({ ledger: path, issue: "5", state: "fixing" });
  assert.equal(typeof issue.fixStartedAt, "number");
  assert.ok(issue.fixStartedAt >= before, "stamped with current time");
});

test("record does NOT overwrite an explicit payload.fixStartedAt, and only stamps on the fixing transition", () => {
  const path = tmpLedgerInState("planning");
  const issue = record({ ledger: path, issue: "5", state: "fixing", payload: JSON.stringify({ fixStartedAt: 999 }), now: 1234 });
  assert.equal(issue.fixStartedAt, 999, "explicit payload wins");
  // a non-fixing transition must not stamp fixStartedAt
  const path2 = tmpLedgerInState("fixing");
  const issue2 = record({ ledger: path2, issue: "5", state: "fix-ok", now: 5555 });
  assert.equal(issue2.fixStartedAt, null, "no stamp on non-fixing transitions");
});

test("record rejects an illegal transition", () => {
  const path = tmpLedger();
  assert.throws(() => record({ ledger: path, issue: "5", state: "merged" }), /invalid transition/i);
});

test("retry increments retryCount and moves to retrying", () => {
  const path = tmpLedger();
  // fixing → fix-failed first (retry is valid from fix-failed/ci-red)
  record({ ledger: path, issue: "5", state: "fix-failed", payload: JSON.stringify({ reason: "x" }) });
  const issue = retry({ ledger: path, issue: "5", reason: "transient" });
  assert.equal(issue.state, "retrying");
  assert.equal(issue.retryCount, 1);
});

test("classify returns category + signature for a local-gate real failure", () => {
  const r = classify({ stage: "local-gate", failTail: "AssertionError: nope" });
  assert.equal(r.category, "real");
  assert.match(r.signature, /^local-gate\|/);
});

test("abort-check increments the streak and reports abort at threshold", () => {
  const path = (() => {
    const dir = mkdtempSync(join(tmpdir(), "ctl-abort-"));
    const p = join(dir, "l.json");
    writeFileSync(p, JSON.stringify({ version: 1, abortStreak: { signature: null, count: 0 }, issues: {} }));
    return p;
  })();
  const sig = "local-gate|generic|x";
  let r;
  for (let i = 0; i < 3; i++) r = abortCheck({ ledger: path, signature: sig, threshold: "3" });
  assert.equal(r.count, 3);
  assert.equal(r.abort, true);
  assert.equal(readLedger(path).abortStreak.count, 3);
});
