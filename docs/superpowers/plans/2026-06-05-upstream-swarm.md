# Upstream-Swarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `upstream-swarm` skill plus the refute-panel extension to `upstream-merge` and a `--single-issue` mode in `upstream-fix`, so the upstream-port pipeline can process 50+ triaged issues autonomously with one PR per issue and tiered auto-merge by severity.

**Architecture:** Three-skill composition. `upstream-swarm` is a thin orchestrator that selects + plans + dispatches; it invokes `upstream-fix --single-issue <N>` per issue and `upstream-merge --auto` per PR. The 4-lens refute panel lives inside `upstream-merge` as new Phase B.5. Failure policy is retry-then-quarantine; trigger is on-demand one-shot.

**Tech Stack:** Node.js ESM modules (`.mjs`), node:test for unit + integration tests, `gh` + `git` via `execFileSync`/`spawnSync`, mockable runners injected at every I/O boundary. Tests use only standard library — no test framework deps.

**Spec:** `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`

---

## Task 1: Scaffold the `upstream-swarm` skill directory

**Files:**
- Create: `.claude/skills/upstream-swarm/SKILL.md`
- Create: `.claude/skills/upstream-swarm/README.md`
- Create: `.claude/skills/upstream-swarm/config.json`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/` (empty dir)

- [ ] **Step 1: Create the skill directories**

```bash
mkdir -p .claude/skills/upstream-swarm/scripts/__tests__/integration
```

- [ ] **Step 2: Write a minimal `SKILL.md` placeholder**

This is replaced wholesale in Task 14; for now we need a file so the skill is discoverable.

```bash
cat > .claude/skills/upstream-swarm/SKILL.md <<'EOF'
---
name: upstream-swarm
description: Autonomous orchestrator for the upstream-port pipeline. Processes status:triaged issues end-to-end (cherry-pick → fix → merge) with 1 PR per issue, multi-lens refute panel, tiered severity routing, retry-then-quarantine failure policy. SCAFFOLD — final SKILL.md ships in Task 14.
---

# Upstream-Swarm (scaffold)

Placeholder. See `docs/superpowers/plans/2026-06-05-upstream-swarm.md`.
EOF
```

- [ ] **Step 3: Write `config.json` with severity-tier rules and default caps**

```bash
cat > .claude/skills/upstream-swarm/config.json <<'EOF'
{
  "autoMergeSeverities": ["nice-to-have-fix"],
  "humanReviewSeverities": ["feature", "critical-stability"],
  "defaultCaps": {
    "fixConcurrency": 3,
    "prWindow": 10,
    "refuteConcurrency": 5,
    "maxWaveSize": 3
  },
  "abortThreshold": 5
}
EOF
```

- [ ] **Step 4: Write a brief `README.md` pointer**

```bash
cat > .claude/skills/upstream-swarm/README.md <<'EOF'
# upstream-swarm

Third orchestrator above `upstream-fix` and `upstream-merge`. Processes
all triaged upstream cherry-pick candidates autonomously.

See `SKILL.md` and `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`.
EOF
```

- [ ] **Step 5: Verify the layout**

Run: `ls -R .claude/skills/upstream-swarm/`
Expected:
```
.claude/skills/upstream-swarm/:
README.md
SKILL.md
config.json
scripts

.claude/skills/upstream-swarm/scripts:
__tests__

.claude/skills/upstream-swarm/scripts/__tests__:
integration
```

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/
git commit -m "scaffold(upstream-swarm): skill directory + config + placeholder SKILL.md"
```

---

## Task 2: `swarm-ledger.mjs` — state-machine ledger

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`

The ledger is the durable source of truth. State transitions are validated
to catch bugs early. Mirrors `upstream-merge/scripts/merge-ledger.mjs`
shape.

**Valid state transitions** (defines `VALID_TRANSITIONS` in the module):

```
selected   → planning, skipped
planning   → fixing, skipped
fixing     → fix-ok, fix-failed
fix-ok     → awaiting-ci
awaiting-ci → ci-green, ci-red
ci-green   → local-gate-pending
ci-red     → retrying, quarantined
local-gate-pending → refute-pending, local-gate-failed
local-gate-failed → quarantined
refute-pending → approved, refuted, pending-human-review
approved   → merged
refuted    → quarantined
merged     → (terminal)
pending-human-review → (terminal)
quarantined → (terminal)
skipped    → selected   (re-enter on next wave)
fix-failed → retrying, quarantined
retrying   → fixing
```

- [ ] **Step 1: Write the failing test file**

Create `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initSwarmLedger,
  readLedger,
  recordTransition,
  recordRetry,
  VALID_TRANSITIONS,
} from "../swarm-ledger.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "us-ledger-")); }

const ISSUES = [
  { number: 53, severity: "nice-to-have-fix", conflictRisk: "none", sha: "baf4028", targetFiles: ["a.ts"] },
  { number: 67, severity: "feature",          conflictRisk: "none", sha: "deadbee", targetFiles: ["b.ts"] },
];

