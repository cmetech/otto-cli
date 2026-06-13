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

/**
 * Run the scheduler loop until no actions remain. The mock dispatcher
 * makes every action succeed and transitions the issue to the next
 * happy-path state.
 */
function runHappyPathLoop(path) {
  const happyTransitions = {
    "start-fix": (n) => { recordTransition(path, n, "planning"); recordTransition(path, n, "fixing"); recordTransition(path, n, "fix-ok", { prNumber: n + 100 }); recordTransition(path, n, "awaiting-ci"); },
    "poll-ci-batch": (n) => recordTransition(path, n, "ci-green"),
    "run-local-gate": (n) => recordTransition(path, n, "local-gate-pending"),
    "run-refute": (n) => { recordTransition(path, n, "refute-pending"); recordTransition(path, n, "approved", { refute: { tally: { panelVerdict: "approve" } } }); },
    "merge-pr": (n) => recordTransition(path, n, "merged", { mergeSha: `sha${n}` }),
  };
  // Bounded loop to detect runaway.
  for (let tick = 0; tick < 100; tick++) {
    const ledger = readLedger(path);
    const acts = nextActions(ledger, CAPS);
    if (!acts.length) return tick;
    for (const a of acts) {
      const nums = a.kind === "poll-ci-batch" ? a.issueNumbers : [a.issueNumber];
      for (const n of nums) happyTransitions[a.kind](n);
    }
  }
  throw new Error("loop did not terminate");
}

test("3 file-disjoint nice-to-have issues all reach merged", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "test", issues: ISSUES });
    const ticks = runHappyPathLoop(path);
    assert.ok(ticks > 0 && ticks < 100, `expected bounded ticks, got ${ticks}`);
    const led = readLedger(path);
    for (const n of [1, 2, 3]) {
      assert.equal(led.issues[String(n)].state, "merged", `issue #${n} not merged`);
      assert.equal(led.issues[String(n)].mergeSha, `sha${n}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
