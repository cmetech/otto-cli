// the agent — Deep planning mode end-to-end dispatch chain integration test.
//
// Unit-level tests (deep-planning-mode-dispatch.test.ts) invoke each
// rule's match() in isolation and miss ordering bugs. This test exercises
// resolveDispatch with all rules loaded and verifies that, in deep mode,
// the project-level stage gates fire in the correct order — even when
// state.phase is "needs-discussion" (which previously short-circuited
// to discuss-milestone before any deep rule could run).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { resolveDispatch, type DispatchContext } from "../auto-dispatch.ts";
import type { WorkflowDbState } from "../types.ts";
import type { WorkflowPreferences } from "../preferences.ts";

function makeIsolatedBase(): string {
  const base = join(tmpdir(), `gsd-deep-integration-${randomUUID()}`);
  mkdirSync(join(base, ".otto/workflow", "milestones", "M001"), { recursive: true });
  return base;
}

function makeCtx(
  basePath: string,
  prefs: WorkflowPreferences | undefined,
  phase: WorkflowDbState["phase"] = "needs-discussion",
): DispatchContext {
  const state: WorkflowDbState = {
    phase,
    activeMilestone: { id: "M001", title: "Test" },
    activeSlice: null,
    activeTask: null,
    recentDecisions: [],
    blockers: [],
    nextAction: "",
    registry: [{ id: "M001", title: "Test", status: "active" }],
  };
  return {
    basePath,
    mid: "M001",
    midTitle: "Test",
    state,
    prefs,
    structuredQuestionsAvailable: "false",
  };
}

// PREFERENCES.md frontmatter that satisfies the workflow-preferences stage
// gate. The dispatch layer keys off the explicit `workflow_prefs_captured`
// marker, not on individual key presence — see isWorkflowPrefsCaptured.
const capturedPreferencesMd = `---
planning_depth: deep
workflow_prefs_captured: true
commit_policy: per-task
branch_model: single
uat_dispatch: true
models:
  executor_class: balanced
phases:
  skip_research: false
---
`;

const validProjectMd = [
  "# Project",
  "",
  "## What This Is",
  "",
  "A test project.",
  "",
  "## Core Value",
  "",
  "Reliable dispatch behavior.",
  "",
  "## Current State",
  "",
  "Tests are exercising deep planning.",
  "",
  "## Architecture / Key Patterns",
  "",
  "Markdown artifacts drive stage gates.",
  "",
  "## Capability Contract",
  "",
  "See `.otto/workflow/REQUIREMENTS.md`.",
  "",
  "## Milestone Sequence",
  "",
  "- [ ] M001: Test - exercise deep planning dispatch",
  "",
].join("\n");

const validRequirementsMd = [
  "# Requirements",
  "",
  "## Active",
  "",
  "### R001 - Dispatch valid artifacts",
  "- Class: core-capability",
  "- Status: active",
  "- Description: Valid artifacts allow deep-mode dispatch to advance.",
  "- Why it matters: Stage gates must not stall valid projects.",
  "- Source: test",
  "- Primary owning slice: M001/S01",
  "- Supporting slices: none",
  "- Validation: unmapped",
  "- Notes:",
  "",
  "## Validated",
  "",
  "## Deferred",
  "",
  "## Out of Scope",
  "",
  "## Traceability",
  "",
  "| ID | Class | Status | Primary owner | Supporting | Proof |",
  "|---|---|---|---|---|---|",
  "| R001 | core-capability | active | M001/S01 | none | unmapped |",
  "",
  "## Coverage Summary",
  "",
  "- Active requirements: 1",
  "",
].join("\n");

function writePreferences(base: string): void {
  writeFileSync(join(base, ".otto/workflow", "PREFERENCES.md"), capturedPreferencesMd);
}

function writeValidProject(base: string): void {
  writeFileSync(join(base, ".otto/workflow", "PROJECT.md"), validProjectMd);
}

function writeValidRequirements(base: string): void {
  writeFileSync(join(base, ".otto/workflow", "REQUIREMENTS.md"), validRequirementsMd);
}

// ─── Regression test for B1: rule ordering bug ────────────────────────────

test("integration: deep mode + needs-discussion + nothing captured → capture prefs then discuss-project", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch", `expected dispatch, got ${result.action}: ${JSON.stringify(result)}`);
  if (result.action === "dispatch") {
    assert.strictEqual(
      result.unitType,
      "discuss-project",
      "deep mode in needs-discussion must self-heal preferences before project discovery, not discuss milestone",
    );
  }
  const prefsContent = readFileSync(join(base, ".otto/workflow", "PREFERENCES.md"), "utf-8");
  assert.match(prefsContent, /^workflow_prefs_captured:\s*true\s*$/m);
  assert.ok(existsSync(join(base, ".otto/workflow", "runtime", "research-decision.json")));
});

test("integration: deep mode + pre-planning + nothing captured → capture prefs then discuss-project", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "pre-planning"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-project");
  }
  const prefsContent = readFileSync(join(base, ".otto/workflow", "PREFERENCES.md"), "utf-8");
  assert.match(prefsContent, /^workflow_prefs_captured:\s*true\s*$/m);
});

