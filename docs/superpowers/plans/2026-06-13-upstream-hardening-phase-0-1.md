# Upstream Pipeline Hardening — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the review findings against real code (Phase 0), then extract a `.claude/skills/_common/` module that breaks the skill↔skill import cycles and the 3× ledger duplication, without changing any observable behavior (Phase 1).

**Architecture:** Phase 0 is investigation only — it writes verdicts to a findings doc and changes no production code. Phase 1 is a behavior-preserving refactor: a new `_common/scripts/` holds shared primitives (`base-ledger.mjs`, `worktree.mjs`, relocated `evaluate-checks.mjs` / `select-issues.mjs` / `issue-update.mjs` / `run-gates.mjs`); the four skills import from `_common` instead of from each other. Skill-specific ledger modules stay in place and **re-export** the shared read/write primitives so their many internal importers need no change.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, `gh` CLI, `git worktree`. No build step for these scripts. Tests run directly with `node --test`.

**Source spec:** `docs/superpowers/specs/2026-06-13-upstream-pipeline-hardening-design.md`

---

## Preconditions (every implementation session)

- **Self-modification block:** editing files under `.claude/skills/` triggers the auto-mode self-modification block. Obtain explicit operator authorization at the start of each session before editing skill files.
- **`.claude/` is gitignored** (`.gitignore:43`); skill files are tracked via **`git add -f`**. Every commit that touches `.claude/skills/**` MUST force-add those paths. Files under `docs/` and `.planning/` are tracked normally (no `-f`).
- Run `npm ci` once if `node_modules` is absent (the worktree provisioning + any gate steps need it).

## Running the test suite

This canonical command runs all upstream-skill tests. **Baseline before any change: `pass 183, fail 0`.** As `_common` tests are added the pass count grows; it must never drop and `fail` must stay `0`.

```bash
node --test \
  .claude/skills/_common/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/__tests__/*.test.mjs \
  .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs
```

> Until Task 1.1 creates `_common/scripts/__tests__/`, the first glob line matches nothing and Node prints a `Could not find ...` warning per missing glob but still runs the rest; drop that first line for the Phase 0 baseline check, or run it after Task 1.1. Referenced below as **THE SUITE**.

---

# Phase 0 — Verify findings

**Phase 0 writes NO production code.** Each task reads the cited code, runs a probe, and records a verdict (`confirmed` / `debunked` / `reclassified`) with `file:line` evidence in the findings doc. The confirmed set becomes the scope for Phases 2–5.

### Task 0.1: Create the findings doc

**Files:**
- Create: `.planning/upstream-audits/2026-06-13-hardening-findings.md`

- [ ] **Step 1: Write the findings doc skeleton**

```markdown
# Upstream Hardening — Findings Verification (2026-06-13)

Verifies the candidate findings from the 2026-06-13 skill review against the
actual code. Status legend: `confirmed` (real, cite file:line) / `debunked`
(not a bug) / `reclassified` (real but belongs in a different phase).

Confirmed-by-direct-read already (pre-Phase-0):
- Cross-skill import cycle: CONFIRMED — trial-merge.mjs:18, poll-pr-checks.mjs:34,
  upstream-swarm/scripts/select-issues.mjs:12.
- Ledger duplication: CONFIRMED — identical readLedger/writeLedger in
  upstream-fix/scripts/ledger.mjs:10-18, upstream-merge/scripts/merge-ledger.mjs:9-17,
  upstream-swarm/scripts/swarm-ledger.mjs:38-46.
- "Inverted rebase classifier": DEBUNKED — transient-classifier.mjs only marks a
  rebase transient when `mainShaChanged && conflictMarkers`; a clean re-apply
  falls through to `real`. Correct as written.

## cherry-pick
## fix
## merge
## swarm

## Confirmed backlog (output)
| Finding | Status | Evidence | Target phase |
|---|---|---|---|
```

- [ ] **Step 2: Commit**

```bash
git add .planning/upstream-audits/2026-06-13-hardening-findings.md
git commit -m "docs(upstream): scaffold hardening findings verification doc"
```

### Task 0.2: Verify cherry-pick findings

**Files:**
- Modify: `.planning/upstream-audits/2026-06-13-hardening-findings.md` (the `## cherry-pick` section)
- Read-only: `.claude/skills/upstream-cherry-pick/scripts/{run-audit,build-issue-payload,dedup-check,fetch-pr-context}.mjs`, `.claude/skills/upstream-cherry-pick/SKILL.md`

- [ ] **Step 1: Investigate each candidate**

Check and record a verdict for each:
1. **Missing-guidance is silent.** Read `run-audit.mjs` around guidance handling and `build-issue-payload.mjs:201` (`renderImplementationGuidance`). Confirm whether a real (non-`--dry-run`) run with a selected sha lacking `guidance/<sha7>.md` still exits 0. Probe: `grep -nE "skip-guidance|Not yet analyzed|Analyzed" .claude/skills/upstream-cherry-pick/scripts/*.mjs`.
2. **Verdict-line parse fragility.** Read the `verdict:` parse in `run-audit.mjs` (regex `verdict:\s*(cherry-pick|manual-port|do-not-port)`). Confirm a header/comment before line 1 silently falls back to the risk-based label.
3. **Fuzzy dedup.** Read `dedup-check.mjs`. Confirm the `sha=<short> in:body` search + literal-trailer post-filter, and whether a prose mention can still collide.
4. **PR-context cache no-expiry.** Read `fetch-pr-context.mjs`. Confirm `_cache/pr-*.json` has no TTL/age check.

