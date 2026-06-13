# Upstream Pipeline Hardening — Phase 4 (Scaling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `upstream-swarm` orchestrator the scaling affordances needed to run a sustained porting campaign: (1) severity-ordered scheduling so the critical issues ship first; (2) a per-issue wall-clock timeout/circuit-breaker so a stuck fix lane can't block the swarm; (3) batched, exponentially-backed-off PR polling to cut GitHub API pressure; (4) a *real* structured abort-streak detector (today it is prose-only — no script implements it); and (5) a corrected rebase-conflict retry policy (tighten the transient classifier + require the retry to re-rebase, not blind-replay).

**Architecture:** All five items live in `upstream-swarm`. The pure `scheduler.mjs` gains an injected `now` (default `Date.now()` at the CLI boundary, explicit in tests — preserving purity/testability), a severity-rank sort on the capped selections, a per-issue active-fix timeout that emits a `quarantine-timeout` action, and a batched `poll-ci-batch` action whose membership is gated by per-issue exponential backoff. `swarm-ledger.mjs` gains the supporting issue fields (`fixStartedAt`, `lastPolledAt`, `pollNoChangeCount`) + a top-level `abortStreak`, and three new active→`quarantined` transitions. A new pure `abort-streak.mjs` computes a structured failure signature (stage + error-class + first-failing-line) and counts consecutive identical signatures against `config.json`'s `abortThreshold`. `transient-classifier.mjs` tightens the rebase-transient gate (main moved **and** our touched files disjoint from the new commits). SKILL.md wires the new actions/fields and documents the re-rebase requirement, `--issue-timeout`, and `--reset-abort-counter`; `config.json` gains the new caps.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, pure scheduler/classifier (clock + gh injected). Skill files live under `.claude/skills/` (gitignored at `.gitignore:43`; commit with `git add -f`). Editing `.claude/skills/` trips the self-modification block — obtain operator authorization at session start.

---

## Pre-flight (read before Task 1)

**Self-modification block:** every task edits `.claude/skills/`. Confirm Corey has authorized skill edits for this session before starting.

**Branch:** all work happens on `feat/upstream-hardening-phase-4` off `main`.

**Regression net (full skill suite — run after every task, must stay green; baseline 369):**

```bash
node --test \
  .claude/skills/_common/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/__tests__/*.test.mjs \
  .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs
```

**Commit convention:** Conventional Commits, scope `upstream`. End every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git add -f` for `.claude/skills/` files.

**Decisions baked in (from planning):**
- **Timeout scope = active fix states only** (`planning`/`fixing`/`retrying` = the existing `IN_FLIGHT_FIX_STATES`). `awaiting-ci` is excluded — CI is paced by ScheduleWakeup and has GitHub-side timeouts.
- **Rebase-retry = both fixes** — classifier tightening (Task 5) **and** the re-rebase requirement (documented in Task 6).
- **Adaptive polling = batch + exponential backoff** (Task 3) with per-issue ledger state and injected `now`.

**Clock purity rule:** `scheduler.mjs` stays pure — `nextActions(ledger, caps, now = null)`. The CLI entry passes `now = Date.now()`. When `now` is `null` (existing call sites/tests that don't pass it), the timeout is disabled and all `awaiting-ci` issues are treated as poll-due — so the scheduler degrades to today's behavior minus the batching shape.

## File Structure

**Create:**
- `.claude/skills/upstream-swarm/scripts/abort-streak.mjs` — structured signature + consecutive-streak counter + reset.
- `.claude/skills/upstream-swarm/scripts/__tests__/abort-streak.test.mjs`

**Modify:**
- `.claude/skills/upstream-swarm/scripts/scheduler.mjs` — severity sort, `now`, `quarantine-timeout`, `poll-ci-batch` + backoff.
- `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`
- `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs` — new issue/ledger fields + active→quarantined transitions.
- `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`
- `.claude/skills/upstream-swarm/scripts/transient-classifier.mjs` — rebase-transient disjoint-files gate.
- `.claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`
- `.claude/skills/upstream-swarm/SKILL.md` — orchestration for all five items + flags.
- `.claude/skills/upstream-swarm/config.json` — new `defaultCaps` (timeout + poll backoff).

---

### Task 1: Severity-ordered scheduling

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/scheduler.mjs` (start-fix sort :39-42, refute sort :57-60)
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`

Today the capped selections (`start-fix`, `run-refute`) sort by issue **number** only. Order by severity tier (critical-security → critical-stability → feature → nice-to-have-fix), then number within a tier. Issues carry `severity` on their ledger record. Existing tests use issues with no `severity` (all rank equally → number order preserved), so they stay green.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`:

