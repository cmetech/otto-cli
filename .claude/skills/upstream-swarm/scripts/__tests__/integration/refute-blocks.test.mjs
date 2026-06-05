import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSwarmLedger, readLedger, recordTransition } from "../../swarm-ledger.mjs";
import { nextActions } from "../../scheduler.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "swarm-int-")); }

const ISSUES = [
  { number: 1, severity: "nice-to-have-fix", conflictRisk: "none", sha: "aaa", targetFiles: ["a.ts"] },
  { number: 2, severity: "nice-to-have-fix", conflictRisk: "none", sha: "bbb", targetFiles: ["b.ts"] },
  { number: 3, severity: "nice-to-have-fix", conflictRisk: "none", sha: "ccc", targetFiles: ["c.ts"] },
];
const CAPS = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };

test("issue #2 refuted → quarantined; #1 and #3 merge", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "test", issues: ISSUES });

    const transitions = {
      "start-fix": (n) => { recordTransition(path, n, "planning"); recordTransition(path, n, "fixing"); recordTransition(path, n, "fix-ok", { prNumber: n + 100 }); recordTransition(path, n, "awaiting-ci"); },
      "poll-ci": (n) => recordTransition(path, n, "ci-green"),
      "run-local-gate": (n) => recordTransition(path, n, "local-gate-pending"),
      "run-refute": (n) => {
        recordTransition(path, n, "refute-pending");
        if (n === 2) {
          recordTransition(path, n, "refuted", { refute: { tally: { panelVerdict: "refute", refutes: 1, reason: "scope-discipline refuted" } } });
          recordTransition(path, n, "quarantined");
        } else {
          recordTransition(path, n, "approved", { refute: { tally: { panelVerdict: "approve" } } });
        }
      },
      "merge-pr": (n) => recordTransition(path, n, "merged", { mergeSha: `sha${n}` }),
    };
    for (let tick = 0; tick < 100; tick++) {
      const acts = nextActions(readLedger(path), CAPS);
      if (!acts.length) break;
      for (const a of acts) transitions[a.kind](a.issueNumber);
    }
    const led = readLedger(path);
    assert.equal(led.issues["1"].state, "merged");
    assert.equal(led.issues["2"].state, "quarantined");
    assert.equal(led.issues["3"].state, "merged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
