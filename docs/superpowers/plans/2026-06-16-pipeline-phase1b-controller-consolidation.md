# Pipeline Phase 1B — Controller Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `swarm-control.mjs` controller spine by adding the remaining deterministic subcommands — `preflight`, `select`, `tick`, `record`, `retry`, `classify`, `abort-check`, `poll`, `merge`, `report`, `cleanup` — each a thin, tested wrapper around an already-tested function, so the entire upstream-port pipeline is driven through one CLI instead of dozens of inline `node -e` calls.

**Architecture:** Each subcommand imports an existing exported function (no sibling-script refactors) and returns a plain JSON object. `tick` is a **pure planner** (wraps `nextActions`) — it returns the work list; the executor subcommands (`record`, `poll`, `gate`, `merge`) do the work. This matches the approved spec's Workflow loop, which already calls `record`/`gate`/`merge` separately. Handlers are grouped into focused modules by responsibility; `swarm-control.mjs` composes them into `defaultHandlers`.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, injectable runner functions. Reuses the Phase 1A dispatcher (`swarm-control.mjs`) and the `parseFlags` camelCase mapping (so `--head-ref` → `headRef`).

**Critical lesson from Phase 1A:** unit tests that call handler functions with already-camelCased params can mask a CLI flag→param mismatch. **Every subcommand task in this plan includes a CLI-seam test** that drives the documented flags through `dispatch`/`parseFlags` and asserts the handler receives the params it destructures.

---

## Reused functions (import; do NOT modify)

| Function | Module | Signature → return |
|---|---|---|
| `preflightCleanMain` | `upstream-swarm/scripts/preflight-clean-main.mjs` | `({base, head, gitRunner, fetch})` → `{clean, ahead, behind, message}` |
| `runBaselineGate` | `upstream-swarm/scripts/baseline-gate.mjs` | `({workdir, logPath, base, worktreeRunner, provisionDeps, gateRunner})` → `{pass, failTail, logPath}` |
| `selectAndPartition` | `upstream-swarm/scripts/select-issues.mjs` | `({filter, configPath, repo, guidanceDir, outPath})` → `{autoTier, humanTier, needsTriage, totalAuto, totalHuman, totalNeedsTriage}` |
| `planWaves` | `upstream-swarm/scripts/wave-plan.mjs` | `(issues, {maxWaveSize})` → wave plan object |
| `initSwarmLedger` | `upstream-swarm/scripts/swarm-ledger.mjs` | `(path, {date, filter, issues})` → ledger |
| `nextActions` | `upstream-swarm/scripts/scheduler.mjs` | `(ledger, caps, now)` → action[] |
| `recordTransition` | `upstream-swarm/scripts/swarm-ledger.mjs` | `(path, number, nextState, payload)` → issue |
| `recordRetry` | `upstream-swarm/scripts/swarm-ledger.mjs` | `(path, number, reason)` → issue |
| `readRefuteVerdict` | `upstream-swarm/scripts/swarm-ledger.mjs` | `(ledger, number)` → "approve"\|… \| null |
| `readLedger` | `_common/scripts/base-ledger.mjs` (re-exported by swarm-ledger) | `(path)` → ledger\|null |
| `classifyFailure` | `upstream-swarm/scripts/transient-classifier.mjs` | `(ctx)` → `{category, reason}` |
| `computeSignature` | `upstream-swarm/scripts/abort-streak.mjs` | `({stage, failTail})` → string |
| `recordQuarantineSignature` | `upstream-swarm/scripts/abort-streak.mjs` | `(ledger, signature, {threshold})` → `{abort, count, signature}` |
| `pollPrChecks` | `upstream-swarm/scripts/poll-pr-checks.mjs` | `({prNumber, repo, configPath, ghRunner})` → `{state, …}` |
| `mergePr` | `upstream-merge/scripts/merge-pr.mjs` | `({number, repo, auto, refuteVerdict, refuteReason, ghRunner})` → `{merged, sha, blockedBy?, reason?}` |
| `renderReport` | `upstream-swarm/scripts/write-report.mjs` | `(ledger)` → markdown string |
| `pruneWorktrees` | `_common/scripts/worktree.mjs` | `(registryPath, {ttlMs})` → pruned[] (verify exact signature in Task 1) |

---

## File Structure

**Create (handler modules in `.claude/skills/upstream-swarm/scripts/`):**
- `control-plan.mjs` — `tick`, `report`, `cleanup` handlers
- `control-phase-a.mjs` — `preflight`, `select` handlers
- `control-ledger.mjs` — `record`, `retry`, `classify`, `abortCheck` handlers
- `control-pr.mjs` — `poll`, `merge` handlers
- Matching `__tests__/control-plan.test.mjs`, `control-phase-a.test.mjs`, `control-ledger.test.mjs`, `control-pr.test.mjs`

