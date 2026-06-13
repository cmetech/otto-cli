# Upstream Pipeline Hardening — Phase 5 (Nice-to-Haves) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the seven lower-leverage polish items that make the upstream-port pipeline more observable, recoverable, and defensible — without the one explicitly-deferred large item (smarter wave bundling, dropped per planning decision). Concretely: a cache-staleness warning (cherry-pick), full refute-verdict persistence + a divergence-aware read-back (merge + swarm), an automatic bounded reviewer-rejection retry (fix), an idempotent baseline-gate worktree (swarm), required-checks allowlist-drift warnings (merge), and a targeted blocked-PR retry path (merge).

**Architecture:** Each item is local and additive. cherry-pick `fetch-pr-context.mjs` uses the cache file's mtime as a free fetch-timestamp and returns staleness (no cache-format migration). `upstream-merge/merge-ledger.mjs` gains a real `refute` field + `recordRefute` (the SKILL.md already *says* to record it but the field never existed); `_common/evaluate-checks.mjs` gains pure `checkAllowlistDrift` + a `fetchBranchProtection` fetcher, warned once at merge-run startup; `merge-ledger.mjs` gains `requeuePr` for a `--retry <prs>` path. `upstream-fix/ledger.mjs` gains `reviewerRejectionCount` + `recordReviewerRejection` driving an automatic bounded-1 retry documented in SKILL.md. `upstream-swarm/baseline-gate.mjs` becomes idempotent (remove a leaked worktree before re-creating); `swarm-ledger.mjs` gains a `readRefuteVerdict` helper so the swarm's `merge-pr` action passes the *recorded* panel verdict instead of a hardcoded `approve`.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, dependency-injected `gh`/`git`/`now`/`mtime` (no network or wall-clock in tests). Skill files live under `.claude/skills/` (gitignored at `.gitignore:43`; commit with `git add -f`). Editing `.claude/skills/` trips the self-modification block — obtain operator authorization at session start.

---

## Pre-flight (read before Task 1)

**Self-modification block:** every task edits `.claude/skills/`. Confirm Corey has authorized skill edits for this session before starting.

**Branch:** all work happens on `feat/upstream-hardening-phase-5` off `main`.

**Regression net (full skill suite — run after every task, must stay green; baseline 388):**

```bash
node --test \
  .claude/skills/_common/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/__tests__/*.test.mjs \
  .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs
```

**Also run the swarm integration tests** in Task 8 (the regression glob does NOT recurse into `upstream-swarm/scripts/__tests__/integration/` — a known blind spot). Expected: 7/8, only the pre-existing `baseline-abort` (symlink/provisionDeps infra issue, fails on `main` too) failing.

