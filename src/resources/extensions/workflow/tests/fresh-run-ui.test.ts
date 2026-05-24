// Project/App: LOOP24
// File Purpose: Regression tests for clearing stale GSD run UI surfaces.

import test from "node:test";
import assert from "node:assert/strict";

import {
  clearFreshWorkflowRunSurfaces,
  isFreshWorkflowWorkCommand,
} from "../fresh-run-ui.ts";

test("fresh run cleanup applies only to work-entry commands", () => {
  const workCommands = [
    "",
    "next",
    "next M006",
    "auto",
    "auto --verbose",
    "start bugfix",
    "quick fix the button",
    "do mark all complete",
    "new-milestone",
  ];
  const inspectionCommands = [
    "status",
    "logs",
    "notifications",
    "help",
    "inspect",
    "doctor",
    "verdict pass --rationale ok",
    "validate-milestone",
    "park M006",
  ];

  for (const command of workCommands) {
    assert.equal(isFreshWorkflowWorkCommand(command), true, command);
  }
  for (const command of inspectionCommands) {
    assert.equal(isFreshWorkflowWorkCommand(command), false, command);
  }
});

test("fresh run cleanup clears stale GSD widgets and statuses", () => {
  const widgets: Array<[string, unknown]> = [];
  const statuses: Array<[string, string | undefined]> = [];
  const ctx = {
    ui: {
      setWidget: (key: string, value: unknown) => widgets.push([key, value]),
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
    },
  } as any;

  clearFreshWorkflowRunSurfaces(ctx);

  assert.deepEqual(widgets, [
    ["gsd-outcome", undefined],
    ["gsd-progress", undefined],
    ["gsd-health", undefined],
  ]);
  assert.deepEqual(statuses, [
    ["gsd-step", undefined],
    ["gsd-auto", undefined],
  ]);
});