```js
test("start-fix is ordered by severity tier, then number within a tier", () => {
  const ledger = { issues: {
    10: { state: "selected", severity: "nice-to-have-fix" },
    11: { state: "selected", severity: "critical-stability" },
    12: { state: "selected", severity: "feature" },
    13: { state: "selected", severity: "critical-security" },
    14: { state: "selected", severity: "critical-stability" },
  } };
  const actions = nextActions(ledger, { fixConcurrency: 5, prWindow: 10, refuteConcurrency: 5 });
  const order = actions.filter((a) => a.kind === "start-fix").map((a) => a.issueNumber);
  // critical-security(13) → critical-stability(11,14 by number) → feature(12) → nice(10)
  assert.deepEqual(order, [13, 11, 14, 12, 10]);
});

test("refute selection is also severity-ordered", () => {
  const ledger = { issues: {
    20: { state: "local-gate-pending", severity: "nice-to-have-fix" },
    21: { state: "local-gate-pending", severity: "critical-stability" },
  } };
  const actions = nextActions(ledger, { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 1 });
  const refutes = actions.filter((a) => a.kind === "run-refute").map((a) => a.issueNumber);
  assert.deepEqual(refutes, [21]); // critical wins the single refute slot
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`
Expected: the two new tests FAIL (current sort is number-only → `[10,11,12,13,14]` / picks `20`).

- [ ] **Step 3: Implement the severity rank + sorts**

In `.claude/skills/upstream-swarm/scripts/scheduler.mjs`, add the rank near the top (after the state Sets):

```js
// Severity tiers for scheduling priority (lower = ship first). Issues without a
// known severity sort last, then by number — preserving FIFO for untagged work.
const SEVERITY_RANK = {
  "critical-security": 0,
  "critical-stability": 1,
  "feature": 2,
  "nice-to-have-fix": 3,
};
function severityRank(sev) {
  return SEVERITY_RANK[sev] ?? 99;
}
function bySeverityThenNumber([na, a], [nb, b]) {
  return (severityRank(a.severity) - severityRank(b.severity)) || (Number(na) - Number(nb));
}
```

Replace the start-fix selection sort (`:39-42`):

```js
  const startable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "selected")
    .sort(bySeverityThenNumber)
    .slice(0, startCap);
```

Replace the refute selection sort (`:57-60`):

```js
  const refutable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "local-gate-pending")
    .sort(bySeverityThenNumber)
    .slice(0, refuteSlack);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`
Expected: PASS (new severity tests + all pre-existing, which use untagged issues → number order unchanged).

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/scheduler.mjs .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs
git commit -m "$(cat <<'EOF'
feat(upstream): severity-ordered swarm scheduling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Clock injection + per-issue timeout / circuit-breaker

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/scheduler.mjs` (`nextActions` signature + new timeout block + CLI entry)
- Modify: `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs` (issue `fixStartedAt` default; active→`quarantined` transitions)
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`, `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`

Inject `now` into the pure scheduler. For each issue in an active fix state (`planning`/`fixing`/`retrying` = `IN_FLIGHT_FIX_STATES`) whose `fixStartedAt` is older than `caps.issueTimeoutMs`, emit a `quarantine-timeout` action so the orchestrator quarantines it and frees the lane. Timeout is disabled when `now` is null, `caps.issueTimeoutMs` is falsy, or the issue has no `fixStartedAt`.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`:

```js
test("emits quarantine-timeout for an active-fix issue over the wall-clock budget", () => {
  const now = 1_000_000;
  const ledger = { issues: {
    1: { state: "fixing", fixStartedAt: now - 50_000 },   // 50s in flight
    2: { state: "planning", fixStartedAt: now - 5_000 },  // 5s in flight
  } };
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, issueTimeoutMs: 30_000 };
  const actions = nextActions(ledger, caps, now);
  const timeouts = actions.filter((a) => a.kind === "quarantine-timeout").map((a) => a.issueNumber);
  assert.deepEqual(timeouts, [1]); // only #1 exceeded 30s
});

test("no timeout when caps.issueTimeoutMs is unset or now is null", () => {
  const ledger = { issues: { 1: { state: "fixing", fixStartedAt: 1 } } };
  assert.equal(nextActions(ledger, { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 }, 9_999_999).filter((a) => a.kind === "quarantine-timeout").length, 0);
  assert.equal(nextActions(ledger, { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, issueTimeoutMs: 1 }, null).filter((a) => a.kind === "quarantine-timeout").length, 0);
});

test("awaiting-ci is NOT subject to the fix timeout", () => {
  const now = 1_000_000;
  const ledger = { issues: { 1: { state: "awaiting-ci", fixStartedAt: now - 10_000_000, prNumber: 101 } } };
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, issueTimeoutMs: 30_000 };
  assert.equal(nextActions(ledger, caps, now).filter((a) => a.kind === "quarantine-timeout").length, 0);
});
```

Append to `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`:

```js
test("VALID_TRANSITIONS allows active fix states to be quarantined on timeout", () => {
  assert.ok((VALID_TRANSITIONS["fixing"] ?? []).includes("quarantined"));
  assert.ok((VALID_TRANSITIONS["planning"] ?? []).includes("quarantined"));
  assert.ok((VALID_TRANSITIONS["retrying"] ?? []).includes("quarantined"));
});