**Modify:**
- `.claude/skills/upstream-swarm/scripts/swarm-control.mjs` — extend `KNOWN_COMMANDS` + `defaultHandlers` to register the new subcommands.
- `.claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs` — add CLI-seam tests.
- `.claude/skills/upstream-swarm/SKILL.md` — Phase A/B prose references `swarm-control.mjs <subcommand>`.

---

## Task 1: `control-plan.mjs` — `tick`, `report`, `cleanup`

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/control-plan.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs`
- Modify: `swarm-control.mjs` (register `tick`, `report`, `cleanup`)

- [ ] **Step 1: Confirm `pruneWorktrees` signature**

Run: `grep -nE "export function pruneWorktrees" .claude/skills/_common/scripts/worktree.mjs` and read the function to confirm its parameters. If it is `pruneWorktrees(registryPath, { ttlMs })`, the code below is correct; if the shape differs, adapt the `cleanup` handler to the real signature (do not modify `worktree.mjs`).

- [ ] **Step 2: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick, report } from "../control-plan.mjs";

function tmpLedger(obj) {
  const dir = mkdtempSync(join(tmpdir(), "ctl-plan-"));
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify(obj));
  return { dir, path };
}

const LEDGER = {
  version: 1, date: "2026-06-16", filter: "x", abortStreak: { signature: null, count: 0 },
  issues: { "5": { state: "selected", severity: "nice-to-have-fix", retryCount: 0, targetFiles: ["a.ts"], prNumber: null, refute: null } },
};

test("tick returns scheduler actions for the ledger", () => {
  const { path } = tmpLedger(LEDGER);
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };
  const out = tick({ ledger: path, caps: JSON.stringify(caps), now: "1000" });
  assert.ok(Array.isArray(out.actions));
  assert.equal(out.actions[0].kind, "start-fix");
  assert.equal(out.actions[0].issueNumber, 5);
});

test("report renders markdown to the out path and returns it", () => {
  const { path, dir } = tmpLedger(LEDGER);
  const out = join(dir, "report.md");
  const r = report({ ledger: path, out });
  assert.equal(r.out, out);
  const md = readFileSync(out, "utf-8");
  assert.match(md, /Upstream-Swarm Report/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs`
Expected: FAIL — `Cannot find module '../control-plan.mjs'`.

- [ ] **Step 4: Write implementation**

```js
// .claude/skills/upstream-swarm/scripts/control-plan.mjs
#!/usr/bin/env node
/**
 * control-plan.mjs — read/planner controller subcommands: `tick` (pure planner
 * wrapping the scheduler), `report` (rollup), `cleanup` (worktree TTL prune).
 */
import { writeFileSync } from "node:fs";
import { readLedger } from "./swarm-ledger.mjs";
import { nextActions } from "./scheduler.mjs";
import { renderReport } from "./write-report.mjs";
import { pruneWorktrees } from "../../_common/scripts/worktree.mjs";

const DEFAULT_REGISTRIES = [
  ".planning/upstream-fixes/.worktree-registry.json",
  ".planning/upstream-swarms/.worktree-registry.json",
];

export function tick({ ledger, caps, now }) {
  if (!ledger) throw new Error("tick requires --ledger <path>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  const capsObj = typeof caps === "string" ? JSON.parse(caps) : (caps ?? {});
  const nowMs = now != null ? Number(now) : Date.now();
  return { actions: nextActions(led, capsObj, nowMs) };
}

export function report({ ledger, out }) {
  if (!ledger || !out) throw new Error("report requires --ledger <path> --out <path>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  writeFileSync(out, renderReport(led));
  return { out };
}

export function cleanup({ ttlHours, registry } = {}) {
  const ttlMs = Number(ttlHours ?? 24) * 3600 * 1000;
  const registries = registry ? [registry] : DEFAULT_REGISTRIES;
  const pruned = [];
  for (const reg of registries) {
    try { pruned.push(...pruneWorktrees(reg, { ttlMs })); } catch { /* missing registry → no-op */ }
  }
  return { pruned, count: pruned.length };
}
```

- [ ] **Step 5: Register in `swarm-control.mjs`**

In `swarm-control.mjs`, add the import and extend `KNOWN_COMMANDS` + `defaultHandlers`:

```js
import { tick, report, cleanup } from "./control-plan.mjs";
```
Add `"tick", "report", "cleanup"` to `KNOWN_COMMANDS`. In `defaultHandlers` add:
```js
    "tick": (args) => tick(parseFlags(args)),
    "report": (args) => report(parseFlags(args)),
    "cleanup": (args) => cleanup(parseFlags(args)),
```