**Commit convention:** Conventional Commits, scope `upstream`. End every commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git add -f` for `.claude/skills/` files.

**Decisions baked in (from planning):**
- **Item 7 (wave bundling) DROPPED** — left as the greedy file-disjoint packer; documented as deferred in Task 8. Not implemented here.
- **Allowlist-drift = warn once per run at startup** (Task 5), non-blocking, one `gh api` call/run.
- **Reviewer-rejection retry = automatic, bounded to 1** (Task 3), no new flag.

## File Structure

**Modify:**
- `.claude/skills/upstream-cherry-pick/scripts/fetch-pr-context.mjs` (+ `run-audit.mjs` flag) — cache staleness.
- `.claude/skills/upstream-merge/scripts/merge-ledger.mjs` — `refute` field + `recordRefute`; `requeuePr`.
- `.claude/skills/_common/scripts/evaluate-checks.mjs` — `fetchBranchProtection` + `checkAllowlistDrift`.
- `.claude/skills/upstream-fix/scripts/ledger.mjs` — `reviewerRejectionCount` + `recordReviewerRejection`.
- `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs` — idempotent worktree.
- `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs` — `readRefuteVerdict`.
- SKILL.md files: cherry-pick (cache flag), upstream-merge (recordRefute, allowlist-drift, `--retry`), upstream-fix (retry loop), upstream-swarm (refute read-back, baseline cleanup).
- Matching `__tests__/*.test.mjs` for each script.

---

### Task 1: cherry-pick PR-context cache staleness warning

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/fetch-pr-context.mjs` (`fetchPrContext` :40-100, CLI :103-125)
- Modify: `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs` (flag passthrough)
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/fetch-pr-context.test.mjs`

`_cache/pr-*.json` never expires. Use the cache file's **mtime** as the fetch timestamp (no cache-format change — works on existing caches). On a cache hit, compute `ageMs`; when a `cacheAgeWarningMs` threshold is set and exceeded, return `stale:true` + a `warning` string (the CLI/orchestrator emits it). Default (no threshold) ⇒ never stale ⇒ existing behavior unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/fetch-pr-context.test.mjs` (reuse the file's existing imports/helpers; it already tests caching):

```js
test("a cache hit older than cacheAgeWarningMs is flagged stale with a warning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fpc-stale-"));
  try {
    const ghRepo = "earendil-works/pi";
    const repoDir = join(dir, ghRepo.replace("/", "__"));
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "pr-7.json"), JSON.stringify({ title: "cached" }) + "\n");
    const now = 1_000_000_000_000;
    const r = await fetchPrContext({
      ghRepo, refNum: 7, cacheDir: dir,
      ghRunner: () => { throw new Error("must not fetch on a cache hit"); },
      now,
      cacheAgeWarningMs: 1000,
      mtimeOf: () => now - 5000, // 5s old, threshold 1s
    });
    assert.equal(r.fromCache, true);
    assert.equal(r.stale, true);
    assert.equal(r.ageMs, 5000);
    assert.match(r.warning, /stale|old|cache/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fresh cache hit is not stale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fpc-fresh-"));
  try {
    const ghRepo = "earendil-works/pi";
    const repoDir = join(dir, ghRepo.replace("/", "__"));
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "pr-7.json"), JSON.stringify({ title: "cached" }) + "\n");
    const now = 1_000_000_000_000;
    const r = await fetchPrContext({
      ghRepo, refNum: 7, cacheDir: dir, ghRunner: () => { throw new Error("no fetch"); },
      now, cacheAgeWarningMs: 100_000, mtimeOf: () => now - 5000,
    });
    assert.equal(r.stale, false);
    assert.equal(r.warning ?? null, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no cacheAgeWarningMs → never stale (back-compat)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fpc-nocfg-"));
  try {
    const ghRepo = "earendil-works/pi";
    const repoDir = join(dir, ghRepo.replace("/", "__"));
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "pr-7.json"), JSON.stringify({ title: "cached" }) + "\n");
    const r = await fetchPrContext({ ghRepo, refNum: 7, cacheDir: dir, ghRunner: () => { throw new Error("no fetch"); } });
    assert.equal(r.fromCache, true);
    assert.equal(r.stale ?? false, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

> Ensure the test file imports `mkdtempSync, rmSync, mkdirSync, writeFileSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`, and `fetchPrContext` — extend the existing imports if any are missing.

- [ ] **Step 2: Run to verify failure**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/fetch-pr-context.test.mjs`
Expected: the 3 new tests FAIL (`stale`/`ageMs`/`warning` undefined).

- [ ] **Step 3: Implement in `fetch-pr-context.mjs`**

Add `statSync` to the `node:fs` import. Change the `fetchPrContext` signature to accept the new options:

```js
export async function fetchPrContext({
  ghRepo,
  refNum,
  cacheDir = ".planning/upstream-audits/_cache",
  refreshCache = false,
  ghRunner = defaultGhRunner,
  now = Date.now(),
  cacheAgeWarningMs = null,
  mtimeOf = (p) => statSync(p).mtimeMs,
}) {
```

Add a small helper just above the cache-hit block, and use it on each hit. Replace the cache-hit block (`:52-62`) with:

```js
  const staleness = (path) => {
    if (!cacheAgeWarningMs) return { ageMs: null, stale: false, warning: null };
    const ageMs = now - mtimeOf(path);
    if (ageMs > cacheAgeWarningMs) {
      return { ageMs, stale: true, warning: `cached context for #${refNum} (${ghRepo}) is ${Math.round(ageMs / 86_400_000)}d old — pass --refresh-cache to refetch` };
    }
    return { ageMs, stale: false, warning: null };
  };

  // Cache hit: return cached file if refreshCache is false and either cache file exists
  if (!refreshCache) {
    if (existsSync(prCachePath)) {
      const data = JSON.parse(readFileSync(prCachePath, "utf-8"));
      return { kind: "pr", data, fromCache: true, ...staleness(prCachePath) };
    }
    if (existsSync(issueCachePath)) {
      const data = JSON.parse(readFileSync(issueCachePath, "utf-8"));
      return { kind: "issue", data, fromCache: true, ...staleness(issueCachePath) };
    }
  }
```

In the fresh-fetch return (`:99`), add the non-stale fields for shape consistency:

```js
  return { kind, data, fromCache: false, ageMs: 0, stale: false, warning: null };
```

In the CLI block, parse `--cache-age-warning <days>` and emit the warning to stderr:

```js
  const refreshCache = args.includes("--refresh-cache");
  const cawIdx = args.indexOf("--cache-age-warning");
  const cacheAgeWarningMs = cawIdx >= 0 ? Number(args[cawIdx + 1]) * 86_400_000 : null;
  ...
    const result = await fetchPrContext({ ghRepo, refNum, refreshCache, cacheAgeWarningMs });
    if (result.warning) process.stderr.write(result.warning + "\n");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
```

- [ ] **Step 4: run-audit passthrough**

In `run-audit.mjs`, add a `--cache-age-warning <days>` flag to `parseArgs` (default null → `cacheAgeWarningMs`), and thread it into the `fetchPrContext` call (search for where `fetchPrContext`/`fetch-pr-context` is invoked — pass `cacheAgeWarningMs`). When a returned context is `stale`, `console.error` its `warning`. Document the flag in the header comment. If run-audit calls fetch-pr-context via a subprocess rather than the imported function, pass `--cache-age-warning` through that invocation instead. Read the call site and wire whichever form is used; keep it minimal.

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/fetch-pr-context.mjs .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/fetch-pr-context.test.mjs
git commit -m "$(cat <<'EOF'
feat(upstream): warn on stale PR-context cache (mtime age)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: persist the full refute verdict in the merge ledger

**Files:**
- Modify: `.claude/skills/upstream-merge/scripts/merge-ledger.mjs` (`initMergeLedger` :9-24, new `recordRefute`)
- Modify: `.claude/skills/upstream-merge/SKILL.md` (Phase B.5 step 4 :108-110)
- Test: `.claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs`

The refute panel returns per-lens `{lens, verdict, confidence, reason, blocking}` + a tally, but the merge ledger has **no refute field at all** — SKILL.md:109 instructs "Record `refuteVerdict`/`refuteReason`" into a field that doesn't exist, so confidence/blocking/per-lens detail are lost. Add a real `refute` field and a `recordRefute` writer that persists all four lenses + the tally.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs` (reuse the file's tmp-dir pattern):

```js
test("initMergeLedger seeds refute = null and recordRefute persists all lenses + tally", () => {
  const dir = mkdtempSync(join(tmpdir(), "ml-refute-"));
  try {
    const path = join(dir, "led.json");
    initMergeLedger(path, { date: "2026-06-13", prs: [{ number: 9, headRef: "x" }] });
    assert.equal(readLedger(path).prs["9"].refute, null);

    const verdicts = [
      { lens: "upstream-alignment", verdict: "approve", confidence: 0.9, reason: "ok", blocking: false },
      { lens: "scope-discipline", verdict: "abstain", confidence: 0.2, reason: "n/a", blocking: false },
      { lens: "test-quality", verdict: "approve", confidence: 0.8, reason: "good", blocking: false },
      { lens: "blast-radius", verdict: "approve", confidence: 0.7, reason: "small", blocking: false },
    ];
    const tally = { panelVerdict: "approve", approves: 3, refutes: 0, abstains: 1, reason: "3 approve / 1 abstain / 0 refute" };
    recordRefute(path, 9, { panelVerdict: "approve", verdicts, tally });

    const pr = readLedger(path).prs["9"];
    assert.equal(pr.refute.panelVerdict, "approve");
    assert.equal(pr.refute.verdicts.length, 4);
    assert.equal(pr.refute.verdicts[0].confidence, 0.9);   // confidence preserved
    assert.equal(pr.refute.verdicts[0].blocking, false);   // blocking preserved
    assert.equal(pr.refute.tally.abstains, 1);             // full tally preserved
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

> Add `recordRefute` to the test file's import from `../merge-ledger.mjs`.

- [ ] **Step 2: Run to verify failure** — `recordRefute` not exported.

- [ ] **Step 3: Implement**

In `merge-ledger.mjs`, add `refute: null,` to the per-PR record in `initMergeLedger` (next to `localGate: null,`). Add the writer after `recordVerdict`:

```js
/**
 * Persist the full refute-panel outcome for a PR: the consolidated panel
 * verdict plus every lens's { lens, verdict, confidence, reason, blocking }
 * and the tally — so confidence/blocking/per-lens detail survive for
 * forensics and reporting (not just a flattened string).
 */