test("initSwarmLedger seeds fixStartedAt = null on each issue", () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "swl-"));
  try {
    const path = join(dir, "led.json");
    const led = initSwarmLedger(path, { date: "2026-06-13", filter: {}, issues: [{ number: 5 }] });
    assert.equal(led.issues["5"].fixStartedAt, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

> If `swarm-ledger.test.mjs` does not already import `initSwarmLedger`, add it to the existing import from `../swarm-ledger.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`
Expected: new tests FAIL (no `quarantine-timeout`, transitions missing, `fixStartedAt` undefined).

- [ ] **Step 3: Implement — scheduler clock + timeout**

In `scheduler.mjs`, change the `nextActions` signature:

```js
export function nextActions(ledger, caps, now = null) {
```

Add a timeout block immediately AFTER the start-fix block (after the `for (const [number] of startable) ...` loop):

```js
  // 1b. Per-issue circuit-breaker: an active-fix issue over its wall-clock
  // budget is quarantined so a stuck lane cannot block the swarm. Disabled
  // when now is unknown, no budget is set, or the issue was never stamped.
  if (now != null && caps.issueTimeoutMs) {
    for (const [number, issue] of Object.entries(ledger.issues)) {
      if (!IN_FLIGHT_FIX_STATES.has(issue.state)) continue;
      if (!issue.fixStartedAt) continue;
      if (now - issue.fixStartedAt > caps.issueTimeoutMs) {
        actions.push({ kind: "quarantine-timeout", issueNumber: Number(number), reason: `issue-timeout (>${caps.issueTimeoutMs}ms in ${issue.state})` });
      }
    }
  }
```

Update the CLI entry (`:71-80`) to pass a real clock:

```js
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledger = JSON.parse(process.argv[2] ?? "{\"issues\":{}}");
    const caps = JSON.parse(process.argv[3] ?? "{\"fixConcurrency\":3,\"prWindow\":10,\"refuteConcurrency\":5}");
    process.stdout.write(JSON.stringify(nextActions(ledger, caps, Date.now()), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Implement — ledger transitions + field**

In `swarm-ledger.mjs`, extend the three active-fix transition lists in `VALID_TRANSITIONS`:

```js
  "planning": ["fixing", "skipped", "quarantined"],
  "fixing": ["fix-ok", "fix-failed", "quarantined"],
  ...
  "retrying": ["fixing", "quarantined"],
```

In `initSwarmLedger`, add `fixStartedAt: null,` to the per-issue record (next to `retryCount: 0,`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full regression net** — expected 0 fail.

- [ ] **Step 7: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/scheduler.mjs .claude/skills/upstream-swarm/scripts/swarm-ledger.mjs .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs
git commit -m "$(cat <<'EOF'
feat(upstream): per-issue timeout circuit-breaker (injected clock + quarantine-timeout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Adaptive PR polling — batch + exponential backoff

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/scheduler.mjs` (replace the per-issue `poll-ci` loop)
- Modify: `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs` (issue `lastPolledAt` / `pollNoChangeCount` defaults)
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`

Replace the N separate `poll-ci` actions with ONE `poll-ci-batch` carrying the due PRs. An `awaiting-ci` issue is "due" when `now - lastPolledAt >= interval`, where `interval = min(basePollMs * 2^max(0, noChange - shiftAfter + 1), maxPollMs)`. When `now` is null, every `awaiting-ci` issue is due (degrade gracefully). The orchestrator updates `lastPolledAt`/`pollNoChangeCount` (Task 6).

- [ ] **Step 1: Update the existing poll test + add backoff tests**

In `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`, REPLACE the existing test "polls CI for awaiting-ci issues (one poll-ci action each)" with:

```js
test("batches awaiting-ci polls into one poll-ci-batch action (no clock → all due)", () => {
  const ledger = led({ 1: "awaiting-ci", 2: "awaiting-ci" });
  const actions = nextActions(ledger, CAPS);
  const batches = actions.filter((a) => a.kind === "poll-ci-batch");
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].issueNumbers.sort((x, y) => x - y), [1, 2]);
  assert.equal(actions.filter((a) => a.kind === "poll-ci").length, 0, "no un-batched poll-ci");
});

test("backoff: a recently-polled issue with no-change history is not yet due", () => {
  const now = 1_000_000;
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, basePollMs: 60_000, maxPollMs: 480_000, pollBackoffAfter: 1 };
  const ledger = { issues: {
    1: { state: "awaiting-ci", lastPolledAt: now - 10_000, pollNoChangeCount: 3 },  // interval >> 10s → not due
    2: { state: "awaiting-ci", lastPolledAt: now - 500_000, pollNoChangeCount: 3 }, // long past cap → due
  } };
  const actions = nextActions(ledger, caps, now);
  const batch = actions.find((a) => a.kind === "poll-ci-batch");
  assert.deepEqual(batch.issueNumbers, [2]);
});