- [ ] **Step 6: Run tests to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs`
Expected: PASS — both tests.

- [ ] **Step 7: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/control-plan.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs \
        .claude/skills/upstream-swarm/scripts/swarm-control.mjs
git commit -m "feat(swarm-control): tick/report/cleanup subcommands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `control-phase-a.mjs` — `preflight`, `select`

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/control-phase-a.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/control-phase-a.test.mjs`
- Modify: `swarm-control.mjs`

**Contract:**
- `preflight({ workdir, log, base, skipBaseline, gitRunner, worktreeRunner, provisionDeps, gateRunner })` → `{ clean, cleanMessage, baseline: {pass, failTail, logPath} | null, ok }`. `ok` is `clean && (skipBaseline || baseline.pass)`. **`preflight` is `async`** — `runBaselineGate` returns a promise when its gate runner is async (the real default), so the handler awaits it. It forwards `worktreeRunner`/`provisionDeps`/`gateRunner` to `runBaselineGate` (the test MUST stub these — otherwise `runBaselineGate` creates a real git worktree and provisions node_modules).
- `select({ filter, configPath, repo, guidanceDir, out, ledgerOut, date, maxWaveSize })` → `{ totalAuto, totalHuman, totalNeedsTriage, waveCount, ledger: <path> | null }`. Runs `selectAndPartition`, then `planWaves` over the auto+human tiers, then (if `ledgerOut`) `initSwarmLedger`. `select` has no dedicated behavioral test here — `selectAndPartition`/`planWaves`/`initSwarmLedger` are already covered by their own suites and `select` is a thin compose; its flag mapping is covered by the CLI-seam test in Task 6.

**How the reused functions actually behave (verified against source — match the stubs to this):**
- `preflightCleanMain({ base, head, gitRunner, fetch })` calls `gitRunner(["fetch","origin","--prune"])`, then **two** counts: `ahead = Number(gitRunner(["rev-list","--count","<base>..<head>"]))` and `behind = Number(gitRunner(["rev-list","--count","<head>..<base>"]))`. `clean` is `ahead === 0`. Defaults: `base="origin/main"`, `head="main"`, so the ahead range arg is `"origin/main..main"`, behind is `"main..origin/main"`.
- `runBaselineGate({ workdir, logPath, base, worktreeRunner, provisionDeps, gateRunner })` calls `worktreeRunner(["worktree","remove",...])`, `worktreeRunner(["worktree","add",...])`, `provisionDeps({workdir})`, then `gateRunner({workdir, logPath})`; it returns `{pass, failTail, logPath}` (a promise if `gateRunner` is async). A **sync** stub gate runner makes it return synchronously, but `preflight` still `await`s it (awaiting a non-promise is fine).

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/control-phase-a.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { preflight } from "../control-phase-a.mjs";

// Stub git so preflightCleanMain's two rev-list counts are controlled by range.
function gitStub({ ahead = "0", behind = "0" }) {
  return (args) => {
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-list") {
      const range = args[2];
      if (range === "origin/main..main") return ahead;   // ahead count
      if (range === "main..origin/main") return behind;   // behind count
      return "0";
    }
    return "";
  };
}
const noopWorktree = () => "";
const noopProvision = () => {};