export function recordRefute(path, number, { panelVerdict = null, verdicts = [], tally = null, reason = null }) {
  return mutatePr(path, number, (pr) => {
    pr.refute = { panelVerdict, verdicts, tally, reason };
  });
}
```

- [ ] **Step 4: SKILL.md**

In `.claude/skills/upstream-merge/SKILL.md` Phase B.5 step 4 (`:108-110`), replace the "Record `refuteVerdict` and `refuteReason` in the ledger." sentence with:

```markdown
   Record the full panel outcome via `recordRefute(path, <pr>, { panelVerdict,
   verdicts, tally })` — every lens's `{lens, verdict, confidence, reason,
   blocking}` and the tally are persisted (not a flattened string), so a blocked
   merge is fully auditable.
```

And in step 5 (`:111`), note the recorded verdict feeds `--refute-verdict` (it already says "proceed with `--refute-verdict approve`" — leave as-is or reference `refute.tally.panelVerdict`).

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-merge/scripts/merge-ledger.mjs .claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs .claude/skills/upstream-merge/SKILL.md
git commit -m "$(cat <<'EOF'
feat(upstream): persist full refute verdict (lenses + confidence + tally) in merge ledger

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: automatic bounded reviewer-rejection retry (upstream-fix)

**Files:**
- Modify: `.claude/skills/upstream-fix/scripts/ledger.mjs` (`initLedger` issue record :24-37, new `recordReviewerRejection`)
- Modify: `.claude/skills/upstream-fix/SKILL.md` (Phase C reviewer step :187-188)
- Test: `.claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs`

