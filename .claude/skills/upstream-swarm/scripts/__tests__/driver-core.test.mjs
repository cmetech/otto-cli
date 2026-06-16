// .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDone, bucketActions } from "../driver-core.mjs";

test("isDone is true only for an empty action list", () => {
  assert.equal(isDone([]), true);
  assert.equal(isDone([{ kind: "start-fix", issueNumber: 5 }]), false);
});

test("bucketActions groups actions by kind", () => {
  const actions = [
    { kind: "start-fix", issueNumber: 5 },
    { kind: "start-fix", issueNumber: 6 },
    { kind: "poll-ci-batch", issueNumbers: [7, 8] },
    { kind: "run-local-gate", issueNumber: 9 },
    { kind: "run-refute", issueNumber: 10 },
    { kind: "merge-pr", issueNumber: 11 },
    { kind: "quarantine-timeout", issueNumber: 12, reason: "issue-timeout" },
  ];
  const b = bucketActions(actions);
  assert.deepEqual(b.startFix, [5, 6]);
  assert.deepEqual(b.pollBatch, [7, 8]);
  assert.deepEqual(b.localGate, [9]);
  assert.deepEqual(b.refute, [10]);
  assert.deepEqual(b.merge, [11]);
  assert.deepEqual(b.quarantineTimeout, [{ issueNumber: 12, reason: "issue-timeout" }]);
});

test("bucketActions ignores unknown kinds and tolerates null", () => {
  assert.deepEqual(bucketActions(null), { startFix: [], quarantineTimeout: [], pollBatch: [], localGate: [], refute: [], merge: [] });
  const b = bucketActions([{ kind: "bogus", issueNumber: 99 }, { kind: "start-fix", issueNumber: 1 }]);
  assert.deepEqual(b.startFix, [1]);
  assert.deepEqual(b.merge, []);
});

import { tickArgv, pollArgv, gateArgv, verifyFixArgv, recordArgv, mergeArgv, classifyArgv, retryArgv } from "../driver-core.mjs";
import { dispatch } from "../swarm-control.mjs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("argv builders produce the documented flags", () => {
  assert.deepEqual(gateArgv({ pr: 400, headRef: "fix/x", targets: "a.ts", logDir: "/tmp/g" }),
    ["gate", "--pr", "400", "--head-ref", "fix/x", "--targets", "a.ts", "--log-dir", "/tmp/g"]);
  assert.deepEqual(classifyArgv({ stage: "local-gate", failTail: "boom" }),
    ["classify", "--stage", "local-gate", "--fail-tail", "boom"]);
  assert.deepEqual(mergeArgv({ pr: 1, issue: 2, ledger: "l", refuteReason: "ok" }),
    ["merge", "--pr", "1", "--issue", "2", "--ledger", "l", "--refute-reason", "ok"]);
  assert.deepEqual(recordArgv({ ledger: "l", issue: 5, state: "fix-ok" }),
    ["record", "--ledger", "l", "--issue", "5", "--state", "fix-ok"]);
  assert.deepEqual(recordArgv({ ledger: "l", issue: 5, state: "fix-ok", payload: "{\"prNumber\":1}" }),
    ["record", "--ledger", "l", "--issue", "5", "--state", "fix-ok", "--payload", "{\"prNumber\":1}"]);
  assert.deepEqual(pollArgv(7), ["poll", "--pr", "7"]);
  assert.deepEqual(verifyFixArgv({ pr: 9, issue: 9, branch: "b", targets: "a.ts" }),
    ["verify-fix", "--pr", "9", "--issue", "9", "--branch", "b", "--targets", "a.ts"]);
  assert.deepEqual(retryArgv({ ledger: "l", issue: 5, reason: "transient" }),
    ["retry", "--ledger", "l", "--issue", "5", "--reason", "transient"]);
  assert.deepEqual(tickArgv({ ledger: "l", caps: "{}" }), ["tick", "--ledger", "l", "--caps", "{}"]);
  assert.deepEqual(tickArgv({ ledger: "l", caps: "{}", now: 5 }), ["tick", "--ledger", "l", "--caps", "{}", "--now", "5"]);
});

test("tickArgv round-trips through swarm-control dispatch (the CLI seam)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drv-"));
  const ledger = join(dir, "l.json");
  writeFileSync(ledger, JSON.stringify({
    version: 1, abortStreak: { signature: null, count: 0 },
    issues: { "5": { state: "selected", severity: "nice-to-have-fix", retryCount: 0, targetFiles: ["a.ts"], prNumber: null, refute: null } },
  }));
  const out = await dispatch(tickArgv({ ledger, caps: JSON.stringify({ fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 }), now: 1000 }));
  assert.ok(Array.isArray(out.actions));
  assert.equal(out.actions[0].kind, "start-fix");
  assert.equal(out.actions[0].issueNumber, 5);
});

test("recordArgv round-trips through dispatch and applies the transition", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drv-"));
  const ledger = join(dir, "l.json");
  writeFileSync(ledger, JSON.stringify({
    version: 1, abortStreak: { signature: null, count: 0 },
    issues: { "5": { state: "fixing", severity: "nice-to-have-fix", retryCount: 0, targetFiles: [], prNumber: null, refute: null } },
  }));
  const issue = await dispatch(recordArgv({ ledger, issue: 5, state: "fix-ok", payload: JSON.stringify({ prNumber: 400 }) }));
  assert.equal(issue.state, "fix-ok");
  assert.equal(issue.prNumber, 400);
});

import { fixLanePrompt, lensPrompts } from "../driver-core.mjs";
import { LENS_NAMES } from "../../../upstream-merge/scripts/refute-panel.mjs";

test("fixLanePrompt names the issue, single-issue mode, PR-open stop, and no full suite in lane", () => {
  const p = fixLanePrompt({ number: 88, sha: "494e759", targetFiles: ["a.ts", "b.ts"] });
  assert.match(p, /--single-issue 88/);
  assert.match(p, /PR-open/i);
  assert.match(p, /not run the full suite/i);
  assert.match(p, /494e759/);
  assert.match(p, /a\.ts/);
});

test("lensPrompts returns one prompt per LENS_NAME, each referencing the bundle", () => {
  const ps = lensPrompts("/tmp/bundle-88.json", { prNumber: 395, issueNumber: 88 });
  assert.equal(ps.length, LENS_NAMES.length);
  assert.deepEqual(ps.map((x) => x.lens).sort(), [...LENS_NAMES].sort());
  for (const { prompt } of ps) {
    assert.match(prompt, /\/tmp\/bundle-88\.json/);
    assert.match(prompt, /verdict/);
  }
  const alignment = ps.find((x) => x.lens === "upstream-alignment");
  assert.match(alignment.prompt, /essence-reimplement|root.cause|intent/i);
});

import { assertUnattendedAuthorized } from "../driver-core.mjs";

test("assertUnattendedAuthorized passes only with explicit pre-auth", () => {
  const r = assertUnattendedAuthorized({ unattended: true });
  assert.equal(r.authorized, true);
  assert.match(r.note, /gates .* remain the authorization/i);
  assert.throws(() => assertUnattendedAuthorized({ unattended: false }), /requires explicit --unattended/i);
  assert.throws(() => assertUnattendedAuthorized({}), /requires explicit --unattended/i);
});