- [ ] **Step 2: Record verdicts** in the `## cherry-pick` section, each as: `- <finding> — STATUS — <file:line evidence> — target: Phase 2|5`.

- [ ] **Step 3: Commit**

```bash
git add .planning/upstream-audits/2026-06-13-hardening-findings.md
git commit -m "docs(upstream): verify cherry-pick findings"
```

### Task 0.3: Verify fix findings

**Files:**
- Modify: findings doc (`## fix`)
- Read-only: `.claude/skills/upstream-fix/scripts/{issue-update,worktree-setup,worktree-merge,scheduler,select-issues,record-result}.mjs`, `.claude/skills/upstream-fix/SKILL.md`

- [ ] **Step 1: Investigate**
1. **Non-idempotent issue close.** Read `issue-update.mjs`. Confirm `--close` calls `gh issue close` unconditionally (errors if already closed).
2. **Worktree cleanup on failure.** Read `worktree-setup.mjs` / `worktree-merge.mjs` + SKILL.md Phase D. Confirm failed lanes leave `.worktrees/` with no auto-prune.
3. **Reviewer rejection terminal.** Read the reviewer flow in SKILL.md + `record-result.mjs`. Confirm a rejection has no retry edge.
4. **`status:applied` resume gap.** Read `select-issues.mjs`. Confirm `--resume` re-selects an issue merged outside the skill (label absent).
5. **Ledger versioning absent.** Confirm `ledger.mjs` writes `version: 1` but never validates on read.

- [ ] **Step 2: Record verdicts** with `file:line` + target phase (2/3/5).
- [ ] **Step 3: Commit**

```bash
git add .planning/upstream-audits/2026-06-13-hardening-findings.md
git commit -m "docs(upstream): verify fix findings"
```

### Task 0.4: Verify merge findings

**Files:**
- Modify: findings doc (`## merge`)
- Read-only: `.claude/skills/upstream-merge/scripts/{trial-merge,merge-ledger,evaluate-checks,refute-panel,merge-pr,select-prs}.mjs`, `config.json`, `SKILL.md`

- [ ] **Step 1: Investigate**
1. **Stale trial-merge on resume.** Read `merge-ledger.mjs` (`localGate` field) + SKILL.md resume path. Confirm a cached `localGate` is never re-run on `--resume`.
2. **Hardcoded required-checks allowlist.** Read `config.json` + `evaluate-checks.mjs:53` (`loadAllowlist`). Confirm no validation against the live GitHub Actions config.
3. **Refute panel field loss.** Read `refute-panel.mjs` return shape vs `merge-ledger.mjs` `refute` storage. Confirm `confidence`/`blocking` are dropped.
4. **No retry/escalate for blocked PRs.** Confirm there is no `--retry`/`--unblock` path.

- [ ] **Step 2: Record verdicts** with `file:line` + target phase (3/5).
- [ ] **Step 3: Commit**

```bash
git add .planning/upstream-audits/2026-06-13-hardening-findings.md
git commit -m "docs(upstream): verify merge findings"
```

### Task 0.5: Verify swarm findings

**Files:**
- Modify: findings doc (`## swarm`)
- Read-only: `.claude/skills/upstream-swarm/scripts/{transient-classifier,swarm-ledger,baseline-gate,wave-plan,poll-pr-checks,scheduler}.mjs`, `SKILL.md`

- [ ] **Step 1: Investigate**
1. **Abort-streak crudeness.** Read the abort logic (SKILL.md + scheduler). Confirm raw `failTail` string comparison and no manual reset.
2. **Baseline-gate worktree leak.** Read `baseline-gate.mjs`. Confirm a failed gate leaves `.worktrees/upstream-swarm-baseline` with no documented cleanup.
3. **Transition validation enforced?** `swarm-ledger.mjs:83-92` DOES validate (debunk any "not enforced" claim); record as confirmed-enforced.
4. **Rebase classifier** — already DEBUNKED (see header). Re-read `transient-classifier.mjs:54` and decide: is the rebase-conflict→transient→retry *policy* worth a Phase 4 reclassification? Record the decision.
5. **PR polling not adaptive.** Read `poll-pr-checks.mjs`. Confirm per-tick sequential `gh pr checks`, no backoff.
6. **Wave packing not proportional.** Read `wave-plan.mjs`. Confirm greedy file-disjoint packing.

- [ ] **Step 2: Record verdicts** with `file:line` + target phase (4/5) or debunked.
- [ ] **Step 3: Commit**

```bash
git add .planning/upstream-audits/2026-06-13-hardening-findings.md
git commit -m "docs(upstream): verify swarm findings"
```

### Task 0.6: Compile the confirmed backlog & reconcile the spec