Today a Phase C reviewer `reject` is terminal. Allow one automatic retry: on reject, if `reviewerRejectionCount < 1`, increment it, set the issue back to `fixing` for a re-dispatch (with the reviewer's reason quoted), and re-run gates + reviewer; a 2nd reject is terminal (`rejected`). Track the count in the ledger.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs` (reuse the tmp-dir pattern; add `recordReviewerRejection` to the import):

```js
test("recordReviewerRejection retries once then is terminal", () => {
  const dir = mkdtempSync(join(tmpdir(), "uf-led-rej-"));
  try {
    const path = join(dir, "led.json");
    initLedger(path, { date: "d", filter: {}, integrationBranch: "b", lanes: [{ id: 1, issues: [9], files: ["a.ts"] }], issues: [{ number: 9, targetFiles: ["a.ts"] }] });
    assert.equal(readLedger(path).issues["9"].reviewerRejectionCount, 0);

    const first = recordReviewerRejection(path, 9, "regression test does not pin the bug");
    assert.equal(first.retry, true);
    assert.equal(first.issue.reviewerRejectionCount, 1);
    assert.equal(first.issue.status, "fixing");           // back to fixing for re-dispatch
    assert.equal(first.issue.reviewerReason, "regression test does not pin the bug");

    const second = recordReviewerRejection(path, 9, "still wrong");
    assert.equal(second.retry, false);
    assert.equal(second.issue.reviewerRejectionCount, 2);
    assert.equal(second.issue.status, "rejected");        // terminal on the 2nd reject
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify failure** — `recordReviewerRejection` not exported; `reviewerRejectionCount` undefined.

- [ ] **Step 3: Implement**

In `ledger.mjs` `initLedger`, add `reviewerRejectionCount: 0,` to the per-issue record (next to `reviewer: null,`). Add the writer:

```js
/**
 * Record a Phase-C reviewer rejection. The first rejection is recoverable:
 * increment the count, set the issue back to `fixing` for one re-dispatch with
 * the reviewer's reason. A second rejection is terminal (`rejected`).
 * @returns {{ retry: boolean, issue: object }}
 */
export function recordReviewerRejection(path, number, reason, { cap = 1 } = {}) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const iss = ledger.issues[String(number)];
  if (!iss) throw new Error(`unknown issue #${number} in ledger`);
  iss.reviewerRejectionCount = (iss.reviewerRejectionCount ?? 0) + 1;
  iss.reviewerReason = reason;
  const retry = iss.reviewerRejectionCount <= cap;
  iss.status = retry ? "fixing" : "rejected";
  if (!retry) iss.reviewer = "reject";
  writeLedger(path, ledger);
  return { retry, issue: iss };
}
```

- [ ] **Step 4: SKILL.md**

In `.claude/skills/upstream-fix/SKILL.md` Phase C reviewer step (`:187-188`, "Fold the verdict into the ledger … A reject excludes that commit from integration."), replace with:

```markdown
   Fold the verdict into the ledger. On `approve`, set `reviewer`/`reviewerReason`.
   On `reject`, call `recordReviewerRejection(path, <num>, <reason>)`: the FIRST
   reject is auto-recoverable — it returns `{retry:true}`, sets the issue back to
   `fixing`, and you **re-dispatch the fix subagent once** with the reviewer's
   reason quoted (re-run the regression/build/targeted gates, then re-review). A
   SECOND reject returns `{retry:false}` and is terminal (`rejected`) — exclude
   that commit from integration. `reviewerRejectionCount` is tracked in the ledger.
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-fix/scripts/ledger.mjs .claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs .claude/skills/upstream-fix/SKILL.md
git commit -m "$(cat <<'EOF'
feat(upstream-fix): automatic bounded reviewer-rejection retry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: idempotent baseline-gate worktree (swarm)

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs` (`runBaselineGate` :33-48)
- Modify: `.claude/skills/upstream-swarm/SKILL.md` (Phase C baseline-worktree note :138-140)
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs`

