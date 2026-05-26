import test from "node:test";
import assert from "node:assert/strict";

import { runPreDispatch } from "../auto/phases.ts";
import { CMD } from "../strings.ts";

test(`blocked remediation warning uses /${CMD} dispatch reassess and hides internal tool name`, async () => {
  const notifications: Array<{ message: string; level?: string }> = [];
  const desktopMessages: string[] = [];

  const ic = {
    ctx: {
      ui: {
        notify(message: string, level?: string) {
          notifications.push({ message, level });
        },
      },
    },
    pi: {},
    s: {
      basePath: "/tmp/otto-test",
      originalBasePath: "/tmp/otto-test",
      canonicalProjectRoot: "/tmp/otto-test",
      resourceVersionOnStart: "test",
      currentMilestoneId: null,
      currentUnit: null,
      milestoneMergedInPhases: false,
    },
    prefs: undefined,
    iteration: 1,
    flowId: "flow-1",
    nextSeq: () => 1,
    deps: {
      checkResourcesStale() {
        return null;
      },
      invalidateAllCaches() {},
      async preDispatchHealthGate() {
        return { proceed: true, fixesApplied: [] };
      },
      async deriveState() {
        return {
          phase: "blocked",
          activeMilestone: { id: "M005", title: "Milestone five" },
          activeSlice: null,
          activeTask: null,
          recentDecisions: [],
          blockers: [
            "Milestone M005 validation verdict is needs-remediation but all slices are complete. Add remediation slices via otto_reassess_roadmap, or run `/otto verdict pass --rationale \"...\"` to override.",
          ],
          nextAction: "Resolve M005 remediation before proceeding.",
          registry: [{ id: "M005", status: "active" }],
        };
      },
      syncCmuxSidebar() {},
      setActiveMilestoneId() {},
      getIsolationMode() {
        return "none";
      },
      captureIntegrationBranch() {},
      pruneQueueOrder() {},
      async rebuildState() {},
      reconcileMergeState() {
        return "clean";
      },
      async pauseAuto() {},
      sendDesktopNotification(_title: string, message: string) {
        desktopMessages.push(message);
      },
      logCmuxEvent() {},
      emitJournalEvent() {},
    },
  } as any;

  const result = await runPreDispatch(ic, {
    recentUnits: [],
    stuckRecoveryAttempts: 0,
    consecutiveFinalizeTimeouts: 0,
  });

  assert.deepEqual(result, { action: "break", reason: "blocked" });

  const warning = notifications.find((n) => n.level === "warning")?.message ?? "";
  assert.match(warning, new RegExp(`/${CMD} dispatch reassess`));
  assert.doesNotMatch(warning, /otto_reassess_roadmap/);

  const desktop = desktopMessages[0] ?? "";
  assert.match(desktop, new RegExp(`/${CMD} dispatch reassess`));
  assert.doesNotMatch(desktop, /otto_reassess_roadmap/);
});
