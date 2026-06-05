import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSwarmLedger, readLedger, recordTransition } from "../../swarm-ledger.mjs";
import { nextActions } from "../../scheduler.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "swarm-int-")); }

const ISSUES = [
  { number: 1, severity: "nice-to-have-fix", conflictRisk: "none", sha: "aaa", targetFiles: ["a.ts"] },
  { number: 2, severity: "nice-to-have-fix", conflictRisk: "none", sha: "bbb", targetFiles: ["b.ts"] },
];
const CAPS = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };

test("resume completes only un-finalized issues; merged ones are not re-processed", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "test", issues: ISSUES });
    // Simulate prior run: #1 merged; #2 stopped at ci-green.
    recordTransition(path, 1, "planning");
    recordTransition(path, 1, "fixing");
    recordTransition(path, 1, "fix-ok", { prNumber: 100 });
    recordTransition(path, 1, "awaiting-ci");
    recordTransition(path, 1, "ci-green");
    recordTransition(path, 1, "local-gate-pending");
    recordTransition(path, 1, "refute-pending");
    recordTransition(path, 1, "approved", { refute: { tally: { panelVerdict: "approve" } } });
    recordTransition(path, 1, "merged", { mergeSha: "abc" });
    recordTransition(path, 2, "planning");
    recordTransition(path, 2, "fixing");
    recordTransition(path, 2, "fix-ok", { prNumber: 200 });
    recordTransition(path, 2, "awaiting-ci");
    recordTransition(path, 2, "ci-green");

    // Resume: scheduler should only produce actions for #2.
    let observedIssues = new Set();
    const transitions = {
      "start-fix": (n) => { recordTransition(path, n, "planning"); recordTransition(path, n, "fixing"); recordTransition(path, n, "fix-ok", { prNumber: n + 100 }); recordTransition(path, n, "awaiting-ci"); },
      "poll-ci": (n) => recordTransition(path, n, "ci-green"),
      "run-local-gate": (n) => recordTransition(path, n, "local-gate-pending"),
      "run-refute": (n) => { recordTransition(path, n, "refute-pending"); recordTransition(path, n, "approved", { refute: { tally: { panelVerdict: "approve" } } }); },
      "merge-pr": (n) => recordTransition(path, n, "merged", { mergeSha: `sha${n}` }),
    };
    for (let tick = 0; tick < 100; tick++) {
      const acts = nextActions(readLedger(path), CAPS);
      if (!acts.length) break;
      for (const a of acts) { observedIssues.add(a.issueNumber); transitions[a.kind](a.issueNumber); }
    }
    assert.equal(observedIssues.size, 1);
    assert.ok(observedIssues.has(2));
    const led = readLedger(path);
    assert.equal(led.issues["1"].state, "merged");
    assert.equal(led.issues["1"].mergeSha, "abc"); // NOT re-merged
    assert.equal(led.issues["2"].state, "merged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