A failed baseline gate deliberately leaves `.worktrees/upstream-swarm-baseline`; the next run's `git worktree add` then throws "worktree already exists". The registry registration is already in place (`:37`) — the remaining fix is to make `worktree add` idempotent: best-effort `git worktree remove --force <workdir>` before the add (swallow the "not found" error on a clean run).

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs` (reuse its DI pattern — `worktreeRunner`/`provisionDeps`/`gateRunner` stubs):

```js
test("runBaselineGate force-removes a leaked worktree before re-adding", async () => {
  const calls = [];
  const worktreeRunner = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "remove") throw new Error("fatal: ... is not a working tree"); // simulate clean run (nothing to remove)
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = await runBaselineGate({
    workdir: ".worktrees/upstream-swarm-baseline",
    logPath: "/tmp/x.log",
    worktreeRunner,
    provisionDeps: () => {},
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.equal(r.pass, true);
  const removeIdx = calls.findIndex((c) => c.startsWith("worktree remove"));
  const addIdx = calls.findIndex((c) => c.startsWith("worktree add"));
  assert.ok(removeIdx >= 0, "must attempt a remove");
  assert.ok(removeIdx < addIdx, "remove must precede add");
  assert.ok(calls[removeIdx].includes("--force"), "remove must be --force");
});
```

> If the test file mocks `provisionDeps`/`gateRunner` differently, match its existing shape; the key assertions are the remove-before-add ordering and `--force`. Confirm the existing baseline-gate tests still pass after the change (they pass a `worktreeRunner` that may now also receive the `remove` call — a stub that returns ok for any args is fine).

- [ ] **Step 2: Run to verify failure** — no `worktree remove` call is currently made.

- [ ] **Step 3: Implement**

In `baseline-gate.mjs` `runBaselineGate`, before the `worktree add` line (`:36`), add the idempotent pre-remove:

```js
  // Idempotent: a prior failed gate may have left this worktree on disk
  // (it's deliberately kept for inspection). Force-remove it first so the
  // add below doesn't throw "worktree already exists". Best-effort.
  try { worktreeRunner(["worktree", "remove", "--force", workdir]); } catch { /* nothing to remove */ }
  // Create a detached worktree at base.
  worktreeRunner(["worktree", "add", "--detach", workdir, base]);
```

- [ ] **Step 4: SKILL.md**

In `.claude/skills/upstream-swarm/SKILL.md` (`:138-140`, the baseline-worktree note), update it to reflect idempotency + registry cleanup:

```markdown
   The baseline worktree at `.worktrees/upstream-swarm-baseline` is removed on the
   gate's success path; on failure it is left for inspection but the next run (or
   `--resume`) force-removes it before re-creating, so a leaked baseline worktree
   no longer blocks a re-run. It is also tracked in the worktree registry, so
   `--clean-worktrees` prunes it by TTL.
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail. Also run `node --test .claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs` to confirm the existing baseline-gate tests still pass.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/baseline-gate.mjs .claude/skills/upstream-swarm/scripts/__tests__/baseline-gate.test.mjs .claude/skills/upstream-swarm/SKILL.md
git commit -m "$(cat <<'EOF'
fix(upstream-swarm): idempotent baseline-gate worktree (force-remove leak before add)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: allowlist-drift validation (merge)

**Files:**
- Modify: `.claude/skills/_common/scripts/evaluate-checks.mjs` (new `fetchBranchProtection` + `checkAllowlistDrift`)
- Modify: `.claude/skills/upstream-merge/SKILL.md` (Phase A startup note)
- Test: `.claude/skills/_common/scripts/__tests__/evaluate-checks.test.mjs`

The required-checks allowlist (`config.json`) is never compared to live GitHub branch-protection, so it silently drifts. Add a pure `checkAllowlistDrift` (compares the allowlist to the live required-contexts both ways) + a `fetchBranchProtection` fetcher; the merge orchestrator runs it **once at startup** and warns (non-blocking).

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/_common/scripts/__tests__/evaluate-checks.test.mjs`:

```js
import { checkAllowlistDrift } from "../evaluate-checks.mjs";

test("checkAllowlistDrift flags stale allowlist entries and newly-required checks", () => {
  const allowlist = { required: ["build", "test-unit", "old-check"], conditional: ["security-audit"] };
  const liveContexts = ["build", "test-unit", "test-packages"]; // old-check gone; test-packages new
  const r = checkAllowlistDrift({ allowlist, liveContexts });
  assert.equal(r.checked, true);
  assert.deepEqual(r.missingFromCi, ["old-check"]);     // allowlisted but no longer required by branch protection
  assert.deepEqual(r.unguarded, ["test-packages"]);     // newly required, not in allowlist
  assert.ok(r.warnings.some((w) => /old-check/.test(w)));
  assert.ok(r.warnings.some((w) => /test-packages/.test(w)));
});

test("checkAllowlistDrift reports no drift when in sync (conditional checks don't count as unguarded)", () => {
  const allowlist = { required: ["build"], conditional: ["security-audit"] };
  const r = checkAllowlistDrift({ allowlist, liveContexts: ["build"] });
  assert.deepEqual(r.missingFromCi, []);
  assert.deepEqual(r.unguarded, []);
  assert.deepEqual(r.warnings, []);
});

