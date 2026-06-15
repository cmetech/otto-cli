// Project/App: OTTO
// File Purpose: Regression for #350 — unhandled-phase warnings must retry
// dispatch once with freshly derived state before pausing, instead of pausing
// immediately on a stale/cached state snapshot.
import test from "node:test";
import assert from "node:assert/strict";

import { runDispatch } from "../auto/phases.ts";
import { AutoSession } from "../auto/session.ts";

const unhandledPhaseStop = {
  action: "stop" as const,
  reason: 'Unhandled phase "execute" — run /otto doctor to diagnose.',
  level: "warning" as const,
  matchedRule: "<no-match>",
};

function makeContext(deps: Record<string, unknown>) {
  const s = new AutoSession();
  s.basePath = "/tmp/proj";
  s.originalBasePath = "/tmp/proj";

  const ic = {
    ctx: { ui: { notify() {} }, model: undefined, modelRegistry: undefined },
    pi: { getActiveTools: () => [] },
    s,
    deps: {
      pauseAuto: async () => {},
      emitJournalEvent: () => {},
      invalidateAllCaches: () => {},
      deriveState: async () => ({}),
      ...deps,
    },
    prefs: undefined,
    iteration: 1,
    flowId: "flow-1",
    nextSeq: () => 1,
  } as any;

  // Stale snapshot: state.phase is "execute", which resolves to an
  // unhandled-phase warning on the first dispatch attempt.
  const preData = {
    state: { phase: "execute", activeMilestone: { id: "M001", title: "Milestone" } },
    mid: "M001",
    midTitle: "Milestone",
  } as any;

  const loopState = {
    recentUnits: [],
    stuckRecoveryAttempts: 0,
    consecutiveFinalizeTimeouts: 0,
  } as any;

  return { ic, preData, loopState, s };
}

test("runDispatch retries with freshly derived state when the first resolve is an unhandled-phase warning", async () => {
  const resolveCalls: Array<{ phase: string; mid: string }> = [];
  let invalidateCount = 0;
  let deriveCount = 0;
  let pauseCount = 0;

  // Fresh state derived after cache invalidation — phase has advanced so the
  // re-resolve no longer trips the unhandled-phase warning.
  const freshState = { phase: "planning", activeMilestone: { id: "M001", title: "Milestone" } };

  const { ic, preData, loopState } = makeContext({
    invalidateAllCaches: () => {
      invalidateCount++;
    },
    deriveState: async () => {
      deriveCount++;
      return freshState;
    },
    pauseAuto: async () => {
      pauseCount++;
    },
    resolveDispatch: async (dctx: any) => {
      resolveCalls.push({ phase: dctx.state.phase, mid: dctx.mid });
      // First call (stale "execute" phase) -> unhandled-phase warning.
      // Second call (fresh "planning" phase) -> a benign skip, which lets the
      // loop continue rather than pause.
      if (resolveCalls.length === 1) return unhandledPhaseStop;
      return { action: "skip" as const };
    },
  });

  const result = await runDispatch(ic, preData, loopState);

  // Root cause pinned: caches invalidated, state re-derived, and dispatch
  // re-resolved once against the FRESH state before any pause.
  assert.equal(invalidateCount, 1, "should invalidate caches before retrying");
  assert.equal(deriveCount, 1, "should re-derive fresh state on retry");
  assert.equal(resolveCalls.length, 2, "should re-resolve dispatch exactly once");
  assert.equal(resolveCalls[0].phase, "execute", "first resolve uses stale snapshot");
  assert.equal(resolveCalls[1].phase, "planning", "retry uses freshly derived state");
  assert.equal(pauseCount, 0, "must not pause when fresh state resolves cleanly");
  assert.equal(result.action, "continue", "retry that resolves to skip continues the loop");
});
