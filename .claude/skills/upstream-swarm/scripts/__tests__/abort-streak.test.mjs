import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSignature, recordQuarantineSignature, resetAbortStreak } from "../abort-streak.mjs";

test("computeSignature is stable across line numbers, timestamps, and paths", () => {
  const a = computeSignature({ stage: "local-gate", failTail: "2026-06-13T10:00:00Z AssertionError at /Users/x/foo.ts:42:9\nexpected 1" });
  const b = computeSignature({ stage: "local-gate", failTail: "2026-06-13T11:30:05Z AssertionError at /tmp/y/foo.ts:88:1\nexpected 1" });
  assert.equal(a, b, `signatures should match: ${a} vs ${b}`);
});

test("computeSignature differs by stage and by error class", () => {
  const base = "TypeError: undefined is not a function";
  assert.notEqual(
    computeSignature({ stage: "fix", failTail: base }),
    computeSignature({ stage: "local-gate", failTail: base }),
  );
  assert.notEqual(
    computeSignature({ stage: "fix", failTail: "TypeError: x" }),
    computeSignature({ stage: "fix", failTail: "RangeError: x" }),
  );
});

test("recordQuarantineSignature counts CONSECUTIVE identical signatures and aborts at threshold", () => {
  const ledger = {};
  const sig = "local-gate|AssertionError|expected 1";
  let r;
  for (let i = 0; i < 4; i++) r = recordQuarantineSignature(ledger, sig, { threshold: 5 });
  assert.equal(r.count, 4);
  assert.equal(r.abort, false);
  r = recordQuarantineSignature(ledger, sig, { threshold: 5 });
  assert.equal(r.count, 5);
  assert.equal(r.abort, true);
});

test("a different signature resets the streak", () => {
  const ledger = {};
  recordQuarantineSignature(ledger, "a|b|c", { threshold: 3 });
  recordQuarantineSignature(ledger, "a|b|c", { threshold: 3 });
  const r = recordQuarantineSignature(ledger, "x|y|z", { threshold: 3 });
  assert.equal(r.count, 1);
  assert.equal(r.abort, false);
  assert.equal(ledger.abortStreak.signature, "x|y|z");
});

test("resetAbortStreak clears the counter", () => {
  const ledger = {};
  recordQuarantineSignature(ledger, "a|b|c", { threshold: 2 });
  resetAbortStreak(ledger);
  assert.equal(ledger.abortStreak.count, 0);
  assert.equal(ledger.abortStreak.signature, null);
});