test("checkAllowlistDrift skips gracefully when branch protection is unavailable", () => {
  const r = checkAllowlistDrift({ allowlist: { required: ["build"] }, liveContexts: null });
  assert.equal(r.checked, false);
  assert.ok(r.warnings.some((w) => /unavailable|skipped/i.test(w)));
});
```

- [ ] **Step 2: Run to verify failure** — `checkAllowlistDrift` not exported.

- [ ] **Step 3: Implement in `evaluate-checks.mjs`**

```js
/**
 * Compare the required-checks allowlist against the LIVE branch-protection
 * required contexts, both directions. Pure.
 *   missingFromCi — allowlisted `required` checks no longer required upstream
 *                   (stale allowlist entry).
 *   unguarded     — live-required checks absent from required ∪ conditional
 *                   (we'd merge without gating them).
 * `liveContexts === null` ⇒ branch protection unavailable ⇒ checked:false.
 */
export function checkAllowlistDrift({ allowlist, liveContexts }) {
  if (!Array.isArray(liveContexts)) {
    return { checked: false, warnings: ["branch protection unavailable — allowlist-drift check skipped"], missingFromCi: [], unguarded: [] };
  }
  const required = Array.isArray(allowlist) ? allowlist : (allowlist.required ?? []);
  const conditional = Array.isArray(allowlist) ? [] : (allowlist.conditional ?? []);
  const guarded = new Set([...required, ...conditional]);
  const live = new Set(liveContexts);
  const missingFromCi = required.filter((c) => !live.has(c));
  const unguarded = liveContexts.filter((c) => !guarded.has(c));
  const warnings = [
    ...missingFromCi.map((c) => `allowlisted required check "${c}" is no longer in branch protection — remove it from config.requiredChecks`),
    ...unguarded.map((c) => `branch protection requires "${c}" but it is not in the allowlist — add it to config.requiredChecks`),
  ];
  return { checked: true, warnings, missingFromCi, unguarded };
}

