import { test } from "node:test";
import assert from "node:assert/strict";
import { planWaves, extractWaveCandidates } from "../wave-plan.mjs";

test("single wave when all issues are file-disjoint", () => {
  const issues = [
    { number: 1, targetFiles: ["a.ts"] },
    { number: 2, targetFiles: ["b.ts"] },
    { number: 3, targetFiles: ["c.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].map((i) => i.number).sort(), [1, 2, 3]);
});

test("multi-wave when overlap exists", () => {
  const issues = [
    { number: 1, targetFiles: ["a.ts"] },
    { number: 2, targetFiles: ["a.ts", "b.ts"] }, // conflicts with 1
    { number: 3, targetFiles: ["c.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  assert.equal(plan.length, 2);
  // Wave 1: greedy picks #1 first (lowest number), then #3 (no conflict). #2 conflicts.
  assert.deepEqual(plan[0].map((i) => i.number).sort(), [1, 3]);
  assert.deepEqual(plan[1].map((i) => i.number), [2]);
});

test("respects maxWaveSize cap even when all are disjoint", () => {
  const issues = [
    { number: 1, targetFiles: ["a.ts"] },
    { number: 2, targetFiles: ["b.ts"] },
    { number: 3, targetFiles: ["c.ts"] },
    { number: 4, targetFiles: ["d.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 2 });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].length, 2);
  assert.equal(plan[1].length, 2);
});

test("stable ordering by issue number across waves", () => {
  const issues = [
    { number: 5, targetFiles: ["a.ts"] },
    { number: 3, targetFiles: ["a.ts"] },
    { number: 7, targetFiles: ["b.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  // Lowest number wins greedy slot in wave 1; #3 takes "a.ts", #7 joins disjointly.
  assert.deepEqual(plan[0].map((i) => i.number).sort(), [3, 7]);
  assert.deepEqual(plan[1].map((i) => i.number), [5]);
});

test("empty input returns empty plan", () => {
  assert.deepEqual(planWaves([], { maxWaveSize: 3 }), []);
});

test("issue with no targetFiles still gets its own wave slot (treats as fully disjoint)", () => {
  const issues = [
    { number: 1, targetFiles: [] },
    { number: 2, targetFiles: ["a.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].length, 2);
});

test("extractWaveCandidates returns flat arrays unchanged", () => {
  const arr = [{ number: 1, targetFiles: ["a.ts"] }];
  assert.equal(extractWaveCandidates(arr), arr);
});

test("extractWaveCandidates pulls autoTier from select-issues output (ignores human/needsTriage)", () => {
  const parsed = {
    autoTier: [{ number: 1, targetFiles: ["a.ts"] }],
    humanTier: [{ number: 2, targetFiles: ["b.ts"] }],
    needsTriage: [{ number: 3, targetFiles: ["c.ts"] }],
  };
  const out = extractWaveCandidates(parsed);
  assert.deepEqual(out.map((i) => i.number), [1]);
});

test("extractWaveCandidates throws on shapes that are neither", () => {
  assert.throws(() => extractWaveCandidates({}));
  assert.throws(() => extractWaveCandidates(null));
});
