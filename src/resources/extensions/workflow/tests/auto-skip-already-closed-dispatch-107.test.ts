/**
 * auto-skip-already-closed-dispatch-107.test.ts — upstream #107 (sha 526ed30)
 *
 * Auto-mode stuck-loop: createWiredDispatchAdapter re-dispatched execute-task /
 * complete-slice units that had already been closed in the DB (e.g. the unit
 * completed externally after a verification retry was queued). The adapter now
 * consults the DB via getAlreadyClosedDispatchReason() and returns a skipped
 * dispatch instead of re-dispatching a finished unit.
 *
 * Two guarded paths are exercised:
 *   1. the pendingVerificationRetryDispatch replay branch, and
 *   2. the resolved-dispatch action branch.
 */

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWiredDispatchAdapter } from "../auto.ts";
import {
  closeDatabase,
  insertMilestone,
  insertSlice,
  insertTask,
  openDatabase,
} from "../db.ts";
import { RuleRegistry, setRegistry, resetRegistry } from "../rule-registry.ts";
import type { UnifiedRule } from "../rule-types.ts";
import type { WorkflowDbState } from "../types.ts";

function makeState(): WorkflowDbState {
  return {
    activeMilestone: { id: "M001", title: "Milestone" },
    activeSlice: null,
    activeTask: null,
    phase: "executing",
    recentDecisions: [],
    blockers: [],
    nextAction: "Execute task",
    registry: [],
    requirements: { active: 0, validated: 0, deferred: 0, outOfScope: 0, blocked: 0, total: 0 },
    progress: { milestones: { done: 0, total: 1 } },
  };
}

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gsd-auto-skip-closed-107-"));
  mkdirSync(join(base, ".otto/workflow", "milestones", "M001"), { recursive: true });
  writeFileSync(join(base, ".otto/workflow", "milestones", "M001", "CONTEXT.md"), "# M001\n");
  openDatabase(join(base, ".otto/workflow", "otto.db"));
  insertMilestone({ id: "M001", title: "Milestone 1", status: "active", depends_on: [] });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Slice 1", status: "complete", depends: [] });
  insertTask({ id: "T01", sliceId: "S01", milestoneId: "M001", title: "Task 1", status: "complete" });
});

afterEach(() => {
  closeDatabase();
  resetRegistry();
  rmSync(base, { recursive: true, force: true });
});

test("pendingVerificationRetryDispatch for an already-closed execute-task is skipped, not re-dispatched", async () => {
  const stateSnapshot = makeState();
  const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as any;
  const pi = { getActiveTools: () => [] } as any;
  const session = {
    basePath: base,
    pendingOrchestrationDispatch: { unitType: "execute-task", unitId: "M001/S01/T01" },
    pendingVerificationRetryDispatch: {
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "retry execute-task",
      pauseAfterUatDispatch: false,
      state: stateSnapshot,
      mid: "M001",
      midTitle: "Milestone 1",
    },
  } as any;
  const adapter = createWiredDispatchAdapter(ctx, pi, base, session);

  const result = await adapter.decideNextUnit({ stateSnapshot });

  assert.ok(result);
  assert.equal((result as { kind?: string }).kind, "skipped");
  assert.match((result as { reason: string }).reason, /already complete/);
  assert.equal(session.pendingVerificationRetryDispatch, null);
  assert.equal(session.pendingOrchestrationDispatch, null);
});

test("resolved dispatch action for an already-closed complete-slice is skipped, not re-dispatched", async () => {
  const stateSnapshot = makeState();
  const dispatchRule: UnifiedRule = {
    name: "test-dispatch-closed-slice",
    when: "dispatch",
    evaluation: "first-match",
    where: async () => ({
      action: "dispatch" as const,
      unitType: "complete-slice",
      unitId: "M001/S01",
      prompt: "complete slice",
    }),
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([dispatchRule]));

  const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as any;
  const pi = { getActiveTools: () => [] } as any;
  const session = { basePath: base, pendingOrchestrationDispatch: null } as any;
  const adapter = createWiredDispatchAdapter(ctx, pi, base, session);

  const result = await adapter.decideNextUnit({ stateSnapshot });

  assert.ok(result);
  assert.equal((result as { kind?: string }).kind, "skipped");
  assert.match((result as { reason: string }).reason, /already complete/);
  assert.equal(session.pendingOrchestrationDispatch, null);
});