/** Fetch the live required-status-check contexts for a branch (null on no protection). */
export function fetchBranchProtection({ repo = "cmetech/otto-cli", branch = "main", ghRunner = defaultGhRunner }) {
  try {
    const raw = ghRunner(["api", `repos/${repo}/branches/${branch}/protection/required_status_checks`, "--jq", ".contexts"]);
    const v = JSON.parse(raw || "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null; // unprotected branch / no access → drift check skips
  }
}
```

> `defaultGhRunner` already exists in this file. Place these exports after `loadAllowlist`.

- [ ] **Step 4: SKILL.md**

In `.claude/skills/upstream-merge/SKILL.md` Phase A (the run-setup section, near the ledger init `:56`), add a startup drift-warning step:

```markdown
   **Allowlist-drift check (once, non-blocking).** Before gating, compare the
   required-checks allowlist to live branch protection:
   ```sh
   node -e "import('./.claude/skills/_common/scripts/evaluate-checks.mjs').then(m => {
     const live = m.fetchBranchProtection({ repo: 'cmetech/otto-cli' });
     const cfg = m.loadAllowlist('.claude/skills/upstream-merge/config.json');
     for (const w of m.checkAllowlistDrift({ allowlist: cfg, liveContexts: live }).warnings) console.error('⚠️ ' + w);
   })"
   ```
   Print any warnings and continue — drift is informational, never a merge blocker.
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/_common/scripts/evaluate-checks.mjs .claude/skills/_common/scripts/__tests__/evaluate-checks.test.mjs .claude/skills/upstream-merge/SKILL.md
git commit -m "$(cat <<'EOF'
feat(upstream): warn on required-checks allowlist drift vs branch protection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: targeted blocked-PR retry (merge)

**Files:**
- Modify: `.claude/skills/upstream-merge/scripts/merge-ledger.mjs` (new `requeuePr`)
- Modify: `.claude/skills/upstream-merge/SKILL.md` (Flags + a retry note)
- Test: `.claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs`

A `blocked` PR is terminal — `--resume` skips only `merged`, and there is no targeted re-gate. Add `requeuePr` to reset a non-merged PR back to `queued` (clearing stale gate fields), backing a `--retry <prs>` flag that re-gates specific PRs without re-running the whole selection.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs`:

```js
test("requeuePr resets a blocked PR to queued and clears stale gate fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "ml-retry-"));
  try {
    const path = join(dir, "led.json");
    initMergeLedger(path, { date: "d", prs: [{ number: 9, headRef: "x" }] });
    recordVerdict(path, 9, { status: "blocked", checks: { pass: false }, localGate: { pass: false }, reason: "ci red" });

    const pr = requeuePr(path, 9, { reason: "manual retry" });
    assert.equal(pr.status, "queued");
    assert.equal(pr.checks, null);
    assert.equal(pr.localGate, null);
    assert.equal(pr.reason, "manual retry");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requeuePr refuses to reset an already-merged PR", () => {
  const dir = mkdtempSync(join(tmpdir(), "ml-retry2-"));
  try {
    const path = join(dir, "led.json");
    initMergeLedger(path, { date: "d", prs: [{ number: 9, headRef: "x" }] });
    recordMerge(path, 9, { status: "merged", mergeSha: "abc1234" });
    assert.throws(() => requeuePr(path, 9, { reason: "nope" }), /merged/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

> Add `requeuePr` to the import.

- [ ] **Step 2: Run to verify failure** — `requeuePr` not exported.

- [ ] **Step 3: Implement**

In `merge-ledger.mjs`, add after `recordMerge`:

```js
/**
 * Reset a non-merged PR back to `queued` for a targeted re-gate (`--retry`),
 * clearing stale gate state so the re-run starts clean. Refuses on `merged`
 * (merging is irreversible — never re-gate a landed PR).
 */
export function requeuePr(path, number, { reason = "manual retry" } = {}) {
  return mutatePr(path, number, (pr) => {
    if (pr.status === "merged") throw new Error(`PR #${number} is already merged — cannot requeue`);
    pr.status = "queued";
    pr.checks = null;
    pr.localGate = null;
    pr.reason = reason;
  });
}
```

- [ ] **Step 4: SKILL.md**

In `.claude/skills/upstream-merge/SKILL.md` Flags (`:160-167`), add after `--resume`:

```markdown
- `--retry <prs>` — targeted re-gate of one or more **blocked** PRs (comma list).
  For each, `requeuePr(path, <pr>, { reason })` resets it `blocked → queued` and
  clears stale gate state, then the normal Phase B gates re-run for just those
  PRs (`select-prs --issues <prs>`). A PR that blocks again stays `blocked` — a
  human then labels it `status:needs-human`. Already-`merged` PRs are refused.
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-merge/scripts/merge-ledger.mjs .claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs .claude/skills/upstream-merge/SKILL.md
git commit -m "$(cat <<'EOF'
feat(upstream-merge): targeted --retry re-gate for blocked PRs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: swarm refute-gate read-back (defense-in-depth)

**Files:**
- Modify: `.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs` (new `readRefuteVerdict`)
- Modify: `.claude/skills/upstream-swarm/SKILL.md` (`merge-pr` action :115)
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs`

The swarm `merge-pr` action hardcodes `--refute-verdict approve`, relying solely on the state machine (only `approved` issues reach `merge-pr`). Defense-in-depth: read the literal verdict back from the ledger's recorded `refute.tally.panelVerdict` and pass THAT — so an out-of-band `merge-pr` cannot supply `approve` without a recorded panel verdict.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs` (add `readRefuteVerdict` to the import):

```js
test("readRefuteVerdict returns the recorded panel verdict, or null when absent", () => {
  const ledger = { issues: {
    7: { state: "approved", refute: { tally: { panelVerdict: "approve" } } },
    8: { state: "selected" },
    9: { state: "approved", refute: { tally: {} } },
  } };
  assert.equal(readRefuteVerdict(ledger, 7), "approve");
  assert.equal(readRefuteVerdict(ledger, 8), null);
  assert.equal(readRefuteVerdict(ledger, 9), null);
  assert.equal(readRefuteVerdict(ledger, 999), null);
});
```

- [ ] **Step 2: Run to verify failure** — `readRefuteVerdict` not exported.

- [ ] **Step 3: Implement**

In `swarm-ledger.mjs`, add (and export) the pure reader:

```js
/** Read the recorded refute panel verdict for an issue (null if not recorded). */
export function readRefuteVerdict(ledger, number) {
  return ledger?.issues?.[String(number)]?.refute?.tally?.panelVerdict ?? null;
}
```

- [ ] **Step 4: SKILL.md**

In `.claude/skills/upstream-swarm/SKILL.md` `merge-pr` action row (`:115`), replace the hardcoded `--refute-verdict approve` guidance with the read-back:

```markdown
   | `merge-pr` | Read the recorded panel verdict — `V=readRefuteVerdict(ledger, N)` — and pass it through: `merge-pr.mjs <N> --auto --refute-verdict "$V" --refute-reason "..."`. If `V !== "approve"` (or null), do NOT merge — this is a recorded-verdict read-back, so an out-of-band merge can't supply `approve` without the panel having recorded it (the state machine still gates `merge-pr` on the `approved` state; this is defense-in-depth). Severity routing for `feature`/`critical-stability` happens at fix-ok→pending-human-review (skip merge). |
```

- [ ] **Step 5: Run the tests** — expected PASS, then the full regression net — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/swarm-ledger.mjs .claude/skills/upstream-swarm/scripts/__tests__/swarm-ledger.test.mjs .claude/skills/upstream-swarm/SKILL.md
git commit -m "$(cat <<'EOF'
feat(upstream-swarm): read refute verdict back from ledger instead of hardcoded approve

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final verification + branch finalize

**Files:** none (verification only)

- [ ] **Step 1: Run the complete skill suite** (full glob from Pre-flight). Expected: 388 baseline + new Phase-5 tests, 0 fail.

- [ ] **Step 2: Run the swarm integration tests** (NOT in the regression glob):

```bash
node --test .claude/skills/upstream-swarm/scripts/__tests__/integration/*.test.mjs
```
Expected: 7/8 — only `baseline-abort` fails (pre-existing symlink/provisionDeps infra issue; verify it still fails on `main`, unchanged by this phase). Task 4 made `runBaselineGate` idempotent, which should NOT affect that test (its failure is in `provisionWorktreeNodeModules`, not the add). If Task 4 accidentally changed its failure mode, investigate.

- [ ] **Step 3: Grep the invariants**

Run: `grep -rn "import.*\.\./\.\./upstream-\(fix\|merge\|swarm\|cherry-pick\)/scripts" .claude/skills/*/scripts/*.mjs`
Expected: no PRODUCTION cross-skill imports (ignore `__tests__/` hits).

Confirm the new exports exist and are wired:
`grep -rn "recordRefute\|checkAllowlistDrift\|fetchBranchProtection\|recordReviewerRejection\|requeuePr\|readRefuteVerdict\|cacheAgeWarningMs" .claude/skills/` — each should appear in BOTH a script and its SKILL.md (or test).

- [ ] **Step 4: Finalize the branch**

Use `superpowers:finishing-a-development-branch`. Per the established per-phase workflow (Phase 0+1 → `0cf2b583`, Phase 2 → `a9ebe2f4`, Phase 3 → `85ed40ac`, Phase 4 → `a7fd9a82`, all `--no-ff` merges to `main`), merge `feat/upstream-hardening-phase-5` to `main` with `--no-ff`. Confirm with Corey if a PR is preferred instead.

- [ ] **Step 5: Update the memory file**

Update `project_upstream_pipeline_hardening.md`: mark Phase 5 DONE (commit sha, final suite count) and note the **entire hardening initiative (Phases 0–5) is complete** — the pipeline is now ready to resume porting. Record the 7 shipped items + the dropped wave-bundling (deferred), and the two follow-ups worth tracking: (a) the `baseline-abort` integration test still fails (pre-existing infra), (b) the per-task regression glob should include `__tests__/integration/`.

---

## Self-Review (run before execution)

**Spec coverage (§5), decisions applied:**
- §5.1 cache TTL warning → Task 1 (mtime-based, `--cache-age-warning`). ✅
- §5.2 preserve full refute verdict → Task 2 (`refute` field + `recordRefute`, all lenses + confidence + blocking + tally). ✅
- §5.3 reviewer-rejection retry → Task 3 (automatic bounded-1, `reviewerRejectionCount`). Decision: automatic. ✅
- §5.4 baseline-gate auto-cleanup → Task 4 (idempotent force-remove; registry already wired). ✅
- §5.5 allowlist-drift validation → Task 5 (`checkAllowlistDrift` + `fetchBranchProtection`, warn once/run). Decision: startup warn. ✅
- §5.6 retry/escalate blocked PRs → Task 6 (`requeuePr` + `--retry <prs>`). ✅
- §5.7 smarter wave bundling → **DROPPED** (deferred; documented in Task 8). Decision: drop. ✅
- §5.8 swarm refute-gate read-back → Task 7 (`readRefuteVerdict`). ✅

**Cross-task coupling:** Task 2 (`refute` field in MERGE ledger) and Task 7 (read-back from SWARM ledger) are independent — the swarm already writes `refute` on its approved transition; Task 7 only adds a reader. Task 5's `fetchBranchProtection`/`checkAllowlistDrift` live in `_common/evaluate-checks.mjs` (where the allowlist concept already lives) and reuse its `defaultGhRunner`/`loadAllowlist`.

**Placeholder scan:** every code step has full source; doc steps have exact insertion text. No TBD/TODO.

**Type/name consistency:** new exports — `recordRefute`/`requeuePr` (merge-ledger), `checkAllowlistDrift`/`fetchBranchProtection` (evaluate-checks), `recordReviewerRejection` (fix ledger), `readRefuteVerdict` (swarm-ledger), `cacheAgeWarningMs`/`mtimeOf`/`now` (fetch-pr-context) — are used identically across each task's code, tests, and SKILL.md.

**Watch-points for the executor:**
- Task 1: `fetchPrContext` is `async` and used by `run-audit.mjs`; confirm the call-site wiring (imported fn vs subprocess) and pass `cacheAgeWarningMs` whichever way it's called. The mtime approach needs no cache-format migration — existing caches work.
- Task 4: the existing baseline-gate tests pass a `worktreeRunner` stub — it now also receives a `worktree remove` call; a permissive stub is unaffected, but verify. Do NOT expect Task 4 to fix the `baseline-abort` integration test (that's a `provisionWorktreeNodeModules` symlink issue, separate).
- Task 5: `fetchBranchProtection` must fail-open (return `null` on a 404/unprotected branch) so a repo without branch protection doesn't error the merge run.
- Task 6: `requeuePr` must refuse `merged` (a landed PR must never be re-gated).
- Task 7: the swarm path's safety still rests on the state machine (`merge-pr` only for `approved`); the read-back is additive defense-in-depth, not a replacement.
