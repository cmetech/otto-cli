// Project/App: OTTO
// File Purpose: Tests for canonical process recommendations by task size.

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatRecommendedProcessPaths,
  listRecommendedProcessPaths,
  recommendProcessPath,
  type ProcessTaskSize,
} from "../process-task-path.ts";

test("process task paths cover every Phase 7 task size with one command", () => {
  const expected: ProcessTaskSize[] = [
    "hotfix",
    "bugfix",
    "small-feature",
    "large-feature",
    "architecture-change",
  ];

  const paths = listRecommendedProcessPaths();
  assert.deepEqual(paths.map((path) => path.taskSize), expected);

  for (const taskSize of expected) {
    const path = recommendProcessPath(taskSize);
    assert.equal(path.taskSize, taskSize);
    assert.ok(path.templateId.length > 0);
    assert.match(path.command, /^\/otto /);
    assert.ok(path.phases.length > 0);
    assert.ok(path.guidance.length > 0);
  }
});

test("process task paths route large work to the DB-backed milestone flow", () => {
  const largeFeature = recommendProcessPath("large-feature");
  assert.equal(largeFeature.templateId, "full-project");
  assert.match(largeFeature.command, /\/otto discuss/);
  assert.match(largeFeature.command, /\/otto auto/);
  assert.match(largeFeature.guidance, /DB-backed milestone flow/);
});

test("formatted process paths are stable for command help", () => {
  const formatted = formatRecommendedProcessPaths();
  assert.match(formatted, /hotfix\s+\/otto start hotfix/);
  assert.match(formatted, /bugfix\s+\/otto start bugfix/);
  assert.match(formatted, /small-feature\s+\/otto start small-feature/);
  assert.match(formatted, /large-feature\s+\/otto discuss/);
  assert.match(formatted, /architecture-change\s+\/otto start refactor/);
});
