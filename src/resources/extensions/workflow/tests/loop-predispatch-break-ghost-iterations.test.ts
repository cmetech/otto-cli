// Project/App: OTTO
// File Purpose: Regression — a pre-dispatch break must not leave a ghost
// (start-without-end) iteration open in the workflow journal.
//
// Root cause (upstream 7145ebb / issue #349): the pre-dispatch "break" branch
// in autoLoop called finishTurn(...) then break; without finishing the open
// journal iteration. Every iteration emits "iteration-start"; on this path no
// matching "iteration-end" was emitted, leaving a dangling iteration that
// breaks downstream journal/replay tooling. The fix calls
// finishIncompleteIteration(...) before break, mirroring the other break
// branches (e.g. custom-engine-dispatch-stop, guard-break, unit-break).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { autoLoop } from "../auto/loop.js";
import { _resetPendingResolve } from "../auto/resolve.js";
import type { LoopDeps } from "../auto/loop-deps.js";
import { WorktreeStateProjection } from "../worktree-state-projection.js";
import type { SessionLockStatus } from "../session-lock.js";

function makeMockCtx() {
  return {
    ui: { notify: () => {}, setStatus: () => {} },
    model: { id: "test-model" },
  } as any;
}

function makeMockPi() {
  return {
    sendMessage: () => {},
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
  } as any;
}

function makeMockDeps(overrides?: Partial<LoopDeps>): LoopDeps & { callLog: string[] } {
  const callLog: string[] = [];
  const baseDeps: LoopDeps = {
    lockBase: () => "/tmp/test-lock",
    buildSnapshotOpts: () => ({}),
    stopAuto: async () => { callLog.push("stopAuto"); },
    pauseAuto: async () => { callLog.push("pauseAuto"); },
    clearUnitTimeout: () => {},
    updateProgressWidget: () => {},
    syncCmuxSidebar: () => {},
    logCmuxEvent: () => {},
    invalidateAllCaches: () => { callLog.push("invalidateAllCaches"); },
    deriveState: async () => {
      callLog.push("deriveState");
      return {
        phase: "executing",
        activeMilestone: { id: "M001", title: "Test Milestone", status: "active" },
        activeSlice: { id: "S01", title: "Test Slice" },
        activeTask: { id: "T01" },
        registry: [{ id: "M001", status: "active" }],
        blockers: [],
      } as any;
    },
    loadEffectiveGSDPreferences: () => ({
      preferences: { uok: { plan_v2: { enabled: false } } },
    }),
    preDispatchHealthGate: async () => ({ proceed: true, fixesApplied: [] }),
    checkResourcesStale: () => null,
    validateSessionLock: () => ({ valid: true } as SessionLockStatus),
    updateSessionLock: () => { callLog.push("updateSessionLock"); },
    handleLostSessionLock: () => { callLog.push("handleLostSessionLock"); },
    sendDesktopNotification: () => {},
    setActiveMilestoneId: () => {},
    pruneQueueOrder: () => {},
    isInAutoWorktree: () => false,
    shouldUseWorktreeIsolation: () => false,
    teardownAutoWorktree: () => {},
    createAutoWorktree: () => "/tmp/wt",
    captureIntegrationBranch: () => {},
    getIsolationMode: () => "none",
    getCurrentBranch: () => "main",
    autoWorktreeBranch: () => "auto/M001",
    resolveMilestoneFile: () => null,
    reconcileMergeState: () => "clean",
    preflightCleanRoot: () => ({ stashPushed: false, summary: "" }),
    postflightPopStash: () => ({ restored: true, needsManualRecovery: false, message: "restored" }),
    getLedger: () => null,
    getProjectTotals: () => ({ cost: 0 }),
    formatCost: (c: number) => `$${c.toFixed(2)}`,
    getBudgetAlertLevel: () => 0,
    getNewBudgetAlertLevel: () => 0,
    getBudgetEnforcementAction: () => "none",
    getManifestStatus: async () => null,
    collectSecretsFromManifest: async () => null,
    resolveDispatch: async () => {
      callLog.push("resolveDispatch");
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "M001/S01/T01",
        prompt: "do the thing",
      };
    },
    runPreDispatchHooks: () => ({ firedHooks: [], action: "proceed" }),
    getPriorSliceCompletionBlocker: () => null,
    getMainBranch: () => "main",
    closeoutUnit: async () => {},
    recordOutcome: () => {},
    writeLock: () => {},
    captureAvailableSkills: () => {},
    ensurePreconditions: () => {},
    updateSliceProgressCache: () => {},
    selectAndApplyModel: async () => ({ routing: null, appliedModel: null }),
    startUnitSupervision: () => {},
    getDeepDiagnostic: () => null,
    isDbAvailable: () => false,
    reorderForCaching: (p: string) => p,
    existsSync: (p: string) => p.endsWith(".git") || p.endsWith("package.json"),
    readFileSync: () => "",
    atomicWriteSync: () => {},
    GitServiceImpl: class {} as any,
    lifecycle: {
      enterMilestone: () => ({ ok: true, mode: "worktree", path: "/tmp/project" }),
      exitMilestone: (_mid: string, opts: { merge: boolean }) => ({
        ok: true,
        merged: opts.merge,
        codeFilesChanged: false,
      }),
    } as any,
    worktreeProjection: new WorktreeStateProjection(),
    postUnitPreVerification: async () => { callLog.push("postUnitPreVerification"); return "continue" as const; },
    runPostUnitVerification: async () => { callLog.push("runPostUnitVerification"); return "continue" as const; },
    postUnitPostVerification: async () => { callLog.push("postUnitPostVerification"); return "continue" as const; },
    getSessionFile: () => "/tmp/session.json",
    rebuildState: async () => {},
    resolveModelId: (id: string, models: any[]) => models.find((m: any) => m.id === id),
    emitJournalEvent: () => {},
  } as LoopDeps;

  return { ...baseDeps, ...overrides, callLog } as LoopDeps & { callLog: string[] };
}