**Files:**
- Modify: findings doc (`## Confirmed backlog` table)
- Modify: `docs/superpowers/specs/2026-06-13-upstream-pipeline-hardening-design.md` (Phase 3/4/5 item lists, only where Phase 0 reclassified or debunked an item)

- [ ] **Step 1: Fill the confirmed-backlog table** — one row per finding: `| finding | confirmed/debunked/reclassified | file:line | Phase N |`.
- [ ] **Step 2: Reconcile the spec** — if Phase 0 debunked or moved an item, edit the corresponding Phase 3/4/5 bullet in the spec to match. Do not touch Phase 1/2 scope (Phase 1 is this plan; Phase 2 is its own plan).
- [ ] **Step 3: Commit**

```bash
git add .planning/upstream-audits/2026-06-13-hardening-findings.md docs/superpowers/specs/2026-06-13-upstream-pipeline-hardening-design.md
git commit -m "docs(upstream): compile confirmed hardening backlog, reconcile spec"
```

---

# Phase 1 — `_common/` foundation

Behavior-preserving refactor. After every task, **THE SUITE** must report `fail 0` with a pass count `>= 183`. Each task is its own commit (force-add skill files).

## File structure (locked here)

```
.claude/skills/_common/scripts/
  base-ledger.mjs          # NEW: readLedger, writeLedger, SCHEMA_VERSION, validateTransition
  worktree.mjs             # MOVED from upstream-swarm/scripts/worktree-node-modules.mjs + registry/cleanup
  clean-worktrees.mjs      # NEW: CLI to prune stale/registered worktrees
  evaluate-checks.mjs      # MOVED from upstream-merge/scripts/
  select-issues.mjs        # MOVED from upstream-fix/scripts/
  issue-update.mjs         # MOVED from upstream-fix/scripts/
  run-gates.mjs            # MOVED from upstream-fix/scripts/
  __tests__/               # tests move alongside their modules
```

Skill-specific ledger modules (`upstream-fix/scripts/ledger.mjs`,
`upstream-merge/scripts/merge-ledger.mjs`, `upstream-swarm/scripts/swarm-ledger.mjs`)
stay in place; they re-export `readLedger`/`writeLedger` from `base-ledger.mjs`
and keep their own `init*`/`record*` helpers.

### Task 1.1: Scaffold `_common` + `base-ledger.mjs`

**Files:**
- Create: `.claude/skills/_common/scripts/base-ledger.mjs`
- Test: `.claude/skills/_common/scripts/__tests__/base-ledger.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/skills/_common/scripts/__tests__/base-ledger.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLedger, writeLedger, validateTransition, SCHEMA_VERSION,
} from "../base-ledger.mjs";

test("readLedger returns null for a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-"));
  try { assert.equal(readLedger(join(dir, "nope.json")), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("write then read round-trips and writes a trailing newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-"));
  try {
    const p = join(dir, "sub", "led.json");
    writeLedger(p, { version: SCHEMA_VERSION, hello: "world" });
    assert.deepEqual(readLedger(p), { version: SCHEMA_VERSION, hello: "world" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readLedger backfills version:0 for pre-versioning ledgers", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-"));
  try {
    const p = join(dir, "old.json");
    writeFileSync(p, JSON.stringify({ issues: {} }) + "\n");
    assert.equal(readLedger(p).version, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validateTransition allows a legal edge and throws on an illegal one", () => {
  const table = { a: ["b"], b: [] };
  assert.doesNotThrow(() => validateTransition("a", "b", table));
  assert.throws(() => validateTransition("a", "c", table, "issue #1"), /invalid transition: a → c for issue #1/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/_common/scripts/__tests__/base-ledger.test.mjs`
Expected: FAIL — `Cannot find module '../base-ledger.mjs'`.

- [ ] **Step 3: Write the implementation**

```javascript
// .claude/skills/_common/scripts/base-ledger.mjs
#!/usr/bin/env node
/**
 * base-ledger.mjs — shared run-state ledger primitives for the upstream-port
 * skills. Owns JSON read/write, the schema version, and state-machine
 * transition validation. Skill ledgers (upstream-fix/ledger.mjs,
 * upstream-merge/merge-ledger.mjs, upstream-swarm/swarm-ledger.mjs) build their
 * init*/record* helpers on top of these and re-export read/write.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;

export function readLedger(path) {
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf-8"));
  // Backfill for ledgers written before versioning existed (treat as v0).
  if (data && typeof data === "object" && data.version == null) data.version = 0;
  return data;
}

export function writeLedger(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Validate a state-machine transition against a transitions table.
 * @param {string} from current state
 * @param {string} to desired next state
 * @param {Record<string,string[]>} table allowed transitions
 * @param {string} [label] context for the error message
 * @throws if `to` is not in table[from]
 */
export function validateTransition(from, to, table, label = "") {
  const allowed = table[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`invalid transition: ${from} → ${to}${label ? ` for ${label}` : ""}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/_common/scripts/__tests__/base-ledger.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Run THE SUITE**

