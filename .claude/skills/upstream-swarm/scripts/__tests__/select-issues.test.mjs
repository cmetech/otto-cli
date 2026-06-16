import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionBySeverity } from "../select-issues.mjs";

const CONFIG = {
  autoMergeSeverities: ["nice-to-have-fix"],
  humanReviewSeverities: ["feature", "critical-stability"],
};

test("partitionBySeverity routes nice-to-have-fix to autoTier", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "feature", needsTriage: false },
    { number: 3, severity: "critical-stability", needsTriage: false },
  ];
  const r = partitionBySeverity(records, CONFIG);
  assert.deepEqual(r.autoTier.map((x) => x.number), [1]);
  assert.deepEqual(r.humanTier.map((x) => x.number).sort(), [2, 3]);
  assert.equal(r.needsTriage.length, 0);
});

test("partitionBySeverity moves needsTriage to its own bucket", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "nice-to-have-fix", needsTriage: true },
  ];
  const r = partitionBySeverity(records, CONFIG);
  assert.deepEqual(r.autoTier.map((x) => x.number), [1]);
  assert.deepEqual(r.needsTriage.map((x) => x.number), [2]);
});

test("partitionBySeverity routes deferred (open prerequisite) out of the tiers (#7)", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "nice-to-have-fix", needsTriage: false, deferred: true, deferredReason: "open prerequisite(s): #134" },
    { number: 3, severity: "nice-to-have-fix", needsTriage: true, deferred: true }, // deferred wins over needsTriage
  ];
  const r = partitionBySeverity(records, CONFIG);
  assert.deepEqual(r.autoTier.map((x) => x.number), [1], "only the ready issue is in a tier");
  assert.deepEqual(r.deferred.map((x) => x.number).sort(), [2, 3]);
  assert.equal(r.needsTriage.length, 0, "a deferred issue is not double-counted as needsTriage");
});

test("unknown severity falls into humanTier (fail-safe)", () => {
  const records = [{ number: 1, severity: "mystery", needsTriage: false }];
  const r = partitionBySeverity(records, CONFIG);
  assert.equal(r.autoTier.length, 0);
  assert.deepEqual(r.humanTier.map((x) => x.number), [1]);
});

test("missing severity (null) falls into humanTier", () => {
  const records = [{ number: 1, severity: null, needsTriage: false }];
  const r = partitionBySeverity(records, CONFIG);
  assert.equal(r.autoTier.length, 0);
  assert.deepEqual(r.humanTier.map((x) => x.number), [1]);
});

test("empty input returns empty buckets", () => {
  const r = partitionBySeverity([], CONFIG);
  assert.deepEqual(r, { autoTier: [], humanTier: [], needsTriage: [], deferred: [] });
});
