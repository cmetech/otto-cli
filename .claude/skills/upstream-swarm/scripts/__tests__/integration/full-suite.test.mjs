import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initSwarmLedger, readLedger, recordTransition, recordRetry, VALID_TRANSITIONS } from "../../swarm-ledger.mjs";
import { planWaves } from "../../wave-plan.mjs";
import { classifyFailure } from "../../transient-classifier.mjs";
import { partitionBySeverity } from "../../select-issues.mjs";
import { runBaselineGate } from "../../baseline-gate.mjs";
import { nextActions } from "../../scheduler.mjs";
import { renderReport } from "../../write-report.mjs";
import { LENS_NAMES, tallyVerdicts, formatRefuteComment } from "../../../../upstream-merge/scripts/refute-panel.mjs";
import { singleIssueBranch, singleIssuePrTitle } from "../../../../upstream-fix/scripts/single-issue-mode.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "swarm-smoke-")); }

test("all public entry points are importable and minimally responsive", () => {
  const dir = tmp();
  try {
    const path = join(dir, "s.json");
    initSwarmLedger(path, { date: "x", filter: "y", issues: [{ number: 1, severity: "nice-to-have-fix", sha: "a", targetFiles: ["a.ts"] }] });
    assert.equal(readLedger(path).issues["1"].state, "selected");

    assert.deepEqual(planWaves([{ number: 1, targetFiles: ["a.ts"] }], { maxWaveSize: 3 })[0][0].number, 1);
    assert.equal(classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: true }).category, "transient");

    const p = partitionBySeverity([{ number: 1, severity: "nice-to-have-fix", needsTriage: false }], { autoMergeSeverities: ["nice-to-have-fix"], humanReviewSeverities: ["feature"] });
    assert.equal(p.autoTier.length, 1);

    const baseline = runBaselineGate({ workdir: dir, logPath: join(dir, "b.log"), registryPath: join(dir, "registry.json"), provisionDeps: () => {}, worktreeRunner: () => ({ status: 0 }), gateRunner: () => ({ pass: true, failTail: "" }) });
    assert.equal(baseline.pass, true);

    assert.deepEqual(nextActions(readLedger(path), { fixConcurrency: 1, prWindow: 10, refuteConcurrency: 5 }), [{ kind: "start-fix", issueNumber: 1 }]);

    assert.deepEqual(LENS_NAMES, ["upstream-alignment", "scope-discipline", "test-quality", "blast-radius"]);
    assert.equal(tallyVerdicts([{ lens: "x", verdict: "approve" }, { lens: "y", verdict: "approve" }, { lens: "z", verdict: "abstain" }, { lens: "w", verdict: "abstain" }]).panelVerdict, "approve");
    assert.match(formatRefuteComment([{ lens: "x", verdict: "refute", reason: "y" }], { runId: "r" }), /Refute panel/);

    assert.equal(singleIssueBranch(1, "abc"), "fix/upstream-issue-1-abc");
    assert.match(singleIssuePrTitle({ number: 1, subject: "fix it" }), /closes #1/);

    assert.ok(VALID_TRANSITIONS["merged"].length === 0); // merged is terminal
    assert.match(renderReport({ date: "x", filter: "y", issues: {} }), /Merged.*0/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
