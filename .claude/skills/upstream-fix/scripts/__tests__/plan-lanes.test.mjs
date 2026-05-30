import { test } from "node:test";
import assert from "node:assert/strict";
import { planLanes } from "../plan-lanes.mjs";

const SEV = { "critical-stability": 0, "critical-security": 1, feature: 2, "nice-to-have-fix": 3 };

test("disjoint files → separate lanes", () => {
  const recs = [
    { number: 63, severity: "critical-stability", targetFiles: ["a.ts"] },
    { number: 7, severity: "feature", targetFiles: ["b.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].issues.length, 1);
});

test("shared file → one lane", () => {
  const recs = [
    { number: 1, severity: "feature", targetFiles: ["a.ts", "shared.ts"] },
    { number: 2, severity: "nice-to-have-fix", targetFiles: ["shared.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0].issues, ["1", "2"]);
  assert.deepEqual(lanes[0].files.sort(), ["a.ts", "shared.ts"]);
});

test("transitive sharing merges into one lane", () => {
  const recs = [
    { number: 1, severity: "feature", targetFiles: ["a.ts"] },
    { number: 2, severity: "feature", targetFiles: ["a.ts", "b.ts"] },
    { number: 3, severity: "feature", targetFiles: ["b.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].issues.length, 3);
});

test("within a lane, critical severity is ordered first", () => {
  const recs = [
    { number: 5, severity: "nice-to-have-fix", targetFiles: ["x.ts"] },
    { number: 6, severity: "critical-stability", targetFiles: ["x.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.deepEqual(lanes[0].issues, ["6", "5"]);
});

test("lane ids are 1-based and stable", () => {
  const recs = [
    { number: 10, severity: "feature", targetFiles: ["a.ts"] },
    { number: 20, severity: "feature", targetFiles: ["b.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.deepEqual(lanes.map((l) => l.id), [1, 2]);
});