test("backoff: interval is capped at maxPollMs", () => {
  const now = 10_000_000;
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5, basePollMs: 60_000, maxPollMs: 480_000, pollBackoffAfter: 1 };
  // noChange=20 would be astronomically large uncapped; capped at 480_000.
  const ledger = { issues: {
    1: { state: "awaiting-ci", lastPolledAt: now - 480_001, pollNoChangeCount: 20 }, // just past the cap → due
    2: { state: "awaiting-ci", lastPolledAt: now - 479_000, pollNoChangeCount: 20 }, // under the cap → not due
  } };
  const batch = nextActions(ledger, caps, now).find((a) => a.kind === "poll-ci-batch");
  assert.deepEqual(batch.issueNumbers, [1]);
});

test("no poll-ci-batch action when nothing is awaiting-ci", () => {
  const actions = nextActions(led({ 1: "ci-green" }), CAPS);
  assert.equal(actions.filter((a) => a.kind === "poll-ci-batch").length, 0);
});
```

Append to `swarm-ledger.test.mjs`:

```js
test("initSwarmLedger seeds polling backoff fields", () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "swl-"));
  try {
    const path = join(dir, "led.json");
    const led = initSwarmLedger(path, { date: "d", filter: {}, issues: [{ number: 5 }] });
    assert.equal(led.issues["5"].lastPolledAt, null);
    assert.equal(led.issues["5"].pollNoChangeCount, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`
Expected: the batch/backoff tests FAIL.

- [ ] **Step 3: Implement — batched backoff poll in scheduler**

In `scheduler.mjs`, REPLACE the poll block (the `// 2. Poll CI…` loop, `:45-48`) with:

```js
  // 2. Poll CI — one batched action, gated by per-issue exponential backoff.
  const basePollMs = caps.basePollMs ?? 60_000;
  const maxPollMs = caps.maxPollMs ?? 480_000;
  const shiftAfter = caps.pollBackoffAfter ?? 1; // start doubling after K no-change polls
  const duePolls = [];
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state !== "awaiting-ci") continue;
    const noChange = issue.pollNoChangeCount ?? 0;
    const shift = Math.max(0, noChange - shiftAfter + 1);
    const interval = Math.min(basePollMs * 2 ** shift, maxPollMs);
    const due = now == null || (now - (issue.lastPolledAt ?? 0)) >= interval;
    if (due) duePolls.push(Number(number));
  }
  if (duePolls.length) actions.push({ kind: "poll-ci-batch", issueNumbers: duePolls });
```

- [ ] **Step 4: Implement — ledger fields**

In `swarm-ledger.mjs` `initSwarmLedger`, add to the per-issue record (next to `fixStartedAt: null,`):

```js
      lastPolledAt: null,
      pollNoChangeCount: 0,
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/scheduler.mjs .claude/skills/upstream-swarm/scripts/swarm-ledger.mjs .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs
git commit -m "$(cat <<'EOF'
feat(upstream): batch CI polls with per-issue exponential backoff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `abort-streak.mjs` — structured streak detector

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/abort-streak.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/abort-streak.test.mjs`
- Modify: `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs` (`abortStreak` default)

Today the abort-streak is **prose-only** in SKILL.md (no script — `config.json` even declares `abortThreshold:5` with nothing reading it). Implement it: a stable signature from `stage + error-class + first-failing-line` (normalized so line numbers/timestamps/paths don't defeat dedup), and a counter of **consecutive identical signatures** persisted on the ledger. `recordQuarantineSignature` returns `{abort}` when the streak reaches the threshold. `resetAbortStreak` (+ a `reset` CLI) backs `--reset-abort-counter`.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/abort-streak.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSignature, recordQuarantineSignature, resetAbortStreak } from "../abort-streak.mjs";

test("computeSignature is stable across line numbers, timestamps, and paths", () => {
  const a = computeSignature({ stage: "local-gate", failTail: "2026-06-13T10:00:00Z AssertionError at /Users/x/foo.ts:42:9\nexpected 1" });
  const b = computeSignature({ stage: "local-gate", failTail: "2026-06-13T11:30:05Z AssertionError at /tmp/y/foo.ts:88:1\nexpected 1" });
  assert.equal(a, b, `signatures should match: ${a} vs ${b}`);
});

test("computeSignature differs by stage and by error class", () => {
  const base = "TypeError: undefined is not a function";
  assert.notEqual(
    computeSignature({ stage: "fix", failTail: base }),
    computeSignature({ stage: "local-gate", failTail: base }),
  );
  assert.notEqual(
    computeSignature({ stage: "fix", failTail: "TypeError: x" }),
    computeSignature({ stage: "fix", failTail: "RangeError: x" }),
  );
});

test("recordQuarantineSignature counts CONSECUTIVE identical signatures and aborts at threshold", () => {
  const ledger = {};
  const sig = "local-gate|AssertionError|expected 1";
  let r;
  for (let i = 0; i < 4; i++) r = recordQuarantineSignature(ledger, sig, { threshold: 5 });
  assert.equal(r.count, 4);
  assert.equal(r.abort, false);
  r = recordQuarantineSignature(ledger, sig, { threshold: 5 });
  assert.equal(r.count, 5);
  assert.equal(r.abort, true);
});

test("a different signature resets the streak", () => {
  const ledger = {};
  recordQuarantineSignature(ledger, "a|b|c", { threshold: 3 });
  recordQuarantineSignature(ledger, "a|b|c", { threshold: 3 });
  const r = recordQuarantineSignature(ledger, "x|y|z", { threshold: 3 });
  assert.equal(r.count, 1);
  assert.equal(r.abort, false);
  assert.equal(ledger.abortStreak.signature, "x|y|z");
});

test("resetAbortStreak clears the counter", () => {
  const ledger = {};
  recordQuarantineSignature(ledger, "a|b|c", { threshold: 2 });
  resetAbortStreak(ledger);
  assert.equal(ledger.abortStreak.count, 0);
  assert.equal(ledger.abortStreak.signature, null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/abort-streak.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `.claude/skills/upstream-swarm/scripts/abort-streak.mjs`:

```js
#!/usr/bin/env node
/**
 * abort-streak.mjs — structured swarm abort detector.
 *
 * Replaces the prose-only "5 consecutive quarantines share the same failTail
 * prefix" rule with a real, normalized signature (stage + error-class +
 * first-failing-line) and a counter of CONSECUTIVE identical signatures
 * persisted on the ledger (`ledger.abortStreak = { signature, count }`). When
 * the streak reaches the threshold the swarm should stop — the same root cause
 * is recurring and burning lanes. A different signature resets the streak.
 */
import { readLedger, writeLedger } from "../../_common/scripts/base-ledger.mjs";

const INFRA_TOKENS = ["EACCES", "ENOSPC", "ETIMEDOUT", "ECONNRESET", "OOMKilled", "Killed"];

/** First non-empty line, normalized so volatile tokens don't defeat dedup. */
function firstSignificantLine(tail = "") {
  const line = String(tail).split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  return line
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\b/g, "<ts>") // ISO timestamps
    .replace(/:\d+:\d+/g, ":<n>:<n>")                       // line:col
    .replace(/\/\S+\//g, "/<path>/")                        // absolute/relative paths
    .replace(/\b0x[0-9a-f]+\b/gi, "<addr>")                 // hex addresses
    .slice(0, 200);
}

/** Coarse error class: a NamedError/Exception token, an infra token, or "generic". */
function errorClass(tail = "") {
  const named = String(tail).match(/\b([A-Z][A-Za-z]*(?:Error|Exception))\b/);
  if (named) return named[1];
  const infra = INFRA_TOKENS.find((t) => String(tail).includes(t));
  return infra ?? "generic";
}

/** Stable signature for a failure. @param {{stage, failTail?}} f */
export function computeSignature(f) {
  const stage = f?.stage ?? "unknown";
  return `${stage}|${errorClass(f?.failTail)}|${firstSignificantLine(f?.failTail)}`;
}

/**
 * Record a quarantine signature on the ledger and report whether to abort.
 * Consecutive identical signatures increment; a new one resets to 1.
 * @returns {{ abort: boolean, count: number, signature: string }}
 */
export function recordQuarantineSignature(ledger, signature, { threshold = 5 } = {}) {
  const prev = ledger.abortStreak ?? { signature: null, count: 0 };
  const count = prev.signature === signature ? prev.count + 1 : 1;
  ledger.abortStreak = { signature, count };
  return { abort: count >= threshold, count, signature };
}

/** Clear the streak (backs `--reset-abort-counter`). */
export function resetAbortStreak(ledger) {
  ledger.abortStreak = { signature: null, count: 0 };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [cmd, path] = process.argv.slice(2);
  try {
    if (cmd === "reset") {
      if (!path) throw new Error("Usage: node abort-streak.mjs reset <ledger-path>");
      const ledger = readLedger(path);
      if (!ledger) throw new Error(`ledger not found at ${path}`);
      resetAbortStreak(ledger);
      writeLedger(path, ledger);
      process.stdout.write(JSON.stringify({ ok: true, abortStreak: ledger.abortStreak }, null, 2) + "\n");
    } else if (cmd === "signature") {
      const ctx = JSON.parse(path ?? "{}");
      process.stdout.write(computeSignature(ctx) + "\n");
    } else {
      throw new Error("Usage: node abort-streak.mjs <reset <ledger>|signature '<json>'>");
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Seed the ledger field**

In `swarm-ledger.mjs` `initSwarmLedger`, add `abortStreak: { signature: null, count: 0 },` to the top-level ledger object (next to `waves: [], issues: {}`).

Add a quick assertion test — append to `swarm-ledger.test.mjs`:

```js
test("initSwarmLedger seeds an empty abortStreak", () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "swl-"));
  try {
    const path = join(dir, "led.json");
    const led = initSwarmLedger(path, { date: "d", filter: {}, issues: [] });
    assert.deepEqual(led.abortStreak, { signature: null, count: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/abort-streak.mjs .claude/skills/upstream-swarm/scripts/__tests__/abort-streak.test.mjs .claude/skills/upstream-swarm/scripts/swarm-ledger.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs
git commit -m "$(cat <<'EOF'
feat(upstream): implement structured abort-streak detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rebase-retry — tighten the transient classifier

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/transient-classifier.mjs` (`rebase` case :50-53)
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`

A rebase conflict is only worth a transient retry when `main` moved **and** our touched files are disjoint from the new commits — otherwise the conflict is in our own changes and a blind replay won't self-heal. Gate the rebase-transient on a new `touchedFilesDisjoint` flag (the caller computes it: our `targetFiles` ∩ files-changed-by-the-new-main-commits = ∅). Overlap → `real` (quarantine / manual rebase).

- [ ] **Step 1: Update the existing rebase test + add the overlap case**

In `.claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`, REPLACE the test "rebase conflict because main moved → transient" with:

```js
test("rebase conflict, main moved, touched files DISJOINT from new commits → transient", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: true, conflictMarkers: true, touchedFilesDisjoint: true });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /rebase/);
});

test("rebase conflict where our touched files OVERLAP the new commits → real (no blind retry)", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: true, conflictMarkers: true, touchedFilesDisjoint: false });
  assert.equal(r.category, "real");
  assert.match(r.reason, /touched files|manual/i);
});

test("rebase failure without main moving → real", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: false, conflictMarkers: true, touchedFilesDisjoint: true });
  assert.equal(r.category, "real");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`
Expected: the overlap/disjoint tests FAIL (current code returns transient on `mainShaChanged && conflictMarkers` alone).

- [ ] **Step 3: Implement**

In `transient-classifier.mjs`, replace the `rebase` case (`:50-53`):

```js
    case "rebase": {
      // A rebase conflict only merits a transient retry when main moved AND our
      // touched files are disjoint from the new commits — then the conflict is
      // contextual and a re-rebase onto the new tip will likely apply. If our
      // own files overlap the new commits, a blind replay won't self-heal:
      // route to `real` so it quarantines for a manual rebase.
      if (ctx.mainShaChanged && ctx.conflictMarkers && ctx.touchedFilesDisjoint) {
        return { category: "transient", reason: "rebase conflict (main moved, touched files disjoint — re-rebase)" };
      }
      if (ctx.mainShaChanged && ctx.conflictMarkers) {
        return { category: "real", reason: "rebase conflict in our touched files — manual rebase needed" };
      }
      return { category: "real", reason: "rebase failure" };
    }
```

- [ ] **Step 4: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/transient-classifier.mjs .claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs
git commit -m "$(cat <<'EOF'
fix(upstream): gate rebase-transient on disjoint touched files

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: SKILL.md orchestration + `config.json` caps (doc + config)

**Files:**
- Modify: `.claude/skills/upstream-swarm/SKILL.md` (Phase B action table + retry step + abort step + Flags)
- Modify: `.claude/skills/upstream-swarm/config.json` (`defaultCaps`)

Wire the new actions/fields into the orchestration contract and add the caps. No script logic; verify by grep + suite-green.

- [ ] **Step 1: `config.json` caps**

In `.claude/skills/upstream-swarm/config.json`, extend `defaultCaps` so the scheduler receives the timeout + backoff knobs (read existing values first; add these keys):

```json
  "defaultCaps": {
    "fixConcurrency": 3,
    "prWindow": 10,
    "refuteConcurrency": 5,
    "maxWaveSize": 3,
    "issueTimeoutMs": 1800000,
    "basePollMs": 60000,
    "maxPollMs": 480000,
    "pollBackoffAfter": 1
  },
```

(`issueTimeoutMs` default 30 min; backoff base 60s → cap 8 min. `abortThreshold` stays as-is — it now has a reader.)

- [ ] **Step 2: SKILL.md — `poll-ci` → `poll-ci-batch` in the action table**

In the Phase B action table (`:108-114`), replace the `poll-ci` row with a `poll-ci-batch` row:

```markdown
   | `poll-ci-batch` | For each PR in `issueNumbers`, run `node poll-pr-checks.mjs <prNumber>` — ONE non-blocking HTTP poll each. The scheduler has already applied per-issue exponential backoff (it only lists PRs whose backoff interval has elapsed), so do not add your own delay. On a PR's `pass` → `ci-green` (reset its `pollNoChangeCount`); on `fail` → classify, retry or quarantine; on `pending` → **no transition**, and record the no-change poll: `recordTransition(path, N, "awaiting-ci"… )` is not valid (self-loop) — instead update the issue's `lastPolledAt = <now>` and increment `pollNoChangeCount` directly on the ledger so the next tick backs off. **Never** `gh pr checks --watch`. |
```

> Implementation note for the executor: "update `lastPolledAt`/`pollNoChangeCount` directly" means a small ledger mutation, not a state transition (the state stays `awaiting-ci`). If the surrounding prose already documents a ledger-mutation helper, reference it; otherwise describe the field update plainly as above.

- [ ] **Step 3: SKILL.md — stamp `fixStartedAt` on start-fix + handle `quarantine-timeout`**

In the `start-fix` row (`:110`), append: after dispatching, the orchestrator must stamp the wall-clock so the circuit-breaker can fire:

```markdown
   | `start-fix` | Transition `selected → planning` recording `fixStartedAt: <now ms>` (the per-issue timeout clock), dispatch a subagent to run `upstream-fix --single-issue <N>`; on done record `fix-ok`/`fix-failed`. |
```

Add a new `quarantine-timeout` row to the table:

```markdown
   | `quarantine-timeout` | The issue exceeded `issueTimeoutMs` in an active fix state (stuck lane). Transition it `→ quarantined` (reason from the action), free the lane, comment the issue with the failure/timeout note, and feed the timeout into the abort-streak detector (Step 4). |
```

- [ ] **Step 4: SKILL.md — replace the prose abort-streak with the real detector**

Replace the Phase B step 4 block (`:122-126`) with:

````markdown
4. **Abort-streak detection.** On every `quarantined` event (including
   `quarantine-timeout`), compute a structured signature and record it:
   ```sh
   SIG=$(node .claude/skills/upstream-swarm/scripts/abort-streak.mjs signature \
     '{"stage":"<stage>","failTail":"<first lines of the gate log>"}')
   ```
   then call `recordQuarantineSignature(ledger, SIG, { threshold })` (threshold =
   `config.json.abortThreshold`, default 5). When it returns `{abort:true}` —
   `threshold` consecutive quarantines share the **same** root-cause signature —
   STOP: record a swarm-abort report, start no new fixes, exit non-zero. A
   *different* signature resets the streak. Recovery: resolve the root cause, then
   `node abort-streak.mjs reset <ledger>` (or `--reset-abort-counter`) and
   `--resume`.
````

- [ ] **Step 5: SKILL.md — re-rebase requirement in the retry step**

In Phase B step 3 (the failure-classify/retry block, `:116-120`), append the re-rebase requirement (Decision: both fixes):

````markdown
   The classifier needs `touchedFilesDisjoint` for `stage:"rebase"` — compute it as
   *(our `targetFiles`) ∩ (files changed by the new origin/main commits) = ∅*. A
   transient rebase retry MUST **re-fetch `origin/main` and rebase the lane onto
   the new tip** — never replay the cached patch into the same conflicting region
   (a blind replay re-hits the identical conflict). If the touched files overlap
   the new commits the classifier returns `real`; quarantine for a manual rebase.
````

- [ ] **Step 6: SKILL.md — Flags**

In the Flags section, add:

```markdown
- `--issue-timeout <ms>` (default 1800000 = 30 min). Per-issue wall-clock budget
  for active fix states (`planning`/`fixing`/`retrying`); on breach the issue is
  quarantined and its lane freed. Fed to the scheduler as `caps.issueTimeoutMs`.
- `--reset-abort-counter` — clear the abort-streak counter
  (`node abort-streak.mjs reset <ledger>`) before resuming, after a human has
  resolved the recurring root cause.
```

Also update the caps note (near the worked example, `:174-178`) to mention the swarm passes `issueTimeoutMs`/`basePollMs`/`maxPollMs`/`pollBackoffAfter` from `config.json.defaultCaps` to `scheduler.mjs`, and that the scheduler now needs `now` (the orchestrator passes the current time; the CLI uses `Date.now()`).

- [ ] **Step 7: Verify**

Run: `grep -n "poll-ci-batch\|quarantine-timeout\|fixStartedAt\|abort-streak\|reset-abort-counter\|issue-timeout\|touchedFilesDisjoint\|re-rebase\|re-fetch" .claude/skills/upstream-swarm/SKILL.md`
Expected: each new term present. Confirm `grep -n "poll-ci " .claude/skills/upstream-swarm/SKILL.md` shows no stale un-batched `poll-ci` action row remains (the action is now `poll-ci-batch`).

Confirm `config.json` parses: `node -e "JSON.parse(require('fs').readFileSync('.claude/skills/upstream-swarm/config.json','utf8'))" && echo OK`.

Run the full regression net — expected 0 fail.

- [ ] **Step 8: Commit**

```bash
git add -f .claude/skills/upstream-swarm/SKILL.md .claude/skills/upstream-swarm/config.json
git commit -m "$(cat <<'EOF'
docs(upstream-swarm): wire timeout, batched backoff polling, abort-streak, re-rebase

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Final verification + branch finalize

**Files:** none (verification only)

- [ ] **Step 1: Run the complete skill suite** (full glob from Pre-flight). Expected: 369 baseline + new Phase-4 tests, 0 fail.

- [ ] **Step 2: Grep the invariants + cross-task coherence**

Run: `grep -rn "import.*\.\./\.\./upstream-\(fix\|merge\|swarm\|cherry-pick\)/scripts" .claude/skills/*/scripts/*.mjs`
Expected: no PRODUCTION cross-skill imports (Phase 1 invariant; ignore `__tests__/` hits).

Confirm the scheduler action vocabulary is internally consistent: `grep -n "kind:" .claude/skills/upstream-swarm/scripts/scheduler.mjs` lists `start-fix`, `quarantine-timeout`, `poll-ci-batch`, `run-local-gate`, `run-refute`, `merge-pr` — and the SKILL.md action table documents each: `grep -n "poll-ci-batch\|quarantine-timeout\|start-fix\|run-local-gate\|run-refute\|merge-pr" .claude/skills/upstream-swarm/SKILL.md`.

Confirm `abortThreshold` now has a reader: `grep -rn "abortThreshold\|recordQuarantineSignature" .claude/skills/upstream-swarm/` shows both the config key and the SKILL.md invocation.

- [ ] **Step 3: Finalize the branch**

Use `superpowers:finishing-a-development-branch`. Per the established per-phase workflow (Phase 0+1 → `0cf2b583`, Phase 2 → `a9ebe2f4`, Phase 3 → `85ed40ac`, all `--no-ff` merges to `main`), merge `feat/upstream-hardening-phase-4` to `main` with `--no-ff`. Confirm with Corey if a PR is preferred instead.

- [ ] **Step 4: Update the memory file**

Update `project_upstream_pipeline_hardening.md`: mark Phase 4 DONE (commit sha, final suite count) and record the five deliverables + the decisions (active-fix-states timeout; both rebase fixes; batch + exponential backoff; injected `now`; abort-streak now implemented with `config.abortThreshold` finally having a reader). Note Phase 5 (nice-to-haves) is the last phase.

---

## Self-Review (run before execution)

**Spec coverage (§4):**
- §4.1 Severity-ordered scheduling → Task 1 (severity rank on start-fix + refute selections). ✅
- §4.2 Per-issue timeout / circuit-breaker + `--issue-timeout` → Task 2 (injected clock, `quarantine-timeout`, active→quarantined transitions) + Task 6 (flag, `fixStartedAt` stamping). Decision: active fix states only. ✅
- §4.3 Adaptive PR polling (the real gap = `scheduler.mjs:46-48` un-batched per-tick poll-ci, no backoff) → Task 3 (`poll-ci-batch` + per-issue exponential backoff). ✅
- §4.4 Structured abort-streak — **implement** (it was prose-only) with stage+error-class+first-line signature, consecutive-identical counting, `--reset-abort-counter` → Task 4 + Task 6. ✅
- §4.5 Rebase-retry policy (reclassified) — classifier mechanics + re-rebase-not-replay → Task 5 (disjoint-files gate) + Task 6 (re-rebase requirement). Decision: both. ✅

**Decisions baked:** active-fix-states timeout (Task 2); both rebase fixes (Tasks 5+6); batch + exponential backoff (Task 3); injected `now` keeps the scheduler pure.

**Placeholder scan:** every code step has full source; doc steps have exact insertion text + grep verification. No TBD/TODO.

**Type/contract consistency:** `nextActions(ledger, caps, now=null)` threads `now` through Tasks 2 & 3. New action kinds `quarantine-timeout` (`{issueNumber, reason}`) and `poll-ci-batch` (`{issueNumbers}`) are produced by the scheduler (Tasks 2/3) and consumed by the SKILL.md table (Task 6). New ledger fields `fixStartedAt`/`lastPolledAt`/`pollNoChangeCount` (issue) + `abortStreak` (ledger) are seeded in `initSwarmLedger` (Tasks 2/3/4) and read by the scheduler/abort-streak. `caps.issueTimeoutMs`/`basePollMs`/`maxPollMs`/`pollBackoffAfter` come from `config.json.defaultCaps` (Task 6) and are read by the scheduler (Tasks 2/3). `computeSignature`/`recordQuarantineSignature`/`resetAbortStreak` names match across Task 4 code, tests, and the SKILL.md invocation.

**Watch-points for the executor:**
- Tasks 1/2/3 all edit `nextActions` and Tasks 2/3/4 all edit `initSwarmLedger` — sequential subagents each build on the prior commit; re-run the full suite after each.
- Task 2/3: `swarm-ledger.test.mjs` async tests use top-level `await import(...)` inside `test(async () => …)` — keep the test callbacks `async`. If an existing helper already imports fs/os/path at the top of that file, prefer reusing it over the inline dynamic import.
- Task 3: the existing "polls CI for awaiting-ci issues (one poll-ci action each)" test is REPLACED (not added) — the action shape changed by design.
- Task 5: the existing "rebase conflict because main moved → transient" test is REPLACED — the transient now requires `touchedFilesDisjoint:true`.
- Task 6: this is the integration glue — verify the scheduler's emitted action kinds and the SKILL.md table agree exactly, and that no stale `poll-ci` (un-batched) row or prose abort-streak remains.