test("preflight is ok when clean and baseline passes", async () => {
  const r = await preflight({
    skipBaseline: false, workdir: "/tmp/wt", log: "/tmp/b.log",
    gitRunner: gitStub({ ahead: "0" }),
    worktreeRunner: noopWorktree, provisionDeps: noopProvision,
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.equal(r.clean, true);
  assert.equal(r.baseline.pass, true);
  assert.equal(r.ok, true);
});

test("preflight not ok when local main is ahead of origin", async () => {
  const r = await preflight({
    skipBaseline: true,
    gitRunner: gitStub({ ahead: "2" }),
  });
  assert.equal(r.clean, false);
  assert.equal(r.ok, false);
  assert.equal(r.baseline, null);
});

test("preflight not ok when baseline gate fails", async () => {
  const r = await preflight({
    skipBaseline: false, workdir: "/tmp/wt", log: "/tmp/b.log",
    gitRunner: gitStub({ ahead: "0" }),
    worktreeRunner: noopWorktree, provisionDeps: noopProvision,
    gateRunner: () => ({ pass: false, failTail: "boom" }),
  });
  assert.equal(r.clean, true);
  assert.equal(r.baseline.pass, false);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-phase-a.test.mjs`
Expected: FAIL — `Cannot find module '../control-phase-a.mjs'`.

- [ ] **Step 3: Write implementation**

```js
// .claude/skills/upstream-swarm/scripts/control-phase-a.mjs
#!/usr/bin/env node
/**
 * control-phase-a.mjs — Phase A controller subcommands: `preflight`
 * (clean-main + baseline gate) and `select` (select + partition + wave-plan +
 * ledger init). Thin wrappers over the existing exported functions.
 */
import { preflightCleanMain } from "./preflight-clean-main.mjs";
import { runBaselineGate } from "./baseline-gate.mjs";
import { selectAndPartition } from "./select-issues.mjs";
import { planWaves } from "./wave-plan.mjs";
import { initSwarmLedger } from "./swarm-ledger.mjs";

export async function preflight({
  workdir, log, base = "origin/main", skipBaseline = false,
  gitRunner, worktreeRunner, provisionDeps, gateRunner,
} = {}) {
  // Only forward injectable runners when provided (tests); otherwise let the
  // reused functions use their real defaults (production CLI path).
  const cm = preflightCleanMain(gitRunner ? { base, gitRunner } : { base });
  let baseline = null;
  if (!skipBaseline) {
    const gateOpts = { workdir, logPath: log, base };
    if (worktreeRunner) gateOpts.worktreeRunner = worktreeRunner;
    if (provisionDeps) gateOpts.provisionDeps = provisionDeps;
    if (gateRunner) gateOpts.gateRunner = gateRunner;
    baseline = await runBaselineGate(gateOpts);
  }
  const ok = cm.clean && (skipBaseline || (baseline && baseline.pass));
  return { clean: cm.clean, cleanMessage: cm.message, baseline, ok };
}

export function select({ filter, configPath, repo, guidanceDir, out, ledgerOut, date, maxWaveSize = 3 }) {
  const filterObj = typeof filter === "string" ? JSON.parse(filter) : (filter ?? {});
  const part = selectAndPartition({ filter: filterObj, configPath, repo, guidanceDir, outPath: out });
  const allIssues = [...part.autoTier, ...part.humanTier];
  const waves = planWaves(allIssues, { maxWaveSize: Number(maxWaveSize) });
  let ledger = null;
  if (ledgerOut) {
    initSwarmLedger(ledgerOut, { date, filter: JSON.stringify(filterObj), issues: allIssues });
    ledger = ledgerOut;
  }
  const waveCount = waves.length;
  return { totalAuto: part.totalAuto, totalHuman: part.totalHuman, totalNeedsTriage: part.totalNeedsTriage, waveCount, ledger };
}
```

NOTE on `waveCount`: `planWaves` returns a plain array of waves (`Array<Array<{number, targetFiles}>>` — see `wave-plan.mjs`), so `waveCount` is simply `waves.length`. (An earlier draft hedged with an `Array.isArray(...) ? ... : (waves.waves ?? waves.plan?.length ?? 0)` fallback under the mistaken assumption that `planWaves` returned `{ plan, total, waves }`; that object-shape branch was dead and has been dropped.)

- [ ] **Step 4: Register in `swarm-control.mjs`**

Add `import { preflight, select } from "./control-phase-a.mjs";`, add `"preflight", "select"` to `KNOWN_COMMANDS`, and in `defaultHandlers`:
```js
    "preflight": (args) => preflight(parseFlags(args)),
    "select": (args) => select(parseFlags(args)),
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-phase-a.test.mjs`
Expected: PASS — three tests.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/control-phase-a.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-phase-a.test.mjs \
        .claude/skills/upstream-swarm/scripts/swarm-control.mjs
git commit -m "feat(swarm-control): preflight/select Phase A subcommands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `control-ledger.mjs` — `record`, `retry`

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/control-ledger.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs`
- Modify: `swarm-control.mjs`

**Contract:**
- `record({ ledger, issue, state, payload })` → the updated issue. `payload` is a JSON string (CLI) or object; parsed and passed to `recordTransition`. Validates the transition (delegated to `recordTransition`, which throws on illegal transitions — surface that error).
- `retry({ ledger, issue, reason })` → updated issue via `recordRetry` (enforces the 1-retry cap; surface its throw).

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record, retry } from "../control-ledger.mjs";
import { readLedger } from "../swarm-ledger.mjs";

function tmpLedger() {
  const dir = mkdtempSync(join(tmpdir(), "ctl-led-"));
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify({
    version: 1, date: "d", filter: "f", abortStreak: { signature: null, count: 0 },
    issues: { "5": { state: "fixing", severity: "nice-to-have-fix", retryCount: 0, targetFiles: [], prNumber: null, refute: null } },
  }));
  return path;
}

test("record applies a valid transition with payload", () => {
  const path = tmpLedger();
  const issue = record({ ledger: path, issue: "5", state: "fix-ok", payload: JSON.stringify({ prNumber: 400 }) });
  assert.equal(issue.state, "fix-ok");
  assert.equal(issue.prNumber, 400);
  assert.equal(readLedger(path).issues["5"].state, "fix-ok");
});

test("record rejects an illegal transition", () => {
  const path = tmpLedger();
  assert.throws(() => record({ ledger: path, issue: "5", state: "merged" }), /invalid transition/i);
});

test("retry increments retryCount and moves to retrying", () => {
  const path = tmpLedger();
  // fixing → fix-failed first (retry is valid from fix-failed/ci-red)
  record({ ledger: path, issue: "5", state: "fix-failed", payload: JSON.stringify({ reason: "x" }) });
  const issue = retry({ ledger: path, issue: "5", reason: "transient" });
  assert.equal(issue.state, "retrying");
  assert.equal(issue.retryCount, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs`
Expected: FAIL — `Cannot find module '../control-ledger.mjs'`.

- [ ] **Step 3: Write implementation**

```js
// .claude/skills/upstream-swarm/scripts/control-ledger.mjs
#!/usr/bin/env node
/**
 * control-ledger.mjs — ledger-writer subcommands: `record` (validated state
 * transition) and `retry` (1-retry-cap enforced). The controller is the sole
 * writer of the ledger; illegal transitions throw (surfaced as a CLI error).
 */
import { recordTransition, recordRetry } from "./swarm-ledger.mjs";

export function record({ ledger, issue, state, payload }) {
  if (!ledger) throw new Error("record requires --ledger <path>");
  if (issue == null) throw new Error("record requires --issue <n>");
  if (!state) throw new Error("record requires --state <nextState>");
  const payloadObj = typeof payload === "string" ? JSON.parse(payload) : (payload ?? {});
  return recordTransition(ledger, Number(issue), state, payloadObj);
}

export function retry({ ledger, issue, reason }) {
  if (!ledger) throw new Error("retry requires --ledger <path>");
  if (issue == null) throw new Error("retry requires --issue <n>");
  return recordRetry(ledger, Number(issue), reason ?? "");
}
```

- [ ] **Step 4: Register in `swarm-control.mjs`**

Add `import { record, retry } from "./control-ledger.mjs";`, add `"record", "retry"` to `KNOWN_COMMANDS`, and in `defaultHandlers`:
```js
    "record": (args) => record(parseFlags(args)),
    "retry": (args) => retry(parseFlags(args)),
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs`
Expected: PASS — three tests.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/control-ledger.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs \
        .claude/skills/upstream-swarm/scripts/swarm-control.mjs
git commit -m "feat(swarm-control): record/retry ledger-writer subcommands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `control-ledger.mjs` (extend) — `classify`, `abort-check`

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/control-ledger.mjs` (add two exports)
- Modify: `.claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs` (add tests)
- Modify: `swarm-control.mjs`

**Contract:**
- `classify({ stage, failTail, ...ctx })` → `{ category, reason, signature }` (pure). Calls `classifyFailure(ctx)` and `computeSignature({stage, failTail})`. Boolean/extra ctx flags (e.g. `firstRunRed`, `touchedFilesDisjoint`) pass through.
- `abortCheck({ ledger, signature, threshold })` → `{ abort, count, signature }`. Reads the ledger, calls `recordQuarantineSignature`, writes it back.

- [ ] **Step 1: Add the failing tests**

Append to `control-ledger.test.mjs`:

```js
import { classify, abortCheck } from "../control-ledger.mjs";
import { writeLedger } from "../swarm-ledger.mjs";

test("classify returns category + signature for a local-gate real failure", () => {
  const r = classify({ stage: "local-gate", failTail: "AssertionError: nope" });
  assert.equal(r.category, "real");
  assert.match(r.signature, /^local-gate\|/);
});

test("abort-check increments the streak and reports abort at threshold", () => {
  const path = (() => {
    const dir = mkdtempSync(join(tmpdir(), "ctl-abort-"));
    const p = join(dir, "l.json");
    writeFileSync(p, JSON.stringify({ version: 1, abortStreak: { signature: null, count: 0 }, issues: {} }));
    return p;
  })();
  const sig = "local-gate|generic|x";
  let r;
  for (let i = 0; i < 3; i++) r = abortCheck({ ledger: path, signature: sig, threshold: "3" });
  assert.equal(r.count, 3);
  assert.equal(r.abort, true);
  assert.equal(readLedger(path).abortStreak.count, 3);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs`
Expected: FAIL — `classify`/`abortCheck` are not exported.

- [ ] **Step 3: Extend `control-ledger.mjs`**

Add imports and exports:

```js
import { readLedger, writeLedger } from "./swarm-ledger.mjs";
import { classifyFailure } from "./transient-classifier.mjs";
import { computeSignature, recordQuarantineSignature } from "./abort-streak.mjs";

export function classify(ctx) {
  const { category, reason } = classifyFailure(ctx);
  const signature = computeSignature({ stage: ctx.stage, failTail: ctx.failTail });
  return { category, reason, signature };
}

export function abortCheck({ ledger, signature, threshold }) {
  if (!ledger) throw new Error("abort-check requires --ledger <path>");
  if (!signature) throw new Error("abort-check requires --signature <s>");
  const led = readLedger(ledger);
  if (!led) throw new Error(`ledger not found at ${ledger}`);
  const res = recordQuarantineSignature(led, signature, { threshold: Number(threshold ?? 5) });
  writeLedger(ledger, led);
  return res;
}
```

(Note: `recordTransition`/`recordRetry` are already imported at the top from Task 3; add only the new imports. `swarm-ledger.mjs` re-exports `readLedger`/`writeLedger` from `base-ledger.mjs`.)

- [ ] **Step 4: Register in `swarm-control.mjs`**

Add `classify`, `abortCheck` to the existing `control-ledger.mjs` import. Add `"classify", "abort-check"` to `KNOWN_COMMANDS`. In `defaultHandlers`:
```js
    "classify": (args) => classify(parseFlags(args)),
    "abort-check": (args) => abortCheck(parseFlags(args)),
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs`
Expected: PASS — five tests (three from Task 3 + two new).

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/control-ledger.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-ledger.test.mjs \
        .claude/skills/upstream-swarm/scripts/swarm-control.mjs
git commit -m "feat(swarm-control): classify/abort-check subcommands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `control-pr.mjs` — `poll`, `merge` (merge is verdict-gated)

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/control-pr.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/control-pr.test.mjs`
- Modify: `swarm-control.mjs`

**Contract:**
- `poll({ pr, repo, configPath, ghRunner })` → the `pollPrChecks` result (`{state, …}`).
- `merge({ pr, issue, ledger, repo, refuteReason, mergeFn, readLedgerFn })` → `{merged, sha?, blockedBy?, reason}`. **MUST read the recorded refute verdict from the ledger and refuse to merge unless it is exactly `"approve"`** (defense-in-depth on top of `mergePr`'s own `--auto` gate). On approve, calls `mergePr({ number: pr, auto: true, refuteVerdict: "approve", refuteReason })`. `mergeFn`/`readLedgerFn` are injectable for testing.

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/control-pr.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge } from "../control-pr.mjs";

const ledgerWithVerdict = (v) => ({ issues: { "5": { refute: { tally: { panelVerdict: v } } } } });

test("merge proceeds when the ledger verdict is approve", () => {
  let mergedWith = null;
  const r = merge({
    pr: 400, issue: 5, ledger: "x", refuteReason: "panel ok",
    readLedgerFn: () => ledgerWithVerdict("approve"),
    mergeFn: (opts) => { mergedWith = opts; return { merged: true, sha: "abc1234" }; },
  });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "abc1234");
  assert.equal(mergedWith.number, 400);
  assert.equal(mergedWith.auto, true);
  assert.equal(mergedWith.refuteVerdict, "approve");
});

test("merge refuses when the ledger verdict is not approve", () => {
  let called = false;
  const r = merge({
    pr: 400, issue: 5, ledger: "x",
    readLedgerFn: () => ledgerWithVerdict("refute"),
    mergeFn: () => { called = true; return { merged: true }; },
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute");
  assert.equal(called, false); // mergeFn never invoked
});

test("merge refuses when there is no recorded verdict", () => {
  const r = merge({
    pr: 400, issue: 5, ledger: "x",
    readLedgerFn: () => ({ issues: { "5": { refute: null } } }),
    mergeFn: () => ({ merged: true }),
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-pr.test.mjs`
Expected: FAIL — `Cannot find module '../control-pr.mjs'`.

- [ ] **Step 3: Write implementation**

```js
// .claude/skills/upstream-swarm/scripts/control-pr.mjs
#!/usr/bin/env node
/**
 * control-pr.mjs — PR-side controller subcommands: `poll` (one non-blocking CI
 * check) and `merge` (verdict-gated squash-merge). `merge` reads the recorded
 * refute panel verdict from the ledger and refuses unless it is exactly
 * "approve" — defense-in-depth on top of merge-pr's own --auto gate.
 */
import { pollPrChecks } from "./poll-pr-checks.mjs";
import { readRefuteVerdict, readLedger } from "./swarm-ledger.mjs";
import { mergePr } from "../../upstream-merge/scripts/merge-pr.mjs";

export function poll({ pr, repo, configPath, ghRunner }) {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) throw new Error(`poll requires integer --pr: ${pr}`);
  return pollPrChecks(ghRunner ? { prNumber, repo, configPath, ghRunner } : { prNumber, repo, configPath });
}

export function merge({
  pr, issue, ledger, repo, refuteReason,
  mergeFn = mergePr,
  readLedgerFn = readLedger,
}) {
  const prNumber = Number(pr);
  const issueNumber = Number(issue);
  if (!Number.isInteger(prNumber)) throw new Error(`merge requires integer --pr: ${pr}`);
  if (!Number.isInteger(issueNumber)) throw new Error(`merge requires integer --issue: ${issue}`);
  if (!ledger) throw new Error("merge requires --ledger <path>");

  const led = readLedgerFn(ledger);
  const verdict = readRefuteVerdict(led, issueNumber);
  if (verdict !== "approve") {
    return { merged: false, blockedBy: "refute", reason: `refute verdict is ${verdict ?? "missing"}; refusing to merge` };
  }
  return mergeFn({ number: prNumber, repo, auto: true, refuteVerdict: "approve", refuteReason: refuteReason ?? "" });
}
```

- [ ] **Step 4: Register in `swarm-control.mjs`**

Add `import { poll, merge } from "./control-pr.mjs";`, add `"poll", "merge"` to `KNOWN_COMMANDS`, and in `defaultHandlers`:
```js
    "poll": (args) => poll(parseFlags(args)),
    "merge": (args) => merge(parseFlags(args)),
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-pr.test.mjs`
Expected: PASS — three tests.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/control-pr.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-pr.test.mjs \
        .claude/skills/upstream-swarm/scripts/swarm-control.mjs
git commit -m "feat(swarm-control): poll/merge subcommands (merge verdict-gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: CLI-seam tests for every new subcommand (the Phase 1A lesson)

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`

Drive each subcommand's documented flags through `dispatch` with a stub handler and assert `parseFlags` produces the exact param names the real handler destructures. This catches kebab→camel mismatches (e.g. `--config-path` → `configPath`, `--ledger-out` → `ledgerOut`, `--max-wave-size` → `maxWaveSize`, `--skip-baseline` → `skipBaseline`, `--ttl-hours` → `ttlHours`).

- [ ] **Step 1: Add the seam test**

Append to `swarm-control.test.mjs`:

```js
test("documented multi-word flags map to the params each handler destructures", () => {
  const cases = [
    { flags: ["--ledger", "l", "--caps", "{}", "--now", "1"], expect: { ledger: "l", caps: "{}", now: "1" } },
    { flags: ["--ledger", "l", "--out", "o"], expect: { ledger: "l", out: "o" } },
    { flags: ["--ttl-hours", "12"], expect: { ttlHours: "12" } },
    { flags: ["--skip-baseline", "--workdir", "w", "--log", "g"], expect: { skipBaseline: true, workdir: "w", log: "g" } },
    { flags: ["--config-path", "c", "--guidance-dir", "d", "--ledger-out", "lo", "--max-wave-size", "3"],
      expect: { configPath: "c", guidanceDir: "d", ledgerOut: "lo", maxWaveSize: "3" } },
    { flags: ["--ledger", "l", "--issue", "5", "--state", "fix-ok", "--payload", "{}"],
      expect: { ledger: "l", issue: "5", state: "fix-ok", payload: "{}" } },
    { flags: ["--ledger", "l", "--signature", "s", "--threshold", "5"], expect: { ledger: "l", signature: "s", threshold: "5" } },
    { flags: ["--pr", "400", "--issue", "5", "--ledger", "l", "--refute-reason", "ok"],
      expect: { pr: "400", issue: "5", ledger: "l", refuteReason: "ok" } },
  ];
  for (const { flags, expect } of cases) {
    assert.deepEqual(parseFlags(flags), expect, `flags ${flags.join(" ")}`);
  }
});
```

- [ ] **Step 2: Run to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`
Expected: PASS (the `parseFlags` camelCase mapping from Phase 1A already handles every case).

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs
git commit -m "test(swarm-control): CLI-seam coverage for all Phase 1B subcommand flags

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Update `upstream-swarm` SKILL.md to drive Phase A/B through `swarm-control`

**Files:**
- Modify: `.claude/skills/upstream-swarm/SKILL.md`

The skill currently instructs the operator to run `preflight-clean-main.mjs`, `baseline-gate.mjs`, `select-issues.mjs`, `wave-plan.mjs`, `scheduler.mjs`, `poll-pr-checks.mjs`, inline `swarm-ledger` `node -e`, `merge-pr.mjs`, `write-report.mjs`, and `clean-worktrees.mjs` directly. Update the Phase A steps and the Phase B action table to call the consolidated subcommands.

- [ ] **Step 1: Map each existing instruction to its subcommand**

Run: `grep -nE "preflight-clean-main|baseline-gate|select-issues|wave-plan|scheduler.mjs|poll-pr-checks|swarm-ledger|merge-pr.mjs|write-report|clean-worktrees" .claude/skills/upstream-swarm/SKILL.md`
For each hit, replace the direct script invocation with the matching `swarm-control.mjs <subcommand>` call:
- `preflight-clean-main.mjs` + `baseline-gate.mjs` → `swarm-control.mjs preflight --workdir <…> --log <…>`
- `select-issues.mjs` + `wave-plan.mjs` + ledger-init `node -e` → `swarm-control.mjs select --filter '<json>' --out <…> --ledger-out <…> --date <…> --max-wave-size 3`
- `scheduler.mjs` → `swarm-control.mjs tick --ledger <path> --caps '<json>'`
- `poll-pr-checks.mjs <pr>` → `swarm-control.mjs poll --pr <pr>`
- inline `recordTransition`/`recordRetry` `node -e` → `swarm-control.mjs record --ledger <path> --issue <n> --state <s> --payload '<json>'` / `swarm-control.mjs retry --ledger <path> --issue <n> --reason <r>`
- classifier + abort-streak `node -e` → `swarm-control.mjs classify --stage <s> --fail-tail <t>` then `swarm-control.mjs abort-check --ledger <path> --signature <s> --threshold <n>`
- `merge-pr.mjs <pr> --auto …` → `swarm-control.mjs merge --pr <pr> --issue <n> --ledger <path> --refute-reason '<r>'`
- `write-report.mjs` → `swarm-control.mjs report --ledger <path> --out <path>`
- `clean-worktrees.mjs` → `swarm-control.mjs cleanup --ttl-hours 24`

Keep the `gate` (#3) and `verify-fix` (#4) references from Phase 1A as-is. Preserve the prose around each (the locked invariants, the "never gate in a live lane's worktree" note, the severity routing). Do NOT change the state machine or caps semantics.

- [ ] **Step 2: Verify**

Run: `grep -nE "swarm-control.mjs (preflight|select|tick|poll|record|retry|classify|abort-check|merge|report|cleanup)" .claude/skills/upstream-swarm/SKILL.md`
Expected: at least one match per subcommand.

Run: `grep -nE "node -e .*swarm-ledger|scheduler.mjs|merge-pr.mjs" .claude/skills/upstream-swarm/SKILL.md`
Expected: no remaining direct invocations in the Phase A/B operational steps (references inside the "References" section or design links are fine).

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/SKILL.md
git commit -m "docs(upstream-swarm): drive Phase A/B through swarm-control subcommands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full sweep

- [ ] **Step 1: Run all controller tests + the existing swarm suite**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs`
Expected: all PASS (107 from Phase 1A + the new Phase 1B tests), exit 0.

- [ ] **Step 2: Smoke-test the CLI dispatch for an unknown + a real read-only command**

Run: `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs bogus; echo "exit=$?"`
Expected: JSON error `{"error":"unknown command: bogus"}` on stderr, `exit=1`.

- [ ] **Step 3: Commit any fixture updates**

```bash
git add -A && git commit -m "test(swarm-control): Phase 1B green sweep" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Phase 1B subcommands from the design doc — preflight, select(+plan), tick, record, retry(implied by record-cap), classify, abort-check, poll, merge, report, cleanup — all have tasks. `tick` is a pure planner per the spec's own Workflow loop (which calls record/gate/merge separately). The driver itself (#2) and #6/#7 remain Phase 2/3.
- **Phase 1A lesson applied:** Task 6 adds CLI-seam tests for every multi-word flag, so a kebab→camel mismatch (the #3 bug) cannot recur silently.
- **Verdict gate:** `merge` (Task 5) refuses unless the ledger records `approve` — tested for approve / refute / missing.
- **No sibling-script refactors:** every subcommand imports an existing exported function (`preflightCleanMain`, `runBaselineGate`, `selectAndPartition`, `planWaves`, `initSwarmLedger`, `nextActions`, `recordTransition`, `recordRetry`, `classifyFailure`, `computeSignature`, `recordQuarantineSignature`, `pollPrChecks`, `mergePr`, `renderReport`, `pruneWorktrees`).
- **Two verify-against-source steps** (Task 1 Step 1 `pruneWorktrees`; Task 2 Step 3 `planWaves` count field) guard the two places where the reused function's exact shape must be confirmed rather than assumed.
- **Type consistency:** handler param names are camelCase to match `parseFlags` output; every documented flag in Task 6 maps to a destructured param in Tasks 1-5.