Run: THE SUITE (see top). Expected: `fail 0`, pass count `>= 187`.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/_common/scripts/base-ledger.mjs .claude/skills/_common/scripts/__tests__/base-ledger.test.mjs
git commit -m "refactor(upstream): add _common/base-ledger shared primitives"
```

### Task 1.2: Migrate the three skill ledgers onto `base-ledger`

**Files:**
- Modify: `.claude/skills/upstream-fix/scripts/ledger.mjs:7-18`
- Modify: `.claude/skills/upstream-merge/scripts/merge-ledger.mjs:6-17`
- Modify: `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs:6-7,83-107`

- [ ] **Step 1: Migrate `upstream-fix/scripts/ledger.mjs`** — replace the local `readLedger`/`writeLedger` definitions (lines 10-18) and the `node:fs`/`node:path` import (lines 7-8) with a re-export. The file keeps `initLedger`/`recordIssueResult`/`setIssueStatus`/`setLaneStatus` unchanged. New top of file:

```javascript
#!/usr/bin/env node
/**
 * ledger.mjs — upstream-fix run-state ledger. Read/write primitives come from
 * _common/base-ledger.mjs; this module owns the fix-specific init/record API.
 */
import { readLedger, writeLedger, SCHEMA_VERSION } from "../../_common/scripts/base-ledger.mjs";
export { readLedger, writeLedger };
```

Then in `initLedger`, change `const ledger = { version: 1, ...` to `const ledger = { version: SCHEMA_VERSION, ...`. Delete the old `readLedger`/`writeLedger` function bodies.

- [ ] **Step 2: Migrate `upstream-merge/scripts/merge-ledger.mjs`** — same treatment. New top:

```javascript
#!/usr/bin/env node
/**
 * merge-ledger.mjs — upstream-merge run-state ledger. Read/write come from
 * _common/base-ledger.mjs; this module owns the merge-specific API.
 */
import { readLedger, writeLedger, SCHEMA_VERSION } from "../../_common/scripts/base-ledger.mjs";
export { readLedger, writeLedger };
```

In `initMergeLedger`, change `version: 1` to `version: SCHEMA_VERSION`. Delete the old read/write bodies (lines 9-17) and the now-unused `node:fs`/`node:path` import (lines 6-7).

- [ ] **Step 3: Migrate `upstream-swarm/scripts/swarm-ledger.mjs`** — re-export read/write from base, and replace the two inline transition checks with `validateTransition`. New top (replace lines 6-7):

```javascript
import { readLedger, writeLedger, validateTransition, SCHEMA_VERSION } from "../../_common/scripts/base-ledger.mjs";
export { readLedger, writeLedger };
```

Delete the local `readLedger`/`writeLedger` (lines 38-46). In `initSwarmLedger` change `version: 1` to `version: SCHEMA_VERSION`. In `recordTransition`, replace:

```javascript
    const allowed = VALID_TRANSITIONS[issue.state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(`invalid transition: ${issue.state} → ${nextState} for issue #${number}`);
    }
    issue.state = nextState;
```
with:
```javascript
    validateTransition(issue.state, nextState, VALID_TRANSITIONS, `issue #${number}`);
    issue.state = nextState;
```

In `recordRetry`, replace:
```javascript
    const allowed = VALID_TRANSITIONS[issue.state] ?? [];
    if (!allowed.includes("retrying")) {
      throw new Error(`invalid transition: ${issue.state} → retrying for issue #${number}`);
    }
    issue.state = "retrying";
```
with:
```javascript
    validateTransition(issue.state, "retrying", VALID_TRANSITIONS, `issue #${number}`);
    issue.state = "retrying";
```

- [ ] **Step 4: Run THE SUITE**

Run: THE SUITE. Expected: `fail 0`, pass `>= 187`. (The existing swarm-ledger tests already assert the exact `invalid transition: X → Y for issue #N` message — `validateTransition` preserves it.)

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-fix/scripts/ledger.mjs .claude/skills/upstream-merge/scripts/merge-ledger.mjs .claude/skills/upstream-swarm/scripts/swarm-ledger.mjs
git commit -m "refactor(upstream): skill ledgers re-export _common read/write, swarm uses shared validateTransition"
```

### Task 1.3: Relocate `worktree-node-modules.mjs` → `_common/worktree.mjs`

Breaks the `merge → swarm` import edge.

**Files:**
- Rename: `.claude/skills/upstream-swarm/scripts/worktree-node-modules.mjs` → `.claude/skills/_common/scripts/worktree.mjs`
- Rename: `.claude/skills/upstream-swarm/scripts/__tests__/worktree-node-modules.test.mjs` → `.claude/skills/_common/scripts/__tests__/worktree.test.mjs`
- Modify: `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs:11`
- Modify: `.claude/skills/upstream-merge/scripts/trial-merge.mjs:18`

- [ ] **Step 1: Move the module and its test**

```bash
git mv .claude/skills/upstream-swarm/scripts/worktree-node-modules.mjs .claude/skills/_common/scripts/worktree.mjs
git mv .claude/skills/upstream-swarm/scripts/__tests__/worktree-node-modules.test.mjs .claude/skills/_common/scripts/__tests__/worktree.test.mjs
```

- [ ] **Step 2: Fix the moved test's import** — in `.claude/skills/_common/scripts/__tests__/worktree.test.mjs`, change `from "../worktree-node-modules.mjs"` to `from "../worktree.mjs"`.

- [ ] **Step 3: Repoint the two importers**
  - `upstream-swarm/scripts/baseline-gate.mjs:11`: change `from "./worktree-node-modules.mjs"` to `from "../../_common/scripts/worktree.mjs"`.
  - `upstream-merge/scripts/trial-merge.mjs:18`: change `from "../../upstream-swarm/scripts/worktree-node-modules.mjs"` to `from "../../_common/scripts/worktree.mjs"`.

- [ ] **Step 4: Run THE SUITE**

Run: THE SUITE. Expected: `fail 0`, pass `>= 187`.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/_common/scripts/worktree.mjs .claude/skills/_common/scripts/__tests__/worktree.test.mjs .claude/skills/upstream-swarm/scripts/baseline-gate.mjs .claude/skills/upstream-merge/scripts/trial-merge.mjs
git rm --cached .claude/skills/upstream-swarm/scripts/worktree-node-modules.mjs .claude/skills/upstream-swarm/scripts/__tests__/worktree-node-modules.test.mjs 2>/dev/null || true
git commit -m "refactor(upstream): move worktree provisioning to _common/worktree, break merge→swarm import"
```

### Task 1.4: Add worktree registry + `clean-worktrees` CLI; wire the creators

Fixes leaked `.worktrees/` accumulation (fix lanes + swarm baseline).

**Files:**
- Modify: `.claude/skills/_common/scripts/worktree.mjs` (append registry functions)
- Create: `.claude/skills/_common/scripts/clean-worktrees.mjs`
- Test: `.claude/skills/_common/scripts/__tests__/worktree-registry.test.mjs`
- Modify: `.claude/skills/upstream-fix/scripts/worktree-setup.mjs:6,35`
- Modify: `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs` (after the `worktree add` at line 36)

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/skills/_common/scripts/__tests__/worktree-registry.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWorktree, readRegistry, pruneWorktrees } from "../worktree.mjs";

test("registerWorktree records an entry and is idempotent per path", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  try {
    const reg = join(dir, "registry.json");
    registerWorktree(reg, { path: "/tmp/wt-a", owner: "lane-1", createdAt: 1000 });
    registerWorktree(reg, { path: "/tmp/wt-a", owner: "lane-1", createdAt: 2000 }); // updates, no dup
    const entries = readRegistry(reg);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].createdAt, 2000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pruneWorktrees removes entries older than ttl and calls the remover", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  try {
    const reg = join(dir, "registry.json");
    const live = join(dir, "live"); mkdirSync(live);
    registerWorktree(reg, { path: live, owner: "lane-1", createdAt: 0 });   // stale
    registerWorktree(reg, { path: join(dir, "fresh"), owner: "lane-2", createdAt: 10_000 });
    const removed = [];
    const result = pruneWorktrees(reg, { ttlMs: 1000, now: 5000, remover: (p) => removed.push(p) });
    assert.deepEqual(removed, [live]);
    assert.equal(readRegistry(reg).length, 1); // only the fresh one remains
    assert.equal(result.pruned.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test .claude/skills/_common/scripts/__tests__/worktree-registry.test.mjs`
Expected: FAIL — `registerWorktree is not a function` / export missing.

- [ ] **Step 3: Append the registry implementation to `worktree.mjs`**

Add to the existing imports at the top of `_common/scripts/worktree.mjs`:
```javascript
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
```
(merge with the existing `import { symlinkSync, existsSync } from "node:fs"` and `import { resolve } from "node:path"` lines — keep a single import per module, no duplicate specifiers.)

Append at the end of the module (before the `if (process.argv[1] ...)` CLI block, if any — `worktree.mjs` has none, so append at EOF):

```javascript
// ---- worktree registry: track + prune lane/baseline worktrees ----

export function readRegistry(registryPath) {
  if (!existsSync(registryPath)) return [];
  try { return JSON.parse(readFileSync(registryPath, "utf-8")); }
  catch { return []; }
}

function writeRegistry(registryPath, entries) {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(entries, null, 2) + "\n");
}

/** Record (or update) a worktree entry keyed by absolute path. */
export function registerWorktree(registryPath, { path, owner, createdAt }) {
  const abs = resolve(path);
  const entries = readRegistry(registryPath).filter((e) => resolve(e.path) !== abs);
  entries.push({ path: abs, owner, createdAt });
  writeRegistry(registryPath, entries);
  return entries;
}

function defaultRemover(path) {
  // Best-effort: ask git to remove the worktree, then delete the dir.
  try { execFileSync("git", ["worktree", "remove", "--force", path], { encoding: "utf-8" }); }
  catch { /* fall through to fs removal */ }
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

/**
 * Remove registered worktrees older than ttlMs (by createdAt). Returns
 * { pruned: [...] }. `now` and `remover` are injectable for tests.
 */
export function pruneWorktrees(registryPath, { ttlMs, now = Date.now(), remover = defaultRemover } = {}) {
  const entries = readRegistry(registryPath);
  const keep = [];
  const pruned = [];
  for (const e of entries) {
    if (now - e.createdAt >= ttlMs) { remover(e.path); pruned.push(e.path); }
    else keep.push(e);
  }
  writeRegistry(registryPath, keep);
  return { pruned };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test .claude/skills/_common/scripts/__tests__/worktree-registry.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the `clean-worktrees.mjs` CLI**

```javascript
// .claude/skills/_common/scripts/clean-worktrees.mjs
#!/usr/bin/env node
/**
 * clean-worktrees.mjs — prune stale upstream-port worktrees.
 * CLI: node clean-worktrees.mjs [--registry PATH] [--ttl-hours N]
 * Default registry: .planning/upstream-fixes/.worktree-registry.json
 */
import { pruneWorktrees } from "./worktree.mjs";

const args = process.argv.slice(2);
function flag(name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

const registry = flag("--registry", ".planning/upstream-fixes/.worktree-registry.json");
const ttlMs = Number(flag("--ttl-hours", "24")) * 3600 * 1000;
const { pruned } = pruneWorktrees(registry, { ttlMs });
process.stdout.write(JSON.stringify({ pruned }, null, 2) + "\n");
```

- [ ] **Step 6: Wire the two worktree creators to register**

In `upstream-fix/scripts/worktree-setup.mjs`: add the import at line 6 area (after the `execFileSync` import):
```javascript
import { registerWorktree } from "../../_common/scripts/worktree.mjs";
```
Add an optional `registryPath` to `setupWorktree`'s options and register before returning. Change the signature line and the return block:
```javascript
export function setupWorktree({ laneId, base = "origin/main", gitRunner = defaultGitRunner, fetch = true, registryPath = ".planning/upstream-fixes/.worktree-registry.json" }) {
```
…and immediately before `return { worktree, branch };` (line 35) insert:
```javascript
  try { registerWorktree(registryPath, { path: worktree, owner: `fix-lane-${laneId}`, createdAt: Date.now() }); }
  catch { /* registry is best-effort; never block worktree creation */ }
```

In `upstream-swarm/scripts/baseline-gate.mjs`: add near the top imports:
```javascript
import { registerWorktree } from "../../_common/scripts/worktree.mjs";
```
Immediately after the `worktreeRunner(["worktree", "add", "--detach", workdir, base]);` call (line 36) insert:
```javascript
  try { registerWorktree(".planning/upstream-swarms/.worktree-registry.json", { path: workdir, owner: "swarm-baseline", createdAt: Date.now() }); }
  catch { /* best-effort */ }
```

- [ ] **Step 7: Run THE SUITE**

Run: THE SUITE. Expected: `fail 0`, pass `>= 189`. (Existing `worktree-setup`/`baseline-gate` tests inject their own runners and do not set `registryPath` to a real location — the `try/catch` keeps registry writes from affecting them; if a test asserts on exact return shape it is unaffected because `setupWorktree` still returns `{ worktree, branch }`.)

- [ ] **Step 8: Commit**

```bash
git add -f .claude/skills/_common/scripts/worktree.mjs .claude/skills/_common/scripts/clean-worktrees.mjs .claude/skills/_common/scripts/__tests__/worktree-registry.test.mjs .claude/skills/upstream-fix/scripts/worktree-setup.mjs .claude/skills/upstream-swarm/scripts/baseline-gate.mjs
git commit -m "feat(upstream): worktree registry + clean-worktrees CLI, wire fix lane + swarm baseline creators"
```

### Task 1.5: Relocate `evaluate-checks.mjs` → `_common`

Breaks the `swarm → merge` import edge.

**Files:**
- Rename: `.claude/skills/upstream-merge/scripts/evaluate-checks.mjs` → `.claude/skills/_common/scripts/evaluate-checks.mjs`
- Rename its test: `.claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs` → `.claude/skills/_common/scripts/__tests__/evaluate-checks.test.mjs` (if present)
- Modify: `.claude/skills/upstream-swarm/scripts/poll-pr-checks.mjs:34`
- Modify: `.claude/skills/upstream-merge/SKILL.md:69`

- [ ] **Step 1: Confirm the test filename, then move module + test**

```bash
ls .claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs 2>/dev/null
git mv .claude/skills/upstream-merge/scripts/evaluate-checks.mjs .claude/skills/_common/scripts/evaluate-checks.mjs
# only if the test exists:
git mv .claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs .claude/skills/_common/scripts/__tests__/evaluate-checks.test.mjs
```

- [ ] **Step 2: Fix the moved test's import** (if moved) — it imports `from "../evaluate-checks.mjs"`, which stays correct in its new `__tests__` location. No change needed. If the test referenced merge's `config.json` by a relative path, update that path to `../../../upstream-merge/config.json`.

- [ ] **Step 3: Repoint importers and SKILL.md**
  - `upstream-swarm/scripts/poll-pr-checks.mjs:34`: change `from "../../upstream-merge/scripts/evaluate-checks.mjs"` to `from "../../_common/scripts/evaluate-checks.mjs"`.
  - `upstream-merge/SKILL.md:69`: change the invocation path `node .claude/skills/upstream-merge/scripts/evaluate-checks.mjs` to `node .claude/skills/_common/scripts/evaluate-checks.mjs`.
  - Grep for any other importer: `grep -rn "evaluate-checks" .claude/skills` and repoint each `../../upstream-merge/scripts/evaluate-checks.mjs` or `./evaluate-checks.mjs` to the `_common` path.

- [ ] **Step 4: Run THE SUITE**

Run: THE SUITE. Expected: `fail 0`, pass `>= 189`.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/_common/scripts/evaluate-checks.mjs .claude/skills/upstream-swarm/scripts/poll-pr-checks.mjs .claude/skills/upstream-merge/SKILL.md
git add -f .claude/skills/_common/scripts/__tests__/evaluate-checks.test.mjs 2>/dev/null || true
git commit -m "refactor(upstream): move evaluate-checks to _common, break swarm→merge import"
```

### Task 1.6: Relocate `select-issues.mjs` → `_common`

Breaks the `swarm → fix` import edge.

**Files:**
- Rename: `.claude/skills/upstream-fix/scripts/select-issues.mjs` → `.claude/skills/_common/scripts/select-issues.mjs`
- Rename its test (confirm name first): `.claude/skills/upstream-fix/scripts/__tests__/select-issues.test.mjs` → `_common/...`
- Modify: `.claude/skills/upstream-swarm/scripts/select-issues.mjs:12`
- Modify: `.claude/skills/upstream-fix/SKILL.md:68`
- Modify: `.claude/skills/upstream-swarm/SKILL.md:66`

- [ ] **Step 1: Move module + test**

```bash
ls .claude/skills/upstream-fix/scripts/__tests__/select-issues.test.mjs 2>/dev/null
git mv .claude/skills/upstream-fix/scripts/select-issues.mjs .claude/skills/_common/scripts/select-issues.mjs
git mv .claude/skills/upstream-fix/scripts/__tests__/select-issues.test.mjs .claude/skills/_common/scripts/__tests__/select-issues.test.mjs
```

- [ ] **Step 2: Verify the moved test's default guidance-dir path** — `select-issues.mjs` uses `DEFAULT_GUIDANCE_DIR`. If it is resolved relative to the script's own location (`import.meta.url`), moving the script changes that base. Open the moved `select-issues.mjs`, find `DEFAULT_GUIDANCE_DIR`, and if it is derived from `import.meta.url`/`__dirname`, re-anchor it to the repo root (e.g. `resolve(process.cwd(), ".planning/upstream-audits/guidance")`) so it still points at `.planning/upstream-audits/guidance`. If it is already an absolute/cwd-relative literal, no change. Run the moved test to confirm:

Run: `node --test .claude/skills/_common/scripts/__tests__/select-issues.test.mjs`
Expected: PASS.

- [ ] **Step 3: Repoint importer + SKILL.md paths**
  - `upstream-swarm/scripts/select-issues.mjs:12`: change `from "../../upstream-fix/scripts/select-issues.mjs"` to `from "../../_common/scripts/select-issues.mjs"`.
  - `upstream-fix/SKILL.md:68`: change `node .claude/skills/upstream-fix/scripts/select-issues.mjs` to `node .claude/skills/_common/scripts/select-issues.mjs`.
  - `upstream-swarm/SKILL.md:66`: the swarm SKILL invokes `upstream-swarm/scripts/select-issues.mjs` (its own wrapper) — leave that path; only its internal import changed in Task 1.6 Step 3 bullet 1.

- [ ] **Step 4: Run THE SUITE**

Run: THE SUITE. Expected: `fail 0`, pass `>= 189`.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/_common/scripts/select-issues.mjs .claude/skills/_common/scripts/__tests__/select-issues.test.mjs .claude/skills/upstream-swarm/scripts/select-issues.mjs .claude/skills/upstream-fix/SKILL.md
git commit -m "refactor(upstream): move select-issues to _common, break swarm→fix import"
```

### Task 1.7: Relocate `issue-update.mjs` + `run-gates.mjs` → `_common`

No JS importers — only SKILL.md path refs + subagent Bash invocations. Pure tidiness/consistency moves.

**Files:**
- Rename: `.claude/skills/upstream-fix/scripts/issue-update.mjs` → `_common/scripts/issue-update.mjs` (+ test if present)
- Rename: `.claude/skills/upstream-fix/scripts/run-gates.mjs` → `_common/scripts/run-gates.mjs` (+ test if present)
- Modify SKILL.md path refs: `upstream-fix/SKILL.md:141,150,155,204,225`, `upstream-merge/SKILL.md:81,140`

- [ ] **Step 1: Move both modules + their tests**

```bash
for f in issue-update run-gates; do
  git mv .claude/skills/upstream-fix/scripts/$f.mjs .claude/skills/_common/scripts/$f.mjs
  [ -f .claude/skills/upstream-fix/scripts/__tests__/$f.test.mjs ] && \
    git mv .claude/skills/upstream-fix/scripts/__tests__/$f.test.mjs .claude/skills/_common/scripts/__tests__/$f.test.mjs
done
```

- [ ] **Step 2: Update all SKILL.md invocation paths** — replace every `node .claude/skills/upstream-fix/scripts/issue-update.mjs` with `node .claude/skills/_common/scripts/issue-update.mjs`, and every `node .claude/skills/upstream-fix/scripts/run-gates.mjs` with `node .claude/skills/_common/scripts/run-gates.mjs`, across both SKILL.md files. Sweep to be exhaustive:

```bash
grep -rn "upstream-fix/scripts/\(issue-update\|run-gates\)\.mjs" .claude/skills
```
Edit each hit (in `upstream-fix/SKILL.md` and `upstream-merge/SKILL.md`) to the `_common` path. Also check subagent prompt templates inside the SKILL.md bodies for the same paths.

- [ ] **Step 3: Verify the moved tests pass at their new location** — their imports are `from "../issue-update.mjs"` / `from "../run-gates.mjs"`, which remain correct.

Run: `node --test .claude/skills/_common/scripts/__tests__/issue-update.test.mjs .claude/skills/_common/scripts/__tests__/run-gates.test.mjs` (omit any that did not exist)
Expected: PASS.

- [ ] **Step 4: Run THE SUITE**

Run: THE SUITE. Expected: `fail 0`, pass `>= 189`.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/_common/scripts/issue-update.mjs .claude/skills/_common/scripts/run-gates.mjs .claude/skills/upstream-fix/SKILL.md .claude/skills/upstream-merge/SKILL.md
git add -f .claude/skills/_common/scripts/__tests__/issue-update.test.mjs .claude/skills/_common/scripts/__tests__/run-gates.test.mjs 2>/dev/null || true
git commit -m "refactor(upstream): move issue-update + run-gates to _common, update SKILL.md paths"
```

### Task 1.8: Acceptance — zero cross-skill imports, full suite green, document `_common`

**Files:**
- Read-only verification
- Modify: `docs/UPSTREAM-SYNC.md` (note the `_common` module) — or create `.claude/skills/_common/README.md`

- [ ] **Step 1: Assert no skill imports another skill's scripts**

Run:
```bash
grep -rEn "from ['\"]\.\.\/\.\.\/(upstream-[a-z-]+)\/scripts" .claude/skills/upstream-*/scripts/*.mjs
```
Expected: **no output** (every cross-skill import now points at `_common`). If any remain, repoint them and re-run.

- [ ] **Step 2: Assert no stale `worktree-node-modules` / moved-path references linger**

Run:
```bash
grep -rn "worktree-node-modules\|upstream-fix/scripts/\(issue-update\|run-gates\|select-issues\)\|upstream-merge/scripts/evaluate-checks" .claude/skills
```
Expected: no output (or only inside the findings/history docs, not in live scripts/SKILL.md).

- [ ] **Step 3: Run THE SUITE one final time**

Run: THE SUITE. Expected: `fail 0`, pass `>= 189` (= original 183 + new `_common` tests).

- [ ] **Step 4: Document the shared module** — add a short `.claude/skills/_common/README.md`:

```markdown
# _common — shared primitives for the upstream-port skills

Scripts here are imported by upstream-cherry-pick / -fix / -merge / -swarm so the
skills depend on `_common`, never on each other (no skill↔skill cycles).

- `base-ledger.mjs` — readLedger / writeLedger / SCHEMA_VERSION / validateTransition
- `worktree.mjs` — provisionWorktreeNodeModules + registry (registerWorktree / pruneWorktrees)
- `clean-worktrees.mjs` — CLI to prune stale worktrees
- `evaluate-checks.mjs` — GitHub required-checks evaluation
- `select-issues.mjs` — issue selection + guidance-target parsing
- `issue-update.mjs` — gh issue label/comment/close
- `run-gates.mjs` — regression / build / targeted / full gate runner

Import path from a skill script: `../../_common/scripts/<module>.mjs`.
```

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/_common/README.md
git add docs/UPSTREAM-SYNC.md 2>/dev/null || true
git commit -m "docs(upstream): document _common module; Phase 1 foundation complete"
```

---

## Self-Review (run after writing; fix inline)

- **Spec coverage:** Phase 0 verifies every review finding (Tasks 0.2–0.5) and reconciles the spec (0.6). Phase 1 delivers the spec's `_common` table — base-ledger (1.1–1.2), worktree + registry/cleanup (1.3–1.4), evaluate-checks (1.5), select-issues (1.6), issue-update + run-gates (1.7), acceptance (1.8). `schemaVersion` + `validateTransition` enforced (1.1–1.2). ✓
- **Placeholder scan:** every code step shows complete code; every run step shows the command + expected result. The only conditional ("if the test file exists") is guarded with an `ls`/`[ -f ]` check, not a placeholder. ✓
- **Type/name consistency:** `registerWorktree(registryPath, {path, owner, createdAt})`, `readRegistry(registryPath)`, `pruneWorktrees(registryPath, {ttlMs, now, remover})`, `validateTransition(from, to, table, label)`, `readLedger`/`writeLedger`/`SCHEMA_VERSION` — names used identically in tests and implementations. ✓
- **Open risk flagged for the executor:** Task 1.6 Step 2 (`DEFAULT_GUIDANCE_DIR` re-anchoring) and Task 1.4 Step 7 (registry writes in tests) are the two places where a move could change behavior; both have explicit verification steps.