test("initSwarmLedger seeds one selected record per issue", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    const led = initSwarmLedger(path, { date: "2026-06-05", filter: "status:triaged", issues: ISSUES });
    assert.equal(led.version, 1);
    assert.equal(led.date, "2026-06-05");
    assert.equal(led.issues["53"].state, "selected");
    assert.equal(led.issues["53"].retryCount, 0);
    assert.equal(led.issues["67"].severity, "feature");
    assert.deepEqual(led.issues["53"].targetFiles, ["a.ts"]);
    assert.deepEqual(readLedger(path).issues["53"].targetFiles, ["a.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordTransition applies valid transitions and persists payload", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    recordTransition(path, 53, "planning", { wave: 1 });
    recordTransition(path, 53, "fixing");
    recordTransition(path, 53, "fix-ok", { prNumber: 74 });
    const led = readLedger(path);
    assert.equal(led.issues["53"].state, "fix-ok");
    assert.equal(led.issues["53"].wave, 1);
    assert.equal(led.issues["53"].prNumber, 74);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordTransition rejects an invalid transition", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    assert.throws(
      () => recordTransition(path, 53, "merged"),
      /invalid transition: selected → merged/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordTransition throws on unknown issue", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    assert.throws(() => recordTransition(path, 999, "planning"), /unknown issue/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordRetry increments counter and stores reason", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    recordTransition(path, 53, "planning");
    recordTransition(path, 53, "fixing");
    recordTransition(path, 53, "fix-failed", { reason: "test won't reproduce" });
    recordRetry(path, 53, "ci-flake");
    const led = readLedger(path);
    assert.equal(led.issues["53"].state, "retrying");
    assert.equal(led.issues["53"].retryCount, 1);
    assert.equal(led.issues["53"].retryReason, "ci-flake");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordRetry refuses to retry past the hard cap of 1", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initSwarmLedger(path, { date: "2026-06-05", filter: "x", issues: ISSUES });
    recordTransition(path, 53, "planning");
    recordTransition(path, 53, "fixing");
    recordTransition(path, 53, "fix-failed");
    recordRetry(path, 53, "infra");
    assert.throws(() => recordRetry(path, 53, "infra"), /retry cap exceeded/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("VALID_TRANSITIONS includes the skip→selected re-entry edge", () => {
  assert.ok((VALID_TRANSITIONS["skipped"] ?? []).includes("selected"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `swarm-ledger.mjs`**

Create `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs`:

```javascript
#!/usr/bin/env node
/**
 * swarm-ledger.mjs — durable state-machine ledger for upstream-swarm.
 * As module: import { initSwarmLedger, readLedger, recordTransition, recordRetry, VALID_TRANSITIONS } from "./swarm-ledger.mjs"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const RETRY_CAP = 1;

export const VALID_TRANSITIONS = {
  "selected": ["planning", "skipped"],
  "planning": ["fixing", "skipped"],
  "fixing": ["fix-ok", "fix-failed"],
  "fix-ok": ["awaiting-ci"],
  "awaiting-ci": ["ci-green", "ci-red"],
  "ci-green": ["local-gate-pending"],
  "ci-red": ["retrying", "quarantined"],
  "local-gate-pending": ["refute-pending", "local-gate-failed"],
  "local-gate-failed": ["quarantined"],
  "refute-pending": ["approved", "refuted", "pending-human-review"],
  "approved": ["merged"],
  "refuted": ["quarantined"],
  "merged": [],
  "pending-human-review": [],
  "quarantined": [],
  "skipped": ["selected"],
  "fix-failed": ["retrying", "quarantined"],
  "retrying": ["fixing"],
};

export function readLedger(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeLedger(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function initSwarmLedger(path, { date, filter, issues }) {
  const ledger = { version: 1, date, filter, startedAt: null, baselineGate: null, waves: [], issues: {} };
  for (const i of issues) {
    ledger.issues[String(i.number)] = {
      severity: i.severity ?? null,
      conflictRisk: i.conflictRisk ?? null,
      sha: i.sha ?? null,
      targetFiles: i.targetFiles ?? [],
      state: "selected",
      retryCount: 0,
      retryReason: null,
      wave: null,
      prNumber: null,
      prUrl: null,
      checks: null,
      localGate: null,
      refute: null,
      mergeSha: null,
      reason: null,
    };
  }
  writeLedger(path, ledger);
  return ledger;
}

function mutateIssue(path, number, fn) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const issue = ledger.issues[String(number)];
  if (!issue) throw new Error(`unknown issue #${number} in ledger`);
  fn(issue, ledger);
  writeLedger(path, ledger);
  return issue;
}

export function recordTransition(path, number, nextState, payload = {}) {
  return mutateIssue(path, number, (issue) => {
    const allowed = VALID_TRANSITIONS[issue.state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(`invalid transition: ${issue.state} → ${nextState} for issue #${number}`);
    }
    issue.state = nextState;
    for (const [k, v] of Object.entries(payload)) issue[k] = v;
  });
}

export function recordRetry(path, number, reason) {
  return mutateIssue(path, number, (issue) => {
    if (issue.retryCount >= RETRY_CAP) {
      throw new Error(`retry cap exceeded for issue #${number}`);
    }
    const allowed = VALID_TRANSITIONS[issue.state] ?? [];
    if (!allowed.includes("retrying")) {
      throw new Error(`invalid transition: ${issue.state} → retrying for issue #${number}`);
    }
    issue.state = "retrying";
    issue.retryCount += 1;
    issue.retryReason = reason;
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) { process.stderr.write(JSON.stringify({ error: "Usage: node swarm-ledger.mjs <ledger-path>" }) + "\n"); process.exit(1); }
  process.stdout.write(JSON.stringify(readLedger(path), null, 2) + "\n");
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/swarm-ledger.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs
git commit -m "feat(upstream-swarm): durable state-machine ledger (7 tests)"
```

---

## Task 3: `wave-plan.mjs` — greedy file-disjoint partitioner

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/wave-plan.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/wave-plan.test.mjs`

Greedy file-disjoint partitioning. Each wave gets the largest possible
subset of remaining issues whose `targetFiles` are pairwise disjoint,
capped at `maxWaveSize`. Stable ordering (sort by issue number) for
deterministic resume.

- [ ] **Step 1: Write the failing test file**

Create `.claude/skills/upstream-swarm/scripts/__tests__/wave-plan.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { planWaves } from "../wave-plan.mjs";

test("single wave when all issues are file-disjoint", () => {
  const issues = [
    { number: 1, targetFiles: ["a.ts"] },
    { number: 2, targetFiles: ["b.ts"] },
    { number: 3, targetFiles: ["c.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].map((i) => i.number).sort(), [1, 2, 3]);
});

test("multi-wave when overlap exists", () => {
  const issues = [
    { number: 1, targetFiles: ["a.ts"] },
    { number: 2, targetFiles: ["a.ts", "b.ts"] }, // conflicts with 1
    { number: 3, targetFiles: ["c.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  assert.equal(plan.length, 2);
  // Wave 1: greedy picks #1 first (lowest number), then #3 (no conflict). #2 conflicts.
  assert.deepEqual(plan[0].map((i) => i.number).sort(), [1, 3]);
  assert.deepEqual(plan[1].map((i) => i.number), [2]);
});

test("respects maxWaveSize cap even when all are disjoint", () => {
  const issues = [
    { number: 1, targetFiles: ["a.ts"] },
    { number: 2, targetFiles: ["b.ts"] },
    { number: 3, targetFiles: ["c.ts"] },
    { number: 4, targetFiles: ["d.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 2 });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].length, 2);
  assert.equal(plan[1].length, 2);
});

test("stable ordering by issue number across waves", () => {
  const issues = [
    { number: 5, targetFiles: ["a.ts"] },
    { number: 3, targetFiles: ["a.ts"] },
    { number: 7, targetFiles: ["b.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  // Lowest number wins greedy slot in wave 1; #3 takes "a.ts", #7 joins disjointly.
  assert.deepEqual(plan[0].map((i) => i.number).sort(), [3, 7]);
  assert.deepEqual(plan[1].map((i) => i.number), [5]);
});

test("empty input returns empty plan", () => {
  assert.deepEqual(planWaves([], { maxWaveSize: 3 }), []);
});

test("issue with no targetFiles still gets its own wave slot (treats as fully disjoint)", () => {
  const issues = [
    { number: 1, targetFiles: [] },
    { number: 2, targetFiles: ["a.ts"] },
  ];
  const plan = planWaves(issues, { maxWaveSize: 3 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].length, 2);
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/wave-plan.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `wave-plan.mjs`**

Create `.claude/skills/upstream-swarm/scripts/wave-plan.mjs`:

```javascript
#!/usr/bin/env node
/**
 * wave-plan.mjs — greedy file-disjoint partitioner for issue lists.
 * As module: import { planWaves } from "./wave-plan.mjs"
 * CLI: node wave-plan.mjs <selected-issues.json> [--max-wave-size N]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @param {Array<{number:number, targetFiles:string[]}>} issues
 * @param {{maxWaveSize:number}} opts
 * @returns {Array<Array<{number, targetFiles}>>} waves (outer = wave index)
 */
export function planWaves(issues, { maxWaveSize = 3 } = {}) {
  if (!issues.length) return [];
  const remaining = [...issues].sort((a, b) => a.number - b.number);
  const waves = [];

  while (remaining.length) {
    const wave = [];
    const usedFiles = new Set();
    for (let i = 0; i < remaining.length && wave.length < maxWaveSize; i++) {
      const issue = remaining[i];
      const files = issue.targetFiles ?? [];
      const conflicts = files.some((f) => usedFiles.has(f));
      if (conflicts) continue;
      wave.push(issue);
      for (const f of files) usedFiles.add(f);
    }
    for (const placed of wave) {
      const idx = remaining.indexOf(placed);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    if (!wave.length) {
      // Defensive: should never happen because the first remaining issue
      // is always placeable into an empty wave. Bail to avoid infinite loop.
      throw new Error("wave planner made no progress — bug");
    }
    waves.push(wave);
  }
  return waves;
}

function parseArgv(argv) {
  let inPath = null, maxWaveSize = 3, outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-wave-size") maxWaveSize = Number(argv[++i]);
    else if (argv[i] === "--out") outPath = argv[++i];
    else if (!inPath) inPath = argv[i];
  }
  return { inPath, maxWaveSize, outPath };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { inPath, maxWaveSize, outPath } = parseArgv(process.argv.slice(2));
    if (!inPath) throw new Error("Usage: node wave-plan.mjs <selected-issues.json> [--max-wave-size N] [--out <path>]");
    const issues = JSON.parse(readFileSync(inPath, "utf-8"));
    const plan = planWaves(issues, { maxWaveSize });
    const out = { waves: plan.length, total: issues.length, plan };
    if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n"); }
    process.stdout.write(JSON.stringify({ waves: out.waves, total: out.total, out: outPath }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/wave-plan.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/wave-plan.mjs .claude/skills/upstream-swarm/scripts/__tests__/wave-plan.test.mjs
git commit -m "feat(upstream-swarm): greedy file-disjoint wave planner (6 tests)"
```

---

## Task 4: `transient-classifier.mjs` — failure categorization

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/transient-classifier.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`

Categorizes a failure as `transient` (auto-retry once), `real` (quarantine),
or `abort` (swarm-level halt). The four transient signatures are detected
deterministically from the failure tail or context.

- [ ] **Step 1: Write the failing test file**

Create `.claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, INFRA_PATTERNS } from "../transient-classifier.mjs";

test("CI flake (red on first run, green on rerun) → transient", () => {
  const r = classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: true });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /ci-flake/);
});

test("CI persistent red across reruns → real", () => {
  const r = classifyFailure({ stage: "ci", firstRunRed: true, rerunGreen: false });
  assert.equal(r.category, "real");
});

test("baseline-rot signature (same failure on origin/main) → transient", () => {
  const r = classifyFailure({
    stage: "local-gate",
    failTail: "Error: missing dist-test/vendor/xlsx-0.20.3.tgz",
    baselineFailTail: "Error: missing dist-test/vendor/xlsx-0.20.3.tgz",
  });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /baseline-rot/);
});

test("local-gate failure not present on baseline → real", () => {
  const r = classifyFailure({
    stage: "local-gate",
    failTail: "AssertionError: expected 1 got 2",
    baselineFailTail: "",
  });
  assert.equal(r.category, "real");
});

test("infra signatures (EACCES, ENOSPC, OOM, network) → transient", () => {
  for (const pat of INFRA_PATTERNS) {
    const r = classifyFailure({ stage: "fix", failTail: `something\n${pat} happened\nmore` });
    assert.equal(r.category, "transient", `expected transient for pattern ${pat}`);
    assert.match(r.reason, /infra/);
  }
});

test("fix-stage reviewer rejection → real", () => {
  const r = classifyFailure({ stage: "fix-reviewer", reviewerVerdict: "reject", reviewerReason: "regression test does not pin the bug" });
  assert.equal(r.category, "real");
});

test("regression test won't reproduce → real", () => {
  const r = classifyFailure({ stage: "regression-gate", regressionPassesOnMain: true });
  assert.equal(r.category, "real");
});

test("skill-level uncaught exception → abort", () => {
  const r = classifyFailure({ stage: "swarm", thrown: new Error("undefined is not a function") });
  assert.equal(r.category, "abort");
});

test("rebase conflict because main moved → transient", () => {
  const r = classifyFailure({ stage: "rebase", mainShaChanged: true, conflictMarkers: true });
  assert.equal(r.category, "transient");
  assert.match(r.reason, /rebase/);
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transient-classifier.mjs`**

Create `.claude/skills/upstream-swarm/scripts/transient-classifier.mjs`:

```javascript
#!/usr/bin/env node
/**
 * transient-classifier.mjs — categorize a failure as transient | real | abort.
 * Pure. Inputs include stage and stage-specific evidence; output is the routing
 * decision the scheduler uses to retry, quarantine, or abort the swarm.
 */

export const INFRA_PATTERNS = [
  "EACCES",
  "ENOSPC",
  "ETIMEDOUT",
  "ECONNRESET",
  "Killed",
  "OOMKilled",
  "network error",
];

function tailHasInfraPattern(tail = "") {
  return INFRA_PATTERNS.some((p) => tail.includes(p));
}

export function classifyFailure(ctx) {
  // Skill-level abort
  if (ctx.thrown) return { category: "abort", reason: `skill threw: ${ctx.thrown.message ?? String(ctx.thrown)}` };

  switch (ctx.stage) {
    case "ci": {
      if (ctx.firstRunRed && ctx.rerunGreen) return { category: "transient", reason: "ci-flake (red→green)" };
      return { category: "real", reason: "ci persistent red" };
    }
    case "local-gate": {
      if (ctx.baselineFailTail && ctx.failTail && ctx.failTail === ctx.baselineFailTail) {
        return { category: "transient", reason: "baseline-rot (same failure on main)" };
      }
      if (tailHasInfraPattern(ctx.failTail)) return { category: "transient", reason: "infra signature in fail tail" };
      return { category: "real", reason: "local gate real failure" };
    }
    case "fix": {
      if (tailHasInfraPattern(ctx.failTail)) return { category: "transient", reason: "infra signature in fail tail" };
      return { category: "real", reason: "fix stage failure" };
    }
    case "fix-reviewer": {
      // Reviewer rejection is always a real signal; the reviewer is the gate.
      return { category: "real", reason: `fix-reviewer ${ctx.reviewerVerdict}: ${ctx.reviewerReason ?? ""}` };
    }
    case "regression-gate": {
      if (ctx.regressionPassesOnMain) return { category: "real", reason: "regression test passes on main — does not pin the bug" };
      return { category: "real", reason: "regression gate failure" };
    }
    case "rebase": {
      if (ctx.mainShaChanged && ctx.conflictMarkers) return { category: "transient", reason: "rebase conflict (main moved)" };
      return { category: "real", reason: "rebase failure" };
    }
    case "swarm": {
      return { category: "abort", reason: "swarm-level failure" };
    }
    default: {
      return { category: "real", reason: `unknown stage: ${ctx.stage}` };
    }
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ctx = JSON.parse(process.argv[2] ?? "{}");
    process.stdout.write(JSON.stringify(classifyFailure(ctx), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/transient-classifier.mjs .claude/skills/upstream-swarm/scripts/__tests__/transient-classifier.test.mjs
git commit -m "feat(upstream-swarm): failure-category classifier (9 tests)"
```

---

## Task 5: `select-issues.mjs` — swarm selector with severity partitioning

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/select-issues.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/select-issues.test.mjs`

Reuses `upstream-fix/scripts/select-issues.mjs` as the underlying issue
fetcher, then partitions the result by severity tier per `config.json`.
Returns `{ autoTier, humanTier, needsTriage }`.

- [ ] **Step 1: Write the failing test file**

Create `.claude/skills/upstream-swarm/scripts/__tests__/select-issues.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionBySeverity } from "../select-issues.mjs";

const CONFIG = {
  autoMergeSeverities: ["nice-to-have-fix"],
  humanReviewSeverities: ["feature", "critical-stability"],
};

test("partitionBySeverity routes nice-to-have-fix to autoTier", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "feature", needsTriage: false },
    { number: 3, severity: "critical-stability", needsTriage: false },
  ];
  const r = partitionBySeverity(records, CONFIG);
  assert.deepEqual(r.autoTier.map((x) => x.number), [1]);
  assert.deepEqual(r.humanTier.map((x) => x.number).sort(), [2, 3]);
  assert.equal(r.needsTriage.length, 0);
});

test("partitionBySeverity moves needsTriage to its own bucket", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "nice-to-have-fix", needsTriage: true },
  ];
  const r = partitionBySeverity(records, CONFIG);
  assert.deepEqual(r.autoTier.map((x) => x.number), [1]);
  assert.deepEqual(r.needsTriage.map((x) => x.number), [2]);
});

test("unknown severity falls into humanTier (fail-safe)", () => {
  const records = [{ number: 1, severity: "mystery", needsTriage: false }];
  const r = partitionBySeverity(records, CONFIG);
  assert.equal(r.autoTier.length, 0);
  assert.deepEqual(r.humanTier.map((x) => x.number), [1]);
});

test("missing severity (null) falls into humanTier", () => {
  const records = [{ number: 1, severity: null, needsTriage: false }];
  const r = partitionBySeverity(records, CONFIG);
  assert.equal(r.autoTier.length, 0);
  assert.deepEqual(r.humanTier.map((x) => x.number), [1]);
});

test("empty input returns empty buckets", () => {
  const r = partitionBySeverity([], CONFIG);
  assert.deepEqual(r, { autoTier: [], humanTier: [], needsTriage: [] });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/select-issues.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `select-issues.mjs`**

Create `.claude/skills/upstream-swarm/scripts/select-issues.mjs`:

```javascript
#!/usr/bin/env node
/**
 * select-issues.mjs — fetch triaged issues + partition by severity tier.
 * Wraps upstream-fix/scripts/select-issues.mjs and applies the swarm's
 * autoMergeSeverities / humanReviewSeverities config to split records.
 *
 * CLI: node select-issues.mjs --config <path> [--filter "<query>"] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectIssues as fixSelect } from "../../upstream-fix/scripts/select-issues.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = resolve(HERE, "..", "config.json");

export function loadConfig(path = DEFAULT_CONFIG) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * @param {Array<{number, severity, needsTriage}>} records
 * @param {{autoMergeSeverities:string[], humanReviewSeverities:string[]}} config
 */
export function partitionBySeverity(records, config) {
  const autoSet = new Set(config.autoMergeSeverities ?? []);
  const result = { autoTier: [], humanTier: [], needsTriage: [] };
  for (const r of records) {
    if (r.needsTriage) { result.needsTriage.push(r); continue; }
    if (r.severity && autoSet.has(r.severity)) result.autoTier.push(r);
    else result.humanTier.push(r);
  }
  return result;
}

export function selectAndPartition({ filter = {}, configPath = DEFAULT_CONFIG, repo, guidanceDir, outPath }) {
  const config = loadConfig(configPath);
  const fixResult = fixSelect({ filter, repo, guidanceDir });
  const part = partitionBySeverity(fixResult.records, config);
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ autoTier: part.autoTier, humanTier: part.humanTier, needsTriage: part.needsTriage }, null, 2) + "\n");
  }
  return { ...part, totalAuto: part.autoTier.length, totalHuman: part.humanTier.length, totalNeedsTriage: part.needsTriage.length };
}

function parseArgv(argv) {
  let configPath = DEFAULT_CONFIG, outPath = null, filter = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") configPath = argv[++i];
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--severity") filter.severity = argv[++i];
    else if (a === "--type") filter.type = argv[++i];
    else if (a === "--label") filter.label = argv[++i];
    else if (a === "--issues") filter.issues = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--all") filter.all = true;
  }
  return { filter, configPath, outPath };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { filter, configPath, outPath } = parseArgv(process.argv.slice(2));
    const r = selectAndPartition({ filter, configPath, outPath });
    process.stdout.write(JSON.stringify({ totalAuto: r.totalAuto, totalHuman: r.totalHuman, totalNeedsTriage: r.totalNeedsTriage, out: outPath }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/select-issues.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/select-issues.mjs .claude/skills/upstream-swarm/scripts/__tests__/select-issues.test.mjs
git commit -m "feat(upstream-swarm): selector with severity-tier partitioning (5 tests)"
```

---

## Task 6: `baseline-gate.mjs` — pre-flight gate

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs`

Runs `run-gates.mjs full` against a fresh worktree at `origin/main`.
Returns `{ pass, failTail, logPath }`. Aborts the swarm if red.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBaselineGate } from "../baseline-gate.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "baseline-gate-")); }

test("returns pass when run-gates returns pass", async () => {
  const dir = tmp();
  try {
    const r = runBaselineGate({
      workdir: dir,
      logPath: join(dir, "baseline.log"),
      worktreeRunner: (args) => ({ status: 0, stdout: "worktree created", stderr: "" }),
      gateRunner: () => ({ pass: true, failTail: "" }),
    });
    assert.equal(r.pass, true);
    assert.equal(r.failTail, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("returns pass:false + failTail when run-gates returns fail", () => {
  const dir = tmp();
  try {
    const r = runBaselineGate({
      workdir: dir,
      logPath: join(dir, "baseline.log"),
      worktreeRunner: () => ({ status: 0, stdout: "", stderr: "" }),
      gateRunner: () => ({ pass: false, failTail: "AssertionError: foo\n2 failures" }),
    });
    assert.equal(r.pass, false);
    assert.match(r.failTail, /AssertionError/);
    assert.equal(r.logPath, join(dir, "baseline.log"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("uses a fresh worktree at origin/main by default", () => {
  let observed = null;
  runBaselineGate({
    workdir: "/tmp/x",
    logPath: "/tmp/x/baseline.log",
    base: "origin/main",
    worktreeRunner: (args) => { observed = args; return { status: 0 }; },
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.ok(observed.includes("origin/main"), "worktree should be created at origin/main");
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `baseline-gate.mjs`**

Create `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs`:

```javascript
#!/usr/bin/env node
/**
 * baseline-gate.mjs — pre-flight: run full local gate against origin/main.
 * Aborts the swarm before any PRs open if main itself is rotten.
 * CLI: node baseline-gate.mjs --workdir <dir> --log <path> [--base origin/main]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as pdir, resolve } from "node:path";

const HERE = pdir(fileURLToPath(import.meta.url));
const RUN_GATES = resolve(HERE, "..", "..", "upstream-fix", "scripts", "run-gates.mjs");

function defaultWorktreeRunner(args) { return { status: 0, stdout: execFileSync("git", args, { encoding: "utf-8" }), stderr: "" }; }

async function defaultGateRunner({ workdir, logPath }) {
  // Dynamic import so unit tests don't require run-gates on disk.
  const { runGate } = await import(RUN_GATES);
  return runGate({ gate: "full", cwd: workdir, logPath });
}

export function runBaselineGate({ workdir, logPath, base = "origin/main", worktreeRunner = defaultWorktreeRunner, gateRunner = defaultGateRunner }) {
  mkdirSync(dirname(logPath), { recursive: true });
  // Create a detached worktree at base.
  worktreeRunner(["worktree", "add", "--detach", workdir, base]);
  // gateRunner may be sync (tests) or async (real). Normalize.
  const out = gateRunner({ workdir, logPath });
  if (out && typeof out.then === "function") {
    // Async path
    return out.then((r) => ({ pass: r.pass, failTail: r.failTail ?? "", logPath }));
  }
  return { pass: out.pass, failTail: out.failTail ?? "", logPath };
}

function parseArgv(argv) {
  let workdir = null, logPath = null, base = "origin/main";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workdir") workdir = argv[++i];
    else if (argv[i] === "--log") logPath = argv[++i];
    else if (argv[i] === "--base") base = argv[++i];
  }
  return { workdir, logPath, base };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  (async () => {
    try {
      const { workdir, logPath, base } = parseArgv(process.argv.slice(2));
      if (!workdir || !logPath) throw new Error("Usage: node baseline-gate.mjs --workdir <dir> --log <path> [--base origin/main]");
      const r = await runBaselineGate({ workdir, logPath, base });
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      if (!r.pass) process.exit(2);
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
      process.exit(1);
    }
  })();
}
```

- [ ] **Step 4: Run tests and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/baseline-gate.mjs .claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs
git commit -m "feat(upstream-swarm): pre-flight baseline gate (3 tests)"
```

---

## Task 7: `refute-panel.mjs` (pure logic — voting + comment formatting)

**Files:**
- Create: `.claude/skills/upstream-merge/scripts/refute-panel.mjs`
- Create: `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`

The refute panel runs 4 specialist subagents per PR. This task implements
the pure logic — voting rule and PR-comment formatter. Subagent dispatch
ships in Task 8.

- [ ] **Step 1: Write the failing test file**

Create `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { tallyVerdicts, formatRefuteComment, LENS_NAMES } from "../refute-panel.mjs";

const A = (lens, verdict, reason = "ok") => ({ lens, verdict, reason, confidence: 0.9, blocking: verdict === "refute" });

test("LENS_NAMES has the four lenses in expected order", () => {
  assert.deepEqual(LENS_NAMES, ["upstream-alignment", "scope-discipline", "test-quality", "blast-radius"]);
});

test("panel approves when ≥2 approve and 0 refute", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "approve"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "approve");
  assert.equal(r.approves, 2);
  assert.equal(r.refutes, 0);
});

test("panel refutes when any refute present", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "refute", "touches unrelated file"),
    A("test-quality", "approve"),
    A("blast-radius", "approve"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.equal(r.refutes, 1);
});

test("panel refutes (fail-safe) when all four abstain", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "abstain"),
    A("scope-discipline", "abstain"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.match(r.reason, /no non-abstain verdicts/);
});

test("panel refutes (fail-safe) when fewer than 2 approves", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "abstain"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.match(r.reason, /need.*2 approve/i);
});

test("panel refutes when a lens errored (treated as abstain) and condition not met", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    { lens: "scope-discipline", verdict: "abstain", reason: "lens errored", confidence: 0, blocking: false },
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
});

test("formatRefuteComment renders a markdown table with lens verdicts", () => {
  const verdicts = [
    A("upstream-alignment", "approve"),
    A("scope-discipline", "refute", "PR touches packages/x/y.ts which is not in upstream baf4028"),
    A("test-quality", "approve"),
    A("blast-radius", "abstain"),
  ];
  const md = formatRefuteComment(verdicts, { runId: "swarm-run-3" });
  assert.match(md, /Refute panel blocked/);
  assert.match(md, /upstream-alignment.*approve/);
  assert.match(md, /scope-discipline.*refute/);
  assert.match(md, /PR touches packages\/x\/y\.ts/);
  assert.match(md, /Run id: swarm-run-3/);
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure logic in `refute-panel.mjs`**

Create `.claude/skills/upstream-merge/scripts/refute-panel.mjs`:

```javascript
#!/usr/bin/env node
/**
 * refute-panel.mjs — 4-lens panel that runs after the two-signal gate.
 * Pure: tallyVerdicts + formatRefuteComment. The subagent runner is wired
 * by callers (SKILL.md orchestration or merge-pr.mjs).
 */

export const LENS_NAMES = [
  "upstream-alignment",
  "scope-discipline",
  "test-quality",
  "blast-radius",
];

/**
 * Apply the voting rule: panel approves iff ≥2 non-abstain verdicts are
 * `approve` AND zero are `refute`. Otherwise refute (fail-safe).
 */
export function tallyVerdicts(verdicts) {
  const refutes = verdicts.filter((v) => v.verdict === "refute").length;
  const approves = verdicts.filter((v) => v.verdict === "approve").length;
  const abstains = verdicts.filter((v) => v.verdict === "abstain").length;
  const nonAbstain = approves + refutes;

  if (refutes > 0) {
    return { panelVerdict: "refute", approves, refutes, abstains, reason: `${refutes} lens(es) refuted` };
  }
  if (nonAbstain === 0) {
    return { panelVerdict: "refute", approves, refutes, abstains, reason: "no non-abstain verdicts (all errored or abstained)" };
  }
  if (approves < 2) {
    return { panelVerdict: "refute", approves, refutes, abstains, reason: `need ≥2 approve, got ${approves}` };
  }
  return { panelVerdict: "approve", approves, refutes, abstains, reason: `${approves} approve / ${abstains} abstain / 0 refute` };
}

/** Render the consolidated PR comment markdown when the panel refutes. */
export function formatRefuteComment(verdicts, { runId } = {}) {
  const lines = [];
  lines.push("🤖 Refute panel blocked auto-merge");
  lines.push("");
  lines.push("| Lens | Verdict | Reason |");
  lines.push("| --- | --- | --- |");
  for (const v of verdicts) {
    const reason = (v.reason ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${v.lens} | ${v.verdict} | ${reason} |`);
  }
  lines.push("");
  lines.push("Labeling `status:needs-human`.");
  if (runId) lines.push(`Run id: ${runId}.`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests and verify**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-merge/scripts/refute-panel.mjs .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs
git commit -m "feat(upstream-merge): refute-panel voting rule + PR comment formatter (7 tests)"
```

---

## Task 8: `refute-panel.mjs` — input bundle + parallel lens runner

**Files:**
- Modify: `.claude/skills/upstream-merge/scripts/refute-panel.mjs`
- Modify: `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`

Add `buildInputBundle` that materializes the diff + upstream show + issue
body once and shares across lenses, and `runPanel` that dispatches the 4
lens subagents in parallel via an injected runner.

- [ ] **Step 1: Add tests for `buildInputBundle` and `runPanel`**

Append to `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`:

```javascript
import { buildInputBundle, runPanel } from "../refute-panel.mjs";

test("buildInputBundle gathers PR + upstream + issue context once", () => {
  const fakeGh = (args) => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 74, title: "fix(x): y", body: "closes #53", headRefOid: "abc1234" });
    if (args[0] === "pr" && args[1] === "diff") return "diff --git a/x b/x\n+foo\n";
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ number: 53, body: "sha=baf4028\nTarget: x.ts", labels: [{name:"severity:nice-to-have-fix"},{name:"conflict-risk:none"}] });
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const fakeGit = (args) => {
    if (args[0] === "show") return "commit baf4028\nAuthor: x\n\ndiff --git ...\n+foo\n";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const bundle = buildInputBundle({ prNumber: 74, issueNumber: 53, upstreamSha: "baf4028", repo: "cmetech/otto-cli", ghRunner: fakeGh, gitRunner: fakeGit });
  assert.equal(bundle.prNumber, 74);
  assert.equal(bundle.issueNumber, 53);
  assert.match(bundle.prDiff, /diff --git a\/x/);
  assert.match(bundle.upstreamShow, /commit baf4028/);
  assert.equal(bundle.severity, "nice-to-have-fix");
  assert.equal(bundle.conflictRisk, "none");
});

test("runPanel dispatches one subagent per lens in parallel and tallies", async () => {
  const dispatched = [];
  const fakeAgentRunner = async ({ lens }) => {
    dispatched.push(lens);
    return { lens, verdict: "approve", confidence: 0.9, reason: `${lens} ok`, blocking: false };
  };
  const r = await runPanel({
    bundle: { prNumber: 74, prDiff: "x", upstreamShow: "y", issueBody: "z", severity: "nice-to-have-fix", conflictRisk: "none" },
    agentRunner: fakeAgentRunner,
  });
  assert.deepEqual(dispatched.sort(), ["blast-radius", "scope-discipline", "test-quality", "upstream-alignment"]);
  assert.equal(r.verdicts.length, 4);
  assert.equal(r.tally.panelVerdict, "approve");
});

test("runPanel treats a lens error as an abstain verdict", async () => {
  const fakeAgentRunner = async ({ lens }) => {
    if (lens === "scope-discipline") throw new Error("lens crashed");
    return { lens, verdict: "approve", confidence: 0.9, reason: "ok", blocking: false };
  };
  const r = await runPanel({ bundle: { prNumber: 1, prDiff: "x", upstreamShow: "y", issueBody: "z" }, agentRunner: fakeAgentRunner });
  const scope = r.verdicts.find((v) => v.lens === "scope-discipline");
  assert.equal(scope.verdict, "abstain");
  assert.match(scope.reason, /lens crashed|error/i);
  // 3 approve + 1 abstain → approves >=2 and 0 refutes → approve
  assert.equal(r.tally.panelVerdict, "approve");
});
```

- [ ] **Step 2: Run, expect FAIL on the new tests**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
Expected: 7 PASS, 3 FAIL (the new ones).

- [ ] **Step 3: Extend `refute-panel.mjs` with `buildInputBundle` and `runPanel`**

Append the following to `.claude/skills/upstream-merge/scripts/refute-panel.mjs`:

```javascript
import { execFileSync } from "node:child_process";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }
function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }

function severityFromLabels(labels = []) {
  const l = labels.find((x) => (x.name ?? "").startsWith("severity:"));
  return l ? l.name.slice("severity:".length) : null;
}
function riskFromLabels(labels = []) {
  const l = labels.find((x) => (x.name ?? "").startsWith("conflict-risk:"));
  return l ? l.name.slice("conflict-risk:".length) : null;
}

/** Materialize the input bundle shared across all four lenses. One I/O round. */
export function buildInputBundle({ prNumber, issueNumber, upstreamSha, repo = "cmetech/otto-cli", ghRunner = defaultGhRunner, gitRunner = defaultGitRunner }) {
  const prView = JSON.parse(ghRunner(["pr", "view", String(prNumber), "--repo", repo, "--json", "number,title,body,headRefOid"]));
  const prDiff = ghRunner(["pr", "diff", String(prNumber), "--repo", repo]);
  const issueView = JSON.parse(ghRunner(["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,body,labels"]));
  const upstreamShow = gitRunner(["show", upstreamSha]);
  return {
    prNumber,
    prTitle: prView.title,
    prBody: prView.body,
    prHeadSha: prView.headRefOid,
    prDiff,
    issueNumber,
    issueBody: issueView.body,
    upstreamSha,
    upstreamShow,
    severity: severityFromLabels(issueView.labels),
    conflictRisk: riskFromLabels(issueView.labels),
  };
}

/** Run 4 lenses in parallel; lens errors become abstains. Returns { verdicts, tally }. */
export async function runPanel({ bundle, agentRunner }) {
  const tasks = LENS_NAMES.map(async (lens) => {
    try {
      const v = await agentRunner({ lens, bundle });
      // Normalize and trust the agent's structured output.
      return { lens, verdict: v.verdict, confidence: v.confidence ?? null, reason: v.reason ?? "", blocking: !!v.blocking };
    } catch (err) {
      return { lens, verdict: "abstain", confidence: 0, reason: `lens error: ${err.message ?? String(err)}`, blocking: false };
    }
  });
  const verdicts = await Promise.all(tasks);
  const tally = tallyVerdicts(verdicts);
  return { verdicts, tally };
}
```

- [ ] **Step 4: Run tests and verify all 10 pass**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-merge/scripts/refute-panel.mjs .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs
git commit -m "feat(upstream-merge): refute-panel input bundle + parallel lens runner (10 tests)"
```

---

## Task 9: Extend `merge-pr.mjs` to gate on refute verdict under `--auto`

**Files:**
- Modify: `.claude/skills/upstream-merge/scripts/merge-pr.mjs`
- Modify: `.claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`

Add an `auto` mode that requires an explicit `refuteVerdict` parameter
and gates merge on it. Fail-safe: `--auto` without a refute verdict does
NOT merge.

- [ ] **Step 1: Add tests for the auto + refute behavior**

Read the existing test file: `.claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`
Append at the end:

```javascript
test("auto mode merges when refute verdict is approve", () => {
  const calls = [];
  const r = mergePr({
    number: 99,
    auto: true,
    refuteVerdict: "approve",
    ghRunner: (args) => { calls.push(args); return args[1] === "merge" ? "" : JSON.stringify({ mergeCommit: { oid: "abcdef1234" } }); },
    sleep: () => {},
  });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "abcdef1");
  assert.ok(calls.some((c) => c[0] === "pr" && c[1] === "merge"), "expected gh pr merge invocation");
});

test("auto mode refuses to merge when refute verdict is refute", () => {
  const calls = [];
  const r = mergePr({
    number: 99,
    auto: true,
    refuteVerdict: "refute",
    refuteReason: "scope-discipline refuted",
    ghRunner: (args) => { calls.push(args); return ""; },
    sleep: () => {},
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute");
  assert.match(r.reason, /scope-discipline/);
  assert.ok(!calls.some((c) => c[0] === "pr" && c[1] === "merge"), "must NOT call gh pr merge");
});

test("auto mode refuses to merge when refute verdict is missing (fail-safe)", () => {
  const calls = [];
  const r = mergePr({
    number: 99,
    auto: true,
    ghRunner: (args) => { calls.push(args); return ""; },
    sleep: () => {},
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute-missing");
  assert.ok(!calls.some((c) => c[0] === "pr" && c[1] === "merge"), "must NOT call gh pr merge without a refute verdict");
});

test("non-auto mode still merges without consulting refute verdict (backward compatible)", () => {
  const r = mergePr({
    number: 99,
    ghRunner: (args) => args[1] === "merge" ? "" : JSON.stringify({ mergeCommit: { oid: "deadbee1234" } }),
    sleep: () => {},
  });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "deadbee");
});
```

- [ ] **Step 2: Run, expect FAILS on the 4 new tests**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`
Expected: 5 PASS (existing) + 4 FAIL (new).

- [ ] **Step 3: Update `merge-pr.mjs` to accept `auto`/`refuteVerdict`/`refuteReason`**

Read the existing `.claude/skills/upstream-merge/scripts/merge-pr.mjs` and replace the `mergePr` function with:

```javascript
export function mergePr({ number, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, attempts = 5, sleep = defaultSleep, auto = false, refuteVerdict = null, refuteReason = null }) {
  if (!Number.isInteger(number)) throw new Error(`PR number must be an integer: ${number}`);

  // Auto mode requires an explicit refute verdict; absence is fail-safe (do not merge).
  if (auto) {
    if (refuteVerdict === null) {
      return { merged: false, sha: null, blockedBy: "refute-missing", reason: "auto mode requires refuteVerdict; refusing to merge" };
    }
    if (refuteVerdict !== "approve") {
      return { merged: false, sha: null, blockedBy: "refute", reason: `refute panel ${refuteVerdict}: ${refuteReason ?? ""}` };
    }
  }

  ghRunner(["pr", "merge", String(number), "--repo", repo, "--squash", "--delete-branch"]);
  let sha = null;
  for (let i = 0; i < attempts; i++) {
    const view = JSON.parse(ghRunner(["pr", "view", String(number), "--repo", repo, "--json", "mergeCommit"]));
    if (view?.mergeCommit?.oid) { sha = String(view.mergeCommit.oid).slice(0, 7); break; }
    if (i < attempts - 1) sleep(1000);
  }
  return { merged: true, sha };
}
```

- [ ] **Step 4: Update the CLI shim to accept `--auto` and `--refute-verdict`**

Replace the CLI shim block at the bottom of `merge-pr.mjs`:

```javascript
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const number = Number(process.argv[2]);
    let repo = DEFAULT_REPO, auto = false, refuteVerdict = null, refuteReason = null;
    for (let i = 3; i < process.argv.length; i++) {
      const a = process.argv[i];
      if (a === "--repo") repo = process.argv[++i];
      else if (a === "--auto") auto = true;
      else if (a === "--refute-verdict") refuteVerdict = process.argv[++i];
      else if (a === "--refute-reason") refuteReason = process.argv[++i];
    }
    if (!Number.isInteger(number)) throw new Error("Usage: node merge-pr.mjs <number> [--repo <r>] [--auto --refute-verdict <approve|refute>]");
    const r = mergePr({ number, repo, auto, refuteVerdict, refuteReason });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.merged) process.exit(2);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run tests and verify all 9 pass**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`
Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-merge/scripts/merge-pr.mjs .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs
git commit -m "feat(upstream-merge): --auto mode gates merge on refute verdict (4 new tests)"
```

---

## Task 10: Update `upstream-merge/SKILL.md` to wire Phase B.5 refute panel

**Files:**
- Modify: `.claude/skills/upstream-merge/SKILL.md`

Add documentation for the new Phase B.5 (refute panel) between Phase B
(confirm) and Phase C (merge). Add `--auto` and `--refute` flags to the
flag table.

- [ ] **Step 1: Read the existing `SKILL.md` to find the Phase B / Phase C boundary**

Run: `grep -n "^## Phase" .claude/skills/upstream-merge/SKILL.md`

- [ ] **Step 2: Insert a new "## Phase B.5 — Refute panel" section between Phase B and Phase C**

Edit `.claude/skills/upstream-merge/SKILL.md`. Find the line `## Phase C — Merge (per PR with a passing verdict)` and insert ABOVE it:

```markdown
## Phase B.5 — Refute panel (only under `--auto`)

When invoked without `--auto`, the human IS the refute step — skip Phase B.5.
Under `--auto`, after Phase B confirms both signals green, dispatch the
multi-lens refute panel before any merge:

1. Build the shared input bundle once per PR:
   ```sh
   node -e "import('./.claude/skills/upstream-merge/scripts/refute-panel.mjs').then(async m => {
     const b = m.buildInputBundle({ prNumber: PR, issueNumber: ISSUE, upstreamSha: SHA });
     console.log(JSON.stringify(b));
   })"
   ```
2. Dispatch 4 lens subagents in parallel via `agent()` (Workflow tool) or
   the equivalent fan-out primitive. Each lens uses `agentType: "general-purpose"`
   and a schema-forced output (see `refute-panel.mjs` for the schema).
3. Apply `tallyVerdicts` to get the panel verdict.
4. If REFUTE: post the consolidated comment via `gh pr comment`, label the
   issue `status:needs-human`, do NOT merge. Record `refuteVerdict` and
   `refuteReason` in the ledger.
5. If APPROVE: proceed to Phase C with `--refute-verdict approve`.

Lens prompts live in `refute-panel.mjs`. Each lens is given the bundle and
asked one question (upstream-alignment / scope-discipline / test-quality /
blast-radius). Schema:

```json
{
  "verdict": "approve" | "refute" | "abstain",
  "confidence": 0.0-1.0,
  "reason": "<= 200 chars",
  "blocking": boolean
}
```
```

- [ ] **Step 3: Update the Phase C merge command to pass the refute verdict**

Find the Phase C `merge-pr.mjs` invocation and change it to:

```sh
node .claude/skills/upstream-merge/scripts/merge-pr.mjs <n> --repo cmetech/otto-cli \
  ${AUTO:+--auto --refute-verdict $REFUTE_VERDICT}
```

- [ ] **Step 4: Update the Flags section**

Find the existing `## Flags` section and add:

```markdown
- `--auto-refute` — implies `--auto` AND runs Phase B.5 refute panel
  before each merge. The swarm orchestrator always passes this; humans
  invoking `upstream-merge` directly normally do not.
```

(`--auto` already exists — do not duplicate.)

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-merge/SKILL.md
git commit -m "docs(upstream-merge): Phase B.5 refute panel + --auto-refute flag"
```

---

## Task 11: `upstream-fix --single-issue` mode

**Files:**
- Modify: `.claude/skills/upstream-fix/SKILL.md`
- Create: `.claude/skills/upstream-fix/scripts/__tests__/single-issue-mode.test.mjs`

`--single-issue <N>` short-circuits planning to a one-issue lane, sets the
PR title to `fix(upstream): <subject> (closes #N)`, and uses an issue-scoped
branch name. Existing bundled mode unchanged.

- [ ] **Step 1: Read `.claude/skills/upstream-fix/scripts/select-issues.mjs`**

Confirm filter accepts `--issues` already (it does — see Task 5 reference reads).

- [ ] **Step 2: Write the test for single-issue branch + PR title shape**

Create `.claude/skills/upstream-fix/scripts/__tests__/single-issue-mode.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { singleIssueBranch, singleIssuePrTitle, singleIssueIntegrationBranch } from "../single-issue-mode.mjs";

test("singleIssueBranch derives a stable per-issue branch name", () => {
  assert.equal(singleIssueBranch(53, "baf4028"), "fix/upstream-issue-53-baf4028");
});

test("singleIssuePrTitle includes the upstream-fix prefix and 'closes #N'", () => {
  const t = singleIssuePrTitle({ number: 53, subject: "use the right basedir for patterns" });
  assert.equal(t, "fix(upstream): use the right basedir for patterns (closes #53)");
});

test("singleIssuePrTitle truncates very long subjects to <=72 chars", () => {
  const long = "x".repeat(200);
  const t = singleIssuePrTitle({ number: 1, subject: long });
  // GitHub recommends ≤72 chars total title; we hard-cap.
  assert.ok(t.length <= 72, `title was ${t.length} chars`);
  assert.match(t, /closes #1/);
});

test("singleIssueIntegrationBranch returns the same per-issue branch (no integration step)", () => {
  // For 1:1 cardinality, the fix branch IS the integration branch.
  assert.equal(singleIssueIntegrationBranch(53, "baf4028"), "fix/upstream-issue-53-baf4028");
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `node --test .claude/skills/upstream-fix/scripts/__tests__/single-issue-mode.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `.claude/skills/upstream-fix/scripts/single-issue-mode.mjs`**

```javascript
#!/usr/bin/env node
/**
 * single-issue-mode.mjs — naming + PR-title helpers for upstream-fix --single-issue.
 * Pure functions. The actual scheduling in --single-issue mode is one issue
 * in one lane on one branch; these helpers keep names consistent.
 */

const MAX_TITLE = 72;

export function singleIssueBranch(issueNumber, sha) {
  return `fix/upstream-issue-${issueNumber}-${sha}`;
}

export function singleIssueIntegrationBranch(issueNumber, sha) {
  // In --single-issue, there is no separate integration step; the fix branch
  // IS the integration branch. Returning the same name centralizes the
  // assumption.
  return singleIssueBranch(issueNumber, sha);
}

export function singleIssuePrTitle({ number, subject }) {
  const closesSuffix = ` (closes #${number})`;
  const prefix = "fix(upstream): ";
  const budget = MAX_TITLE - prefix.length - closesSuffix.length;
  const subjectClipped = (subject ?? "").length > budget ? (subject ?? "").slice(0, budget - 1).trimEnd() + "…" : (subject ?? "");
  return `${prefix}${subjectClipped}${closesSuffix}`;
}
```

- [ ] **Step 5: Run tests and verify 4 pass**

Run: `node --test .claude/skills/upstream-fix/scripts/__tests__/single-issue-mode.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 6: Update `upstream-fix/SKILL.md` to document `--single-issue <N>`**

Find the `## Flags` section in `.claude/skills/upstream-fix/SKILL.md` and add:

```markdown
- `--single-issue <N>` — short-circuit planning to exactly one issue. The
  fix runs on its own per-issue branch `fix/upstream-issue-<N>-<sha>`,
  opens exactly one PR titled
  `fix(upstream): <subject> (closes #N)`, and skips the bundled-integration
  step entirely. Used by the `upstream-swarm` orchestrator. Composable
  with `--auto-merge` to hand the PR straight to `upstream-merge --auto`.
```

In Phase A (Plan) add a note:

```markdown
**`--single-issue` mode override.** When `--single-issue <N>` is set,
select-issues filters to exactly that number; plan-lanes returns one lane
with one issue; worktree-setup uses `singleIssueBranch(N, sha)` from
`single-issue-mode.mjs`; integration uses `singleIssueIntegrationBranch`
(same branch); PR title uses `singleIssuePrTitle`.
```

- [ ] **Step 7: Commit**

```bash
git add -f .claude/skills/upstream-fix/scripts/single-issue-mode.mjs .claude/skills/upstream-fix/scripts/__tests__/single-issue-mode.test.mjs .claude/skills/upstream-fix/SKILL.md
git commit -m "feat(upstream-fix): --single-issue mode helpers + SKILL docs (4 tests)"
```

---

## Task 12: `scheduler.mjs` — pipelined backpressure loop

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/scheduler.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`

Pure function on `(ledger, caps) → nextActions`. The runtime calls it
each tick to learn what to dispatch next. Actions are typed; the runtime
executes them (start fix lane, poll CI, run refute, merge).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextActions } from "../scheduler.mjs";

const CAPS = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };

function led(states) {
  const issues = {};
  for (const [number, state] of Object.entries(states)) {
    issues[number] = { state, prNumber: state === "awaiting-ci" || state === "ci-green" ? Number(number) + 100 : null };
  }
  return { issues };
}

test("starts up to fixConcurrency lanes when fix-able issues exist", () => {
  const ledger = led({ 1: "selected", 2: "selected", 3: "selected", 4: "selected" });
  const actions = nextActions(ledger, CAPS);
  const fixes = actions.filter((a) => a.kind === "start-fix");
  assert.equal(fixes.length, 3);
  assert.deepEqual(fixes.map((a) => a.issueNumber).sort(), [1, 2, 3]);
});

test("backpressure: no new fixes when prWindow is full", () => {
  const ledger = led(Object.fromEntries(Array.from({length: 10}, (_, i) => [i + 1, "awaiting-ci"]).concat([[100, "selected"]])));
  const actions = nextActions(ledger, { ...CAPS, prWindow: 10 });
  assert.equal(actions.filter((a) => a.kind === "start-fix").length, 0);
});

test("polls CI for awaiting-ci issues (one poll-ci action each)", () => {
  const ledger = led({ 1: "awaiting-ci", 2: "awaiting-ci" });
  const actions = nextActions(ledger, CAPS);
  const polls = actions.filter((a) => a.kind === "poll-ci");
  assert.equal(polls.length, 2);
});

test("kicks local-gate on ci-green issues", () => {
  const ledger = led({ 1: "ci-green", 2: "ci-green" });
  const actions = nextActions(ledger, CAPS);
  const gates = actions.filter((a) => a.kind === "run-local-gate");
  assert.equal(gates.length, 2);
});

test("kicks refute panel on local-gate-pending issues up to refuteConcurrency", () => {
  const ledger = led({ 1: "local-gate-pending", 2: "local-gate-pending", 3: "local-gate-pending", 4: "local-gate-pending", 5: "local-gate-pending", 6: "local-gate-pending" });
  const actions = nextActions(ledger, { ...CAPS, refuteConcurrency: 5 });
  assert.equal(actions.filter((a) => a.kind === "run-refute").length, 5);
});

test("merges approved issues", () => {
  const ledger = led({ 1: "approved", 2: "approved" });
  const actions = nextActions(ledger, CAPS);
  const merges = actions.filter((a) => a.kind === "merge-pr");
  assert.equal(merges.length, 2);
});

test("returns empty array when there is no work", () => {
  const ledger = led({ 1: "merged", 2: "quarantined" });
  assert.deepEqual(nextActions(ledger, CAPS), []);
});

test("counts in-flight fixes correctly: fixing / retrying counts toward fixConcurrency cap", () => {
  const ledger = led({ 1: "fixing", 2: "retrying", 3: "selected", 4: "selected" });
  const actions = nextActions(ledger, { ...CAPS, fixConcurrency: 3 });
  // 2 already in-flight (fixing + retrying), cap is 3 → only 1 more start-fix.
  assert.equal(actions.filter((a) => a.kind === "start-fix").length, 1);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scheduler.mjs`**

Create `.claude/skills/upstream-swarm/scripts/scheduler.mjs`:

```javascript
#!/usr/bin/env node
/**
 * scheduler.mjs — pure backpressure loop for upstream-swarm.
 * Given the durable ledger and caps, returns the actions the runtime
 * should execute this tick. Pure; safe to call repeatedly.
 *
 * Action kinds: start-fix, poll-ci, run-local-gate, run-refute, merge-pr
 */

const IN_FLIGHT_FIX_STATES = new Set(["planning", "fixing", "retrying"]);
const OPEN_PR_STATES = new Set([
  "awaiting-ci",
  "ci-green",
  "ci-red",
  "local-gate-pending",
  "local-gate-failed",
  "refute-pending",
  "approved",
  "refuted",
  "pending-human-review",
]);

function countByState(ledger, predicate) {
  let n = 0;
  for (const i of Object.values(ledger.issues)) if (predicate(i.state)) n++;
  return n;
}

export function nextActions(ledger, caps) {
  const actions = [];
  const fixesInFlight = countByState(ledger, (s) => IN_FLIGHT_FIX_STATES.has(s));
  const openPrs = countByState(ledger, (s) => OPEN_PR_STATES.has(s));
  const refutesInFlight = countByState(ledger, (s) => s === "refute-pending");

  // 1. Start new fixes if there is fix-lane slack AND pr-window slack.
  let fixSlack = Math.max(0, caps.fixConcurrency - fixesInFlight);
  const prSlack = Math.max(0, caps.prWindow - openPrs);
  const startCap = Math.min(fixSlack, prSlack);
  const startable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "selected")
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, startCap);
  for (const [number] of startable) actions.push({ kind: "start-fix", issueNumber: Number(number) });

  // 2. Poll CI for awaiting-ci issues.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "awaiting-ci") actions.push({ kind: "poll-ci", issueNumber: Number(number) });
  }

  // 3. Local gate on ci-green.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "ci-green") actions.push({ kind: "run-local-gate", issueNumber: Number(number) });
  }

  // 4. Refute panel on local-gate-pending, up to refuteConcurrency.
  const refuteSlack = Math.max(0, caps.refuteConcurrency - refutesInFlight);
  const refutable = Object.entries(ledger.issues)
    .filter(([, i]) => i.state === "local-gate-pending")
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, refuteSlack);
  for (const [number] of refutable) actions.push({ kind: "run-refute", issueNumber: Number(number) });

  // 5. Merge approved.
  for (const [number, issue] of Object.entries(ledger.issues)) {
    if (issue.state === "approved") actions.push({ kind: "merge-pr", issueNumber: Number(number) });
  }

  return actions;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledger = JSON.parse(process.argv[2] ?? "{\"issues\":{}}");
    const caps = JSON.parse(process.argv[3] ?? "{\"fixConcurrency\":3,\"prWindow\":10,\"refuteConcurrency\":5}");
    process.stdout.write(JSON.stringify(nextActions(ledger, caps), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests and verify all 8 pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/scheduler.mjs .claude/skills/upstream-swarm/scripts/__tests__/scheduler.test.mjs
git commit -m "feat(upstream-swarm): pipelined backpressure scheduler (8 tests)"
```

---

## Task 13: `write-report.mjs` — final rollup

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/write-report.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/write-report.test.mjs`

Renders the swarm ledger into a markdown rollup. Same shape as
`upstream-merge`'s `2026-06-05-merge-report.md`.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/write-report.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../write-report.mjs";

const LEDGER = {
  version: 1,
  date: "2026-06-05",
  filter: "status:triaged",
  startedAt: "2026-06-05T14:00:00Z",
  baselineGate: { pass: true, logPath: "x" },
  waves: [
    { n: 1, issues: [1, 2, 3], startedAt: "..." },
  ],
  issues: {
    "1": { state: "merged", prNumber: 74, prUrl: "https://x/74", mergeSha: "abc123", severity: "nice-to-have-fix", retryCount: 0, refute: { tally: { panelVerdict: "approve", approves: 3, refutes: 0, abstains: 1 } } },
    "2": { state: "pending-human-review", prNumber: 75, prUrl: "https://x/75", mergeSha: null, severity: "feature", retryCount: 0, refute: { tally: { panelVerdict: "approve" } } },
    "3": { state: "quarantined", prNumber: null, severity: "nice-to-have-fix", retryCount: 1, retryReason: "ci-flake", reason: "regression test won't reproduce" },
  },
};

test("renderReport shows the outcome counts", () => {
  const md = renderReport(LEDGER);
  assert.match(md, /Merged.*1/i);
  assert.match(md, /Pending-human-review.*1/i);
  assert.match(md, /Quarantined.*1/i);
});

test("renderReport includes a per-issue table with state, PR URL, mergeSha", () => {
  const md = renderReport(LEDGER);
  assert.match(md, /\| #1 \|/);
  assert.match(md, /merged/);
  assert.match(md, /abc123/);
  assert.match(md, /https:\/\/x\/74/);
});

test("renderReport includes retry log entries for retried issues", () => {
  const md = renderReport(LEDGER);
  assert.match(md, /Retry log/);
  assert.match(md, /#3.*ci-flake/);
});

test("empty ledger renders without throwing and reports zeros", () => {
  const empty = { ...LEDGER, issues: {} };
  const md = renderReport(empty);
  assert.match(md, /Merged.*0/i);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/write-report.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `write-report.mjs`**

Create `.claude/skills/upstream-swarm/scripts/write-report.mjs`:

```javascript
#!/usr/bin/env node
/**
 * write-report.mjs — render the swarm ledger as a markdown rollup.
 * CLI: node write-report.mjs <ledger.json> <out.md>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STATE_TITLES = {
  "merged": "Merged",
  "pending-human-review": "Pending-human-review",
  "quarantined": "Quarantined",
  "refuted": "Refuted",
  "skipped": "Skipped",
};

function countStates(issues) {
  const counts = { merged: 0, "pending-human-review": 0, quarantined: 0, refuted: 0, skipped: 0 };
  for (const i of Object.values(issues)) if (counts[i.state] !== undefined) counts[i.state] += 1;
  return counts;
}

export function renderReport(ledger) {
  const counts = countStates(ledger.issues);
  const lines = [];
  lines.push(`# Upstream-Swarm Report — ${ledger.date}`);
  lines.push("");
  lines.push(`**Filter:** \`${ledger.filter ?? ""}\``);
  lines.push("");
  lines.push("## Outcome");
  lines.push("");
  for (const [state, label] of Object.entries(STATE_TITLES)) {
    lines.push(`- ${label}: **${counts[state]}**`);
  }
  lines.push("");
  lines.push("## Per-issue");
  lines.push("");
  lines.push("| Issue | State | PR | mergeSha | Sev | Retries | Refute |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  const numbers = Object.keys(ledger.issues).map(Number).sort((a, b) => a - b);
  for (const n of numbers) {
    const i = ledger.issues[String(n)];
    const refute = i.refute?.tally?.panelVerdict ?? "—";
    const prCell = i.prUrl ? `[#${i.prNumber}](${i.prUrl})` : "—";
    lines.push(`| #${n} | ${i.state} | ${prCell} | ${i.mergeSha ?? "—"} | ${i.severity ?? "—"} | ${i.retryCount ?? 0} | ${refute} |`);
  }
  lines.push("");
  const retried = numbers.filter((n) => (ledger.issues[String(n)].retryCount ?? 0) > 0);
  if (retried.length) {
    lines.push("## Retry log");
    lines.push("");
    for (const n of retried) {
      const i = ledger.issues[String(n)];
      lines.push(`- #${n}: ${i.retryReason ?? "—"} → ${i.state}`);
    }
    lines.push("");
  }
  if (ledger.baselineGate) {
    lines.push("## Baseline gate");
    lines.push("");
    lines.push(`- Pass: ${ledger.baselineGate.pass}`);
    if (ledger.baselineGate.logPath) lines.push(`- Log: \`${ledger.baselineGate.logPath}\``);
    lines.push("");
  }
  return lines.join("\n");
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const inPath = process.argv[2];
    const outPath = process.argv[3];
    if (!inPath || !outPath) throw new Error("Usage: node write-report.mjs <ledger.json> <out.md>");
    const ledger = JSON.parse(readFileSync(inPath, "utf-8"));
    const md = renderReport(ledger);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, md);
    process.stdout.write(JSON.stringify({ path: outPath }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests and verify 4 pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/write-report.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/write-report.mjs .claude/skills/upstream-swarm/scripts/__tests__/write-report.test.mjs
git commit -m "feat(upstream-swarm): markdown rollup report (4 tests)"
```

---

## Task 14: Write the real `upstream-swarm/SKILL.md`

**Files:**
- Modify: `.claude/skills/upstream-swarm/SKILL.md` (replace the placeholder from Task 1)

The SKILL.md is the agent's runbook — the orchestration that calls
`upstream-fix --single-issue` and `upstream-merge --auto-refute` per
scheduler action.

- [ ] **Step 1: Replace the scaffold `SKILL.md` with the full version**

Overwrite `.claude/skills/upstream-swarm/SKILL.md`:

```markdown
---
name: upstream-swarm
description: Autonomous orchestrator for the upstream-port pipeline. Processes all open status:triaged cherry-pick candidates end-to-end. 1 PR per issue, multi-lens refute panel, tiered auto-merge by severity, retry-then-quarantine. Use when asked to "run the swarm", "auto-port all the triaged issues", or "/upstream-swarm". HIGHEST-stakes skill — lands code on main behind two-signal + refute gates.
---

# Upstream-Swarm

Autonomous third stage above `upstream-fix` and `upstream-merge`. Discovers
all triaged cherry-pick candidates and processes each end-to-end without a
human in the loop for `severity:nice-to-have-fix` issues. Higher-severity
work is routed to a human review queue.

## When to use

- "Run the swarm." / "Port all the triaged issues."
- `/upstream-swarm`, `/upstream-swarm --dry-run`, `/upstream-swarm --resume`.

## Locked invariants (never violate)

- Never merge without **both signals green AND refute panel approve**.
- Never merge `severity:feature` or `severity:critical-stability` automatically;
  always label `status:awaits-review` and stop at PR-open for those.
- Hard cap: 1 retry per issue per swarm run. Persistent failures quarantine.
- Pre-flight baseline gate is mandatory; on red, swarm aborts before any PR.
- The four concurrency caps (3 fix lanes / 10 open PRs / 5 refute panels /
  3 wave-size) are HARD upper bounds. CLI flags can lower them, never raise.
- Worktree cleanup on every terminal state (merged, quarantined,
  pending-human-review). Never leak.

## Context budget

The controller's context grows with the **number of in-flight issues**,
not with diff or log content. All gate logs go to disk; the scheduler
returns compact actions only; the ledger holds verdict summaries not
content. Per-tick: O(in-flight) actions, one verdict line per terminal
issue, one merge-line per merged issue. Resume reads the durable ledger.

## Phase A — Pre-flight + selection (deterministic, up front)

1. **Baseline gate.** Run the full local gate against `origin/main`:
   ```sh
   DATE=$(date +%F); DIR=.planning/upstream-swarms
   node .claude/skills/upstream-swarm/scripts/baseline-gate.mjs \
     --workdir .worktrees/upstream-swarm-baseline \
     --log $DIR/$DATE-baseline-gate.log
   ```
   Read only the printed `{pass, failTail, logPath}`. If `pass:false`, STOP —
   write a baseline-rot report and exit non-zero. Resuming requires the
   baseline rot to be addressed.

2. **Select + partition.** Pull all open `status:triaged` cherry-pick
   candidates and split into auto-tier (`severity:nice-to-have-fix`) and
   human-tier (`severity:feature`, `severity:critical-stability`):
   ```sh
   node .claude/skills/upstream-swarm/scripts/select-issues.mjs \
     --label type:cherry-pick-candidate \
     --out $DIR/$DATE-selected.json
   ```
   Read `{totalAuto, totalHuman, totalNeedsTriage}`. Issues in
   `needsTriage` are skipped with a comment; human-tier issues will skip
   Phase B–C and go straight to "pending-human-review" after fix opens
   the PR.

3. **Plan waves.** Greedy file-disjoint partitioning capped at `--max-wave-size`:
   ```sh
   node .claude/skills/upstream-swarm/scripts/wave-plan.mjs \
     $DIR/$DATE-selected.json --max-wave-size 3 \
     --out $DIR/$DATE-waves.json
   ```

4. **Initialize the ledger** (skip on `--resume`):
   ```sh
   node -e "import('./.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs').then(m => {
     const fs = require('fs');
     const sel = JSON.parse(fs.readFileSync('$DIR/$DATE-selected.json', 'utf-8'));
     const all = [...sel.autoTier, ...sel.humanTier];
     m.initSwarmLedger('$DIR/$DATE-run-state.json', { date: '$DATE', filter: 'status:triaged', issues: all });
   })"
   ```

## Phase B — Scheduler loop (pipelined, agentic)

Loop until `nextActions(ledger, caps)` returns `[]`:

1. Call the scheduler to get this tick's actions:
   ```sh
   node .claude/skills/upstream-swarm/scripts/scheduler.mjs \
     "$(cat $DIR/$DATE-run-state.json)" \
     "$(cat .claude/skills/upstream-swarm/config.json | jq .defaultCaps)"
   ```

2. For each action, dispatch the right sub-skill / subagent:

   | Action kind | What to run |
   |---|---|
   | `start-fix` | Dispatch a subagent to run `upstream-fix --single-issue <N>`; on done record `fix-ok`/`fix-failed`. |
   | `poll-ci` | `gh pr checks <prNumber> --json name,bucket`; on all required green → `ci-green`; on red → classify, retry or quarantine. |
   | `run-local-gate` | `trial-merge` + `run-gates.mjs full` in a worktree at origin/main. On pass → `local-gate-pending` (becomes refute-pending via state). |
   | `run-refute` | `buildInputBundle` then dispatch 4 lens subagents in parallel (Workflow `parallel(LENS_NAMES.map(lens => () => agent(prompt(lens, bundle), {schema: VERDICT_SCHEMA})))`); apply `tallyVerdicts`; record. |
   | `merge-pr` | `merge-pr.mjs <N> --auto --refute-verdict approve --refute-reason "..."`. Severity routing for `feature`/`critical-stability` happens at fix-ok→pending-human-review (skip merge). |

3. On any failure, run `classifyFailure({stage, ...})` from
   `transient-classifier.mjs`. If `transient` and retryCount < 1, call
   `recordRetry(path, N, reason)` then transition to `retrying → fixing`.
   If `real`, transition to `quarantined`, post a comment on the issue
   with the failure log path, label `status:needs-human`.

4. Track an `abortStreak` counter. If 5 consecutive `quarantined` events
   share the same root-cause signature (e.g. same failTail prefix),
   STOP — record a swarm-abort report, do not start any new fixes,
   exit non-zero. Resume requires `--resume` and a human-resolved root
   cause.

## Phase C — Report + cleanup

1. Generate the rollup:
   ```sh
   node .claude/skills/upstream-swarm/scripts/write-report.mjs \
     $DIR/$DATE-run-state.json $DIR/$DATE-swarm-report.md
   ```

2. Worktree hygiene: remove every `.worktrees/upstream-fix-issue-*` and
   `.worktrees/upstream-merge-pr-*` directory on terminal-state. The
   baseline worktree at `.worktrees/upstream-swarm-baseline` is removed
   only on the baseline gate's success path; leave it on failure for
   inspection.

3. Final exit: 0 if no issues quarantined; non-zero (with summary) if any
   are.

## Flags

- `--filter <expr>` — override default `--label type:cherry-pick-candidate`.
- `--fix-concurrency N` (default 3).
- `--pr-window N` (default 10).
- `--refute-concurrency N` (default 5).
- `--max-wave-size N` (default 3).
- `--dry-run` — Phase A only; opens no PRs.
- `--skip-baseline-gate` — explicit opt-out (RARE; documented).
- `--resume` — re-enter Phase B from the existing ledger.

## References

- Design spec: `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-05-upstream-swarm.md`
- Companions: `.claude/skills/upstream-fix/SKILL.md`,
  `.claude/skills/upstream-merge/SKILL.md`,
  `.claude/skills/upstream-cherry-pick/SKILL.md`.
```

- [ ] **Step 2: Verify the file**

Run: `head -15 .claude/skills/upstream-swarm/SKILL.md`
Expected: frontmatter + the title line.

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/SKILL.md
git commit -m "feat(upstream-swarm): full SKILL.md runbook (Phase A-C orchestration)"
```

---

## Task 15: Integration test — happy path (3 issues, all green)

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/integration/happy-path.test.mjs`

Integration tests use mocked runners — no live `gh`/`git`/`npm`. They drive
the scheduler loop with a synthetic ledger and assert that all 3 issues
reach `merged` state.

- [ ] **Step 1: Write the test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/happy-path.test.mjs`:

```javascript
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
    "poll-ci": (n) => recordTransition(path, n, "ci-green"),
    "run-local-gate": (n) => recordTransition(path, n, "local-gate-pending"),
    "run-refute": (n) => { recordTransition(path, n, "refute-pending"); recordTransition(path, n, "approved", { refute: { tally: { panelVerdict: "approve" } } }); },
    "merge-pr": (n) => recordTransition(path, n, "merged", { mergeSha: `sha${n}` }),
  };
  // Bounded loop to detect runaway.
  for (let tick = 0; tick < 100; tick++) {
    const ledger = readLedger(path);
    const acts = nextActions(ledger, CAPS);
    if (!acts.length) return tick;
    for (const a of acts) happyTransitions[a.kind](a.issueNumber);
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
```

- [ ] **Step 2: Run and verify it PASSES (uses already-built modules)**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/happy-path.test.mjs`
Expected: PASS — 1 test.

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/integration/happy-path.test.mjs
git commit -m "test(upstream-swarm): integration happy-path (3 issues, all merged)"
```

---

## Task 16: Integration test — refute blocks (1 of 3 quarantined)

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/integration/refute-blocks.test.mjs`

- [ ] **Step 1: Write the test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/refute-blocks.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/refute-blocks.test.mjs`
Expected: PASS — 1 test.

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/integration/refute-blocks.test.mjs
git commit -m "test(upstream-swarm): integration refute-blocks (1 of 3 quarantined)"
```

---

## Task 17: Integration tests — retry-success + retry-fail

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/integration/retry.test.mjs`

- [ ] **Step 1: Write both tests in one file**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/retry.test.mjs`:

```javascript
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
      "poll-ci": (n) => {
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
      for (const a of acts) transitions[a.kind](a.issueNumber);
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
      "poll-ci": (n) => {
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
      for (const a of acts) transitions[a.kind](a.issueNumber);
    }
    const led = readLedger(path);
    assert.equal(led.issues["1"].state, "quarantined");
    assert.ok(attempts >= 1, "expected at least 1 CI poll");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run and verify both pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/retry.test.mjs`
Expected: PASS — 2 tests.

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/integration/retry.test.mjs
git commit -m "test(upstream-swarm): integration retry-success + retry-fail"
```

---

## Task 18: Integration tests — severity routing + resume

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/integration/severity-routing.test.mjs`
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/integration/resume.test.mjs`

- [ ] **Step 1: Severity routing test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/severity-routing.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionBySeverity } from "../../select-issues.mjs";

const CONFIG = {
  autoMergeSeverities: ["nice-to-have-fix"],
  humanReviewSeverities: ["feature", "critical-stability"],
};

test("auto-tier and human-tier are routed end-to-end", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "feature", needsTriage: false },
    { number: 3, severity: "critical-stability", needsTriage: false },
  ];
  const p = partitionBySeverity(records, CONFIG);
  // Auto-tier goes to the swarm's Phase B; human-tier should be flagged
  // so that the SKILL.md routes them to "pending-human-review" after their
  // fix-stage PR opens. The unit asserts only the partition shape here;
  // the SKILL.md is the runtime contract.
  assert.deepEqual(p.autoTier.map((r) => r.number), [1]);
  assert.deepEqual(p.humanTier.map((r) => r.number).sort(), [2, 3]);
});
```

- [ ] **Step 2: Resume test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/resume.test.mjs`:

```javascript
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
```

- [ ] **Step 3: Run both, verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/severity-routing.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/integration/resume.test.mjs`
Expected: PASS — 2 tests.

- [ ] **Step 4: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/integration/severity-routing.test.mjs .claude/skills/upstream-swarm/scripts/__tests__/integration/resume.test.mjs
git commit -m "test(upstream-swarm): integration severity-routing + resume"
```

---

## Task 19: Integration test — baseline-rot abort

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/__tests__/integration/baseline-abort.test.mjs`

- [ ] **Step 1: Write the test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/baseline-abort.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBaselineGate } from "../../baseline-gate.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "swarm-int-")); }

test("baseline gate red → swarm must abort before any issue work", () => {
  const dir = tmp();
  try {
    const r = runBaselineGate({
      workdir: join(dir, "wt"),
      logPath: join(dir, "baseline.log"),
      worktreeRunner: () => ({ status: 0, stdout: "" }),
      gateRunner: () => ({ pass: false, failTail: "vendor xlsx tarball missing\nENOENT dist-test/vendor/xlsx-0.20.3.tgz" }),
    });
    assert.equal(r.pass, false);
    assert.match(r.failTail, /vendor xlsx/);
    // Contract: when this returns pass:false, SKILL.md MUST not start any issue work.
    // We cannot assert that from JS alone; this test pins the gate contract.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/baseline-abort.test.mjs`
Expected: PASS — 1 test.

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/integration/baseline-abort.test.mjs
git commit -m "test(upstream-swarm): integration baseline-rot abort"
```

---

## Task 20: Full-skill smoke test + final wiring sanity

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/__tests__/integration/full-suite.test.mjs` (new)

A "did we wire it right" smoke test that imports everything top-level and
calls each entry point with a minimal happy fixture. Catches accidental
breakage of public exports between unit tests and the SKILL.md
orchestration.

- [ ] **Step 1: Write the smoke test**

Create `.claude/skills/upstream-swarm/scripts/__tests__/integration/full-suite.test.mjs`:

```javascript
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

    const baseline = runBaselineGate({ workdir: dir, logPath: join(dir, "b.log"), worktreeRunner: () => ({ status: 0 }), gateRunner: () => ({ pass: true, failTail: "" }) });
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
```

- [ ] **Step 2: Run and verify**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/full-suite.test.mjs`
Expected: PASS — 1 test.

- [ ] **Step 3: Run the entire test suite to confirm 40+ tests still green**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/*.mjs .claude/skills/upstream-swarm/scripts/__tests__/integration/*.mjs .claude/skills/upstream-merge/scripts/__tests__/*.mjs .claude/skills/upstream-fix/scripts/__tests__/*.mjs 2>&1 | tail -15`
Expected: All tests PASS. Count should be approximately:
- swarm unit (7 files): 7+6+9+5+3+8+4 = 42
- swarm integration (7 files): 1+1+2+1+1+1+1 = 8
- merge refute-panel: 10
- merge merge-pr: 9 (4 new + 5 existing)
- fix single-issue-mode: 4
- Total NEW tests: 68 (existing skill tests not counted)

- [ ] **Step 4: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/integration/full-suite.test.mjs
git commit -m "test(upstream-swarm): full-skill smoke test importing every public entry point"
```

---

## Final sanity

- [ ] Run the existing skill tests too (no regressions):
  ```bash
  node --test .claude/skills/upstream-merge/scripts/__tests__/*.mjs
  node --test .claude/skills/upstream-fix/scripts/__tests__/*.mjs
  ```
  Expected: all pre-existing tests green.

- [ ] Review the file layout matches the spec:
  ```bash
  ls .claude/skills/upstream-swarm/scripts/
  ls .claude/skills/upstream-swarm/scripts/__tests__/
  ls .claude/skills/upstream-swarm/scripts/__tests__/integration/
  ls .claude/skills/upstream-merge/scripts/refute-panel.mjs
  ls .claude/skills/upstream-fix/scripts/single-issue-mode.mjs
  ```
  Expected: all paths present.

- [ ] Squash-merge plan: each task above was its own commit. Do NOT squash —
  preserving per-task commits lets `git bisect` find any subtle regressions.

---

## Notes for the implementer

- **No `npm install`**: every new file imports only from Node built-ins
  and existing skill scripts. No new dependencies.
- **No `Workflow` tool calls inside the scripts**: the four lens subagents
  in Phase B (refute panel) and the per-issue fix dispatch in Phase B are
  invoked from SKILL.md / agent context, NOT from `.mjs` script bodies.
  This is the portability invariant for pi-dev compatibility.
- **Use `mkdtempSync` for every test that touches disk**: never write under
  the repo root. Clean up in `finally`.
- **Test runner**: `node --test`. No `jest`/`vitest`/`mocha`.
- **Match existing patterns**: read `.claude/skills/upstream-merge/scripts/merge-ledger.mjs`
  and `.claude/skills/upstream-fix/scripts/scheduler.mjs` for shape.
- **Backward compatibility**: existing `upstream-fix` bundled-PR mode and
  existing `upstream-merge` non-auto mode must remain untouched. Tests
  for those paths must still pass.