test("integration: deep mode + prefs captured + no PROJECT.md → discuss-project", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-project");
  }
});

test("integration: deep mode + invalid PROJECT.md → discuss-project, not discuss-milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeFileSync(join(base, ".otto/workflow", "PROJECT.md"), "# Project\n");

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-project");
  }
});

test("integration: deep mode + PROJECT.md + no REQUIREMENTS.md → discuss-requirements", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-requirements");
  }
});

test("integration: deep mode + invalid REQUIREMENTS.md → discuss-requirements, not discuss-milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeFileSync(join(base, ".otto/workflow", "REQUIREMENTS.md"), "# Requirements\n");

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-requirements");
  }
});

test("integration: deep mode + REQUIREMENTS.md + no research-decision → discuss-milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeValidRequirements(base);

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-milestone");
  }
  const decision = JSON.parse(readFileSync(join(base, ".otto/workflow", "runtime", "research-decision.json"), "utf-8"));
  assert.equal(decision.decision, "skip");
  assert.equal(decision.reason, "missing-default-repair");
});

test("integration: deep mode + decision=research + research files missing → research-project", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeValidRequirements(base);
  mkdirSync(join(base, ".otto/workflow", "runtime"), { recursive: true });
  writeFileSync(
    join(base, ".otto/workflow", "runtime", "research-decision.json"),
    JSON.stringify({ decision: "research", source: "research-decision" }),
  );

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "research-project");
  }
});

test("integration: deep mode + research-project marker → stop, not discuss-milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeValidRequirements(base);
  mkdirSync(join(base, ".otto/workflow", "runtime"), { recursive: true });
  writeFileSync(
    join(base, ".otto/workflow", "runtime", "research-decision.json"),
    JSON.stringify({ decision: "research", source: "research-decision" }),
  );
  writeFileSync(join(base, ".otto/workflow", "runtime", "research-project-inflight"), "{}\n");

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "stop");
  if (result.action === "stop") {
    assert.match(result.reason, /research-project-inflight/);
  }
});

test("integration: deep mode + decision=research + dimension blocker → discuss-milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeValidRequirements(base);
  mkdirSync(join(base, ".otto/workflow", "runtime"), { recursive: true });
  writeFileSync(
    join(base, ".otto/workflow", "runtime", "research-decision.json"),
    JSON.stringify({ decision: "research", source: "research-decision" }),
  );
  mkdirSync(join(base, ".otto/workflow", "research"), { recursive: true });
  for (const name of ["STACK.md", "FEATURES.md", "ARCHITECTURE.md"]) {
    writeFileSync(join(base, ".otto/workflow", "research", name), "# done\n");
  }
  writeFileSync(join(base, ".otto/workflow", "research", "PITFALLS-BLOCKER.md"), "# blocker\n");

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(
      result.unitType,
      "discuss-milestone",
      "a dimension blocker should clear the project research gate",
    );
  }
});

test("integration: deep mode + decision=skip → falls through to discuss-milestone in needs-discussion", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeValidRequirements(base);
  mkdirSync(join(base, ".otto/workflow", "runtime"), { recursive: true });
  writeFileSync(
    join(base, ".otto/workflow", "runtime", "research-decision.json"),
    JSON.stringify({ decision: "skip" }),
  );

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(
      result.unitType,
      "discuss-milestone",
      "after all deep stage gates pass and user skipped research, milestone discussion should fire",
    );
  }
});

test("integration: deep mode + decision=<garbage> repairs to skip and discusses milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  writePreferences(base);
  writeValidProject(base);
  writeValidRequirements(base);
  mkdirSync(join(base, ".otto/workflow", "runtime"), { recursive: true });
  writeFileSync(
    join(base, ".otto/workflow", "runtime", "research-decision.json"),
    JSON.stringify({ decision: "garbage" }),
  );

  const prefs = { planning_depth: "deep" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(
      result.unitType,
      "discuss-milestone",
      "malformed or unrecognized default research markers should repair to skip and advance",
    );
  }
  const decision = JSON.parse(readFileSync(join(base, ".otto/workflow", "runtime", "research-decision.json"), "utf-8"));
  assert.equal(decision.decision, "skip");
  assert.equal(decision.reason, "malformed-default-repair");
});

// ─── Light-mode regression check ──────────────────────────────────────────

test("integration: light mode (no prefs) + needs-discussion → discuss-milestone (unchanged behavior)", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  const result = await resolveDispatch(makeCtx(base, undefined, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-milestone");
  }
});

test("integration: light mode + planning_depth=light + needs-discussion → discuss-milestone", async (t) => {
  const base = makeIsolatedBase();
  t.after(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  const prefs = { planning_depth: "light" } as WorkflowPreferences;
  const result = await resolveDispatch(makeCtx(base, prefs, "needs-discussion"));
  assert.strictEqual(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.strictEqual(result.unitType, "discuss-milestone");
  }
});
