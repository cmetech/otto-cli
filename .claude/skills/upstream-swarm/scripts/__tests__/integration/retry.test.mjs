import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSwarmLedger, readLedger, recordTransition, recordRetry } from "../../swarm-ledger.mjs";
import { nextActions } from "../../scheduler.mjs";
import { classifyFailure } from "../../transient-classifier.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "swarm-int-")); }

const ISSUES = [
  { number: 1, severity: "nice-to-have-fix", conflictRisk: "none", sha: "aaa", targetFiles: ["a.ts"] },
];
const CAPS = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };

test("CI-flake → auto retry → merge", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "test", issues: ISSUES });

    let ciFlakeDone = false;
    const transitions = {
      "start-fix": (n) => { recordTransition(path, n, "planning"); recordTransition(path, n, "fixing"); recordTransition(path, n, "fix-ok", { prNumber: n + 100 }); recordTransition(path, n, "awaiting-ci"); },
      "poll-ci-batch": (n) => {
        if (!ciFlakeDone) {
          // First time: ci-red, classify as transient, retry.
          recordTransition(path, n, "ci-red");
          const c = classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: true });
          assert.equal(c.category, "transient");
          recordRetry(path, n, c.reason);
          recordTransition(path, n, "fixing");
          ciFlakeDone = true;
        } else {
          recordTransition(path, n, "ci-green");
        }
      },
      "run-local-gate": (n) => recordTransition(path, n, "local-gate-pending"),
      "run-refute": (n) => { recordTransition(path, n, "refute-pending"); recordTransition(path, n, "approved", { refute: { tally: { panelVerdict: "approve" } } }); },
      "merge-pr": (n) => recordTransition(path, n, "merged", { mergeSha: "sha1" }),
    };
    // After fixing on retry, we must transition into awaiting-ci as part of the fix lane completion.
    const fixingFollowup = (n) => { recordTransition(path, n, "fix-ok", { prNumber: n + 100 }); recordTransition(path, n, "awaiting-ci"); };
    for (let tick = 0; tick < 100; tick++) {
      const ledger = readLedger(path);
      // Drive fixing→fix-ok→awaiting-ci on the retry pass.
      for (const [num, i] of Object.entries(ledger.issues)) if (i.state === "fixing" && i.retryCount === 1) fixingFollowup(Number(num));
      const acts = nextActions(readLedger(path), CAPS);
      if (!acts.length) break;
      for (const a of acts) {
        const nums = a.kind === "poll-ci-batch" ? a.issueNumbers : [a.issueNumber];
        for (const n of nums) transitions[a.kind](n);
      }
    }
    const led = readLedger(path);
    assert.equal(led.issues["1"].state, "merged");
    assert.equal(led.issues["1"].retryCount, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("persistent CI red → retry fails → quarantine", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "test", issues: ISSUES });

    let attempts = 0;
    const transitions = {
      "start-fix": (n) => { recordTransition(path, n, "planning"); recordTransition(path, n, "fixing"); recordTransition(path, n, "fix-ok", { prNumber: n + 100 }); recordTransition(path, n, "awaiting-ci"); },
      "poll-ci-batch": (n) => {
        attempts += 1;
        recordTransition(path, n, "ci-red");
        const c = classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: false });
        if (c.category === "transient" && (readLedger(path).issues[String(n)].retryCount ?? 0) < 1) {
          recordRetry(path, n, c.reason);
          recordTransition(path, n, "fixing");
          recordTransition(path, n, "fix-ok", { prNumber: n + 100 });
          recordTransition(path, n, "awaiting-ci");
        } else {
          recordTransition(path, n, "quarantined", { reason: "persistent CI red" });
        }
      },
      "run-local-gate": () => {},
      "run-refute": () => {},
      "merge-pr": () => {},
    };
    for (let tick = 0; tick < 100; tick++) {
      const acts = nextActions(readLedger(path), CAPS);
      if (!acts.length) break;
      for (const a of acts) {
        const nums = a.kind === "poll-ci-batch" ? a.issueNumbers : [a.issueNumber];
        for (const n of nums) transitions[a.kind](n);
      }
    }
    const led = readLedger(path);
    assert.equal(led.issues["1"].state, "quarantined");
    assert.ok(attempts >= 1, "expected at least 1 CI poll");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