function makeLoopSession(overrides?: Partial<Record<string, unknown>>) {
  return {
    active: true,
    verbose: false,
    stepMode: false,
    paused: false,
    basePath: mkdtempSync(join(tmpdir(), "gsd-loop-predispatch-")),
    originalBasePath: "",
    currentMilestoneId: "M001",
    currentUnit: null,
    currentUnitRouting: null,
    completedUnits: [],
    resourceVersionOnStart: null,
    lastPromptCharCount: undefined,
    lastBaselineCharCount: undefined,
    lastBudgetAlertLevel: 0,
    pendingVerificationRetry: null,
    pendingVerificationRetryDispatch: null,
    pendingCrashRecovery: null,
    verificationRetryFailureHashes: new Map<string, string>(),
    pendingQuickTasks: [],
    sidecarQueue: [],
    autoModeStartModel: null,
    unitDispatchCount: new Map<string, number>(),
    unitLifetimeDispatches: new Map<string, number>(),
    unitRecoveryCount: new Map<string, number>(),
    verificationRetryCount: new Map<string, number>(),
    gitService: null,
    lastRequestTimestamp: 0,
    autoStartTime: Date.now(),
    cmdCtx: {
      newSession: () => Promise.resolve({ cancelled: false }),
      getContextUsage: () => ({ percent: 10, tokens: 1000, limit: 10000 }),
    },
    clearTimers: () => {},
    ...overrides,
  } as any;
}

// Drive autoLoop down the dev (non-orchestration) path and force runPreDispatch
// to return { action: "break" } via a failing pre-dispatch health gate. The
// loop should journal a matching iteration-end so no ghost iteration remains.
test("pre-dispatch break does not leave a ghost (start-without-end) iteration open", async () => {
  _resetPendingResolve();

  const ctx = makeMockCtx();
  const pi = makeMockPi();
  const s = makeLoopSession();
  const journalEvents: Array<{ eventType: string; data?: any }> = [];

  const deps = makeMockDeps({
    // Failing health gate routes runPreDispatch -> { action: "break" }, which
    // hits the pre-dispatch break branch in autoLoop.
    preDispatchHealthGate: async () => ({
      proceed: false,
      fixesApplied: [],
      reason: "pre-dispatch health check failed",
    }),
    emitJournalEvent: (entry: any) => {
      journalEvents.push(entry);
    },
  });

  await autoLoop(ctx, pi, s, deps);

  const starts = journalEvents.filter((e) => e.eventType === "iteration-start");
  const ends = journalEvents.filter((e) => e.eventType === "iteration-end");

  assert.equal(starts.length, 1, "the pre-dispatch-break iteration should still open with iteration-start");

  // Root cause assertion: every opened iteration must be closed. Before the
  // fix, the pre-dispatch break path emitted iteration-start but never
  // iteration-end, leaving a ghost iteration.
  assert.equal(
    ends.length,
    starts.length,
    "pre-dispatch break must close the open iteration (no ghost iteration-start without iteration-end)",
  );

  const iterationStartIndex = journalEvents.findIndex((e) => e.eventType === "iteration-start");
  const iterationEndIndex = journalEvents.findIndex((e) => e.eventType === "iteration-end");
  assert.ok(iterationEndIndex > iterationStartIndex, "iteration-end must follow iteration-start");

  assert.equal(journalEvents[iterationEndIndex]!.data?.reason, "pre-dispatch-break");
  assert.equal(journalEvents[iterationEndIndex]!.data?.status, "stopped");
  assert.equal(journalEvents[iterationEndIndex]!.data?.failureClass, "manual-attention");
});
