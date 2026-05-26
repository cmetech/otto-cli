// Project/App: OTTO
// File Purpose: Regression tests for auto-start validation block handling.

import test from "node:test";
import assert from "node:assert/strict";

import { formatValidationBlockedMessage } from "../validation-block-guard.ts";
import type { WorkflowDbState } from "../types.ts";

function state(overrides: Partial<WorkflowDbState>): WorkflowDbState {
  return {
    activeMilestone: { id: "M001", title: "Validation Block" },
    activeSlice: null,
    activeTask: null,
    phase: "blocked",
    recentDecisions: [],
    blockers: [],
    nextAction: "Resolve validation before auto-mode.",
    registry: [],
    requirements: { active: 0, validated: 0, deferred: 0, outOfScope: 0, blocked: 0, total: 0 },
    progress: {
      milestones: { done: 0, total: 1 },
      slices: { done: 1, total: 1 },
    },
    ...overrides,
  };
}

test("auto-start guard blocks validation needs-attention states", () => {
  const message = formatValidationBlockedMessage(state({
    blockers: [
      [
        "Milestone M001 is blocked because milestone validation returned needs-attention.",
        "Fix options:",
        "1. Review the validation details: `/otto status`",
        "2. If you fixed the missing evidence or issue, re-run milestone validation: `/otto validate-milestone`",
      ].join("\n"),
    ],
  }), "auto");

  assert.ok(message, "validation block should prevent auto-start");
  assert.match(message, /\/otto auto cannot run/);
  assert.match(message, /\/otto validate-milestone/);
});

test("auto-start guard does not block non-validation blocked states", () => {
  const message = formatValidationBlockedMessage(state({
    blockers: ["No slice eligible — check dependency ordering"],
  }));

  assert.equal(message, null);
});
