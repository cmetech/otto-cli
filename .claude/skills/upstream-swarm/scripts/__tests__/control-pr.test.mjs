// .claude/skills/upstream-swarm/scripts/__tests__/control-pr.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge } from "../control-pr.mjs";

const ledgerWithVerdict = (v) => ({ issues: { "5": { refute: { tally: { panelVerdict: v } } } } });

test("merge proceeds when the ledger verdict is approve", () => {
  let mergedWith = null;
  const r = merge({
    pr: 400, issue: 5, ledger: "x", refuteReason: "panel ok",
    readLedgerFn: () => ledgerWithVerdict("approve"),
    mergeFn: (opts) => { mergedWith = opts; return { merged: true, sha: "abc1234" }; },
  });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "abc1234");
  assert.equal(mergedWith.number, 400);
  assert.equal(mergedWith.auto, true);
  assert.equal(mergedWith.refuteVerdict, "approve");
});

test("merge refuses when the ledger verdict is not approve", () => {
  let called = false;
  const r = merge({
    pr: 400, issue: 5, ledger: "x",
    readLedgerFn: () => ledgerWithVerdict("refute"),
    mergeFn: () => { called = true; return { merged: true }; },
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute");
  assert.equal(called, false); // mergeFn never invoked
});

test("merge refuses when there is no recorded verdict", () => {
  const r = merge({
    pr: 400, issue: 5, ledger: "x",
    readLedgerFn: () => ({ issues: { "5": { refute: null } } }),
    mergeFn: () => ({ merged: true }),
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute");
});
