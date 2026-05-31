# upstream-merge Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `upstream-merge`, the third stage of the upstream-port pipeline: discover candidate PRs, confirm each against a required-checks allowlist (GitHub) **and** a local trial-merge full-suite run, then squash-merge behind a human gate (default) or unattended under `--auto`.

**Architecture:** Five deterministic, unit-tested ESM helper scripts (`.mjs`) plus an agent-driven `SKILL.md` orchestrator. Scripts take injected `gh`/`git` runners so they test without network. An on-disk run-state ledger is the source of truth; logs/diffs never enter controller context. Mirrors the established `upstream-fix` skill conventions exactly.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `gh` CLI, `git` worktrees. No external deps.

**Self-modification note for the executor:** This plan CREATES files under `.claude/skills/upstream-merge/`. In auto-mode, editing `.claude/skills/**` can trigger a self-modification confirmation — expect it and proceed (these are new skill files, not edits to the running skill). The path is git-tracked (verified: not gitignored), so plain `git add` works.

**Spec:** `docs/superpowers/specs/2026-05-31-upstream-merge-skill-design.md`

**Reference implementations to mirror (read before starting):**
- `.claude/skills/upstream-fix/scripts/select-issues.mjs` (gh runner injection, CLI `import.meta` guard, JSON-out contract)
- `.claude/skills/upstream-fix/scripts/run-gates.mjs` (reused for the local `full` gate)
- `.claude/skills/upstream-fix/scripts/ledger.mjs` (ledger primitives pattern)
- `.claude/skills/upstream-fix/scripts/worktree-setup.mjs` + `worktree-merge.mjs` (git runner, `SAFE` name guard, abort-on-conflict)
- `.claude/skills/upstream-fix/scripts/__tests__/select-issues.test.mjs` (test style: tmpdir, fake runners)

---

## File Structure

**Create:**
- `.claude/skills/upstream-merge/SKILL.md` — agent orchestrator (Phases A–D).
- `.claude/skills/upstream-merge/README.md` — one-screen pointer doc.
- `.claude/skills/upstream-merge/config.json` — `{ "requiredChecks": [...] }` allowlist.
- `.claude/skills/upstream-merge/scripts/merge-ledger.mjs` — run-state ledger primitives.
- `.claude/skills/upstream-merge/scripts/evaluate-checks.mjs` — pure check-policy evaluation + allowlist loader + CLI.
- `.claude/skills/upstream-merge/scripts/select-prs.mjs` — resolve invocation → queued PR list.
- `.claude/skills/upstream-merge/scripts/trial-merge.mjs` — worktree trial-merge of a PR head into current `main`.
- `.claude/skills/upstream-merge/scripts/merge-pr.mjs` — squash-merge wrapper (`gh pr merge`).
- `.claude/skills/upstream-merge/scripts/__tests__/*.test.mjs` — one test file per script.

**Reuse (no change):**
- `.claude/skills/upstream-fix/scripts/run-gates.mjs` (`full` gate).
- `.claude/skills/upstream-fix/scripts/issue-update.mjs` (close linked issues post-merge if any remain open).

Each script has one responsibility and is held in context independently. Tests run standalone: `node --test <path>` (these are NOT wired into `npm test`).

---

## Task 1: merge-ledger.mjs — run-state ledger

**Files:**
- Create: `.claude/skills/upstream-merge/scripts/merge-ledger.mjs`
- Test: `.claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initMergeLedger, readLedger, recordVerdict, recordMerge } from "../merge-ledger.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "um-ledger-")); }

test("initMergeLedger seeds one queued record per PR", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    const led = initMergeLedger(path, { date: "2026-05-31", prs: [
      { number: 64, headRef: "integration/upstream-fix-2026-05-30", isDraft: false },
    ] });
    assert.equal(led.version, 1);
    assert.equal(led.prs["64"].status, "queued");
    assert.equal(led.prs["64"].headRef, "integration/upstream-fix-2026-05-30");
    assert.equal(readLedger(path).prs["64"].mergeSha, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordVerdict and recordMerge mutate and persist", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initMergeLedger(path, { date: "2026-05-31", prs: [{ number: 64, headRef: "x", isDraft: false }] });
    recordVerdict(path, 64, { status: "confirmed", checks: { pass: true }, localGate: { pass: true } });
    assert.equal(readLedger(path).prs["64"].status, "confirmed");
    assert.equal(readLedger(path).prs["64"].checks.pass, true);
    recordMerge(path, 64, { status: "merged", mergeSha: "abc1234" });
    const led = readLedger(path);
    assert.equal(led.prs["64"].status, "merged");
    assert.equal(led.prs["64"].mergeSha, "abc1234");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordVerdict throws on unknown PR", () => {
  const dir = tmp();
  try {
    const path = join(dir, "state.json");
    initMergeLedger(path, { date: "2026-05-31", prs: [] });
    assert.throws(() => recordVerdict(path, 999, { status: "confirmed" }), /unknown PR/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs`
Expected: FAIL — `Cannot find module '../merge-ledger.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
/**
 * merge-ledger.mjs — run-state ledger for upstream-merge (source of truth on disk).
 * As module: import { initMergeLedger, readLedger, writeLedger, recordVerdict, recordMerge } from "./merge-ledger.mjs"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function readLedger(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeLedger(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function initMergeLedger(path, { date, prs }) {
  const ledger = { version: 1, date, prs: {} };
  for (const pr of prs) {
    ledger.prs[String(pr.number)] = {
      headRef: pr.headRef ?? null,
      isDraft: pr.isDraft ?? false,
      status: "queued",        // queued | confirmed | merged | blocked | skipped
      checks: null,            // evaluateChecks() result
      localGate: null,         // { pass, failTail }
      mergeSha: null,
      reason: null,
    };
  }
  writeLedger(path, ledger);
  return ledger;
}

function mutatePr(path, number, fn) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const pr = ledger.prs[String(number)];
  if (!pr) throw new Error(`unknown PR #${number} in ledger`);
  fn(pr);
  writeLedger(path, ledger);
  return pr;
}

export function recordVerdict(path, number, { status = null, checks = null, localGate = null, reason = null }) {
  return mutatePr(path, number, (pr) => {
    if (status !== null) pr.status = status;
    if (checks !== null) pr.checks = checks;
    if (localGate !== null) pr.localGate = localGate;
    if (reason !== null) pr.reason = reason;
  });
}

export function recordMerge(path, number, { status = "merged", mergeSha = null }) {
  return mutatePr(path, number, (pr) => {
    pr.status = status;
    if (mergeSha !== null) pr.mergeSha = mergeSha;
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) { process.stderr.write(JSON.stringify({ error: "Usage: node merge-ledger.mjs <ledger-path>" }) + "\n"); process.exit(1); }
  process.stdout.write(JSON.stringify(readLedger(path), null, 2) + "\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs`
Expected: PASS — `# pass 3 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-merge/scripts/merge-ledger.mjs .claude/skills/upstream-merge/scripts/__tests__/merge-ledger.test.mjs
git commit -m "feat(upstream-merge): run-state ledger primitives"
```

---

## Task 2: config.json + evaluate-checks.mjs — required-checks policy

**Files:**
- Create: `.claude/skills/upstream-merge/config.json`
- Create: `.claude/skills/upstream-merge/scripts/evaluate-checks.mjs`
- Test: `.claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs`

- [ ] **Step 1: Write the config file**

```json
{
  "requiredChecks": [
    "build",
    "test-unit",
    "test-packages",
    "fast-gates",
    "cargo audit",
    "npm audit (.)"
  ]
}
```

- [ ] **Step 2: Write the failing test**

The check shape is exactly what `gh pr checks <n> --json name,bucket,state` returns. `bucket` is one of `pass | fail | pending | skipping | cancel`.

```javascript
// .claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChecks, loadAllowlist } from "../evaluate-checks.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ALLOW = ["build", "test-unit", "test-packages", "fast-gates", "cargo audit", "npm audit (.)"];

// Mirrors PR #64: all required green; 3 fail + 1 cancel + 1 skipping are NOT required.
const PR64 = [
  { name: "test-packages", bucket: "pass" },
  { name: "e2e", bucket: "fail" },
  { name: "test-unit", bucket: "pass" },
  { name: "integration-tests", bucket: "fail" },
  { name: "docker-e2e", bucket: "fail" },
  { name: "windows-portability", bucket: "cancel" },
  { name: "test-coverage", bucket: "skipping" },
  { name: "build", bucket: "pass" },
  { name: "fast-gates", bucket: "pass" },
  { name: "npm audit (.)", bucket: "pass" },
  { name: "cargo audit", bucket: "pass" },
];

test("passes when all required green; informational reds collected; skipping not red", () => {
  const r = evaluateChecks(PR64, ALLOW);
  assert.equal(r.pass, true);
  assert.equal(r.pending.length, 0);
  assert.equal(r.blocking.length, 0);
  assert.deepEqual(
    [...r.informationalReds].sort(),
    ["docker-e2e", "e2e", "integration-tests", "windows-portability"],
  );
});

test("a red required check blocks", () => {
  const checks = PR64.map((c) => (c.name === "build" ? { ...c, bucket: "fail" } : c));
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.equal(r.blocking[0].name, "build");
  assert.match(r.blocking[0].reason, /fail/);
});

test("a pending required check triggers wait, not pass", () => {
  const checks = PR64.map((c) => (c.name === "test-unit" ? { ...c, bucket: "pending" } : c));
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.deepEqual(r.pending, ["test-unit"]);
});

test("a missing required check blocks", () => {
  const checks = PR64.filter((c) => c.name !== "cargo audit");
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.ok(r.blocking.some((b) => b.name === "cargo audit" && /missing/.test(b.reason)));
});

test("loadAllowlist reads requiredChecks from config.json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = join(here, "..", "..", "config.json");
  const allow = loadAllowlist(cfg);
  assert.deepEqual(allow, ALLOW);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs`
Expected: FAIL — `Cannot find module '../evaluate-checks.mjs'`.

- [ ] **Step 4: Write minimal implementation**

```javascript
#!/usr/bin/env node
/**
 * evaluate-checks.mjs — evaluate `gh pr checks --json name,bucket,state` output
 * against a required-checks allowlist. Pure; returns a compact verdict.
 * CLI: node evaluate-checks.mjs <pr-number> [--config <path>] [--repo <owner/name>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RED_BUCKETS = new Set(["fail", "cancel"]);

/** @returns {{pass, pending:string[], blocking:{name,reason}[], informationalReds:string[]}} */
export function evaluateChecks(checks, allowlist) {
  const required = new Set(allowlist);
  const byName = new Map();
  for (const c of checks) byName.set(c.name, c.bucket);

  const blocking = [];
  const pending = [];
  for (const name of allowlist) {
    const bucket = byName.get(name);
    if (bucket === undefined) blocking.push({ name, reason: "required check missing" });
    else if (bucket === "pending") pending.push(name);
    else if (bucket === "pass") { /* ok */ }
    else blocking.push({ name, reason: `required check ${bucket}` });
  }

  const informationalReds = checks
    .filter((c) => !required.has(c.name) && RED_BUCKETS.has(c.bucket))
    .map((c) => c.name);

  return { pass: blocking.length === 0 && pending.length === 0, pending, blocking, informationalReds };
}

export function loadAllowlist(configPath) {
  const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!Array.isArray(cfg.requiredChecks)) throw new Error("config.requiredChecks must be an array");
  return cfg.requiredChecks;
}

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }); }

export function fetchAndEvaluate({ prNumber, repo = "cmetech/otto-cli", configPath, ghRunner = defaultGhRunner }) {
  const raw = ghRunner(["pr", "checks", String(prNumber), "--repo", repo, "--json", "name,bucket,state"]);
  const checks = JSON.parse(raw);
  return evaluateChecks(checks, loadAllowlist(configPath));
}

function parseArgv(argv) {
  const prNumber = argv[0];
  const here = dirname(fileURLToPath(import.meta.url));
  let configPath = join(here, "..", "config.json");
  let repo = "cmetech/otto-cli";
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--config") configPath = argv[++i];
    else if (argv[i] === "--repo") repo = argv[++i];
  }
  return { prNumber, configPath, repo };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { prNumber, configPath, repo } = parseArgv(process.argv.slice(2));
    if (!prNumber) throw new Error("Usage: node evaluate-checks.mjs <pr-number> [--config <path>] [--repo <owner/name>]");
    const r = fetchAndEvaluate({ prNumber, repo, configPath });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.pass) process.exit(2);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

Note the CLI `gh pr checks` exits non-zero when checks aren't all passing; `fetchAndEvaluate` uses the JSON output, so the executor must call it with a runner that returns stdout even on non-zero exit. For the unit tests we only exercise the pure `evaluateChecks`/`loadAllowlist`, so this does not affect Step 5. (The SKILL.md wires the live fetch in Task 6 and tolerates the non-zero exit.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs`
Expected: PASS — `# pass 5 # fail 0`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/upstream-merge/config.json .claude/skills/upstream-merge/scripts/evaluate-checks.mjs .claude/skills/upstream-merge/scripts/__tests__/evaluate-checks.test.mjs
git commit -m "feat(upstream-merge): required-checks allowlist policy evaluation"
```

---

## Task 3: select-prs.mjs — PR discovery & selection

**Files:**
- Create: `.claude/skills/upstream-merge/scripts/select-prs.mjs`
- Test: `.claude/skills/upstream-merge/scripts/__tests__/select-prs.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/skills/upstream-merge/scripts/__tests__/select-prs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListArgs, globToRegExp, filterPrs, selectPrs } from "../select-prs.mjs";

test("globToRegExp turns a head glob into an anchored matcher", () => {
  const re = globToRegExp("integration/upstream-fix-*");
  assert.ok(re.test("integration/upstream-fix-2026-05-30"));
  assert.ok(!re.test("feature/other"));
  assert.ok(!re.test("xintegration/upstream-fix-1")); // anchored
});

test("buildListArgs targets open PRs to main with the needed fields", () => {
  const args = buildListArgs("cmetech/otto-cli");
  assert.ok(args.includes("--base") && args.includes("main"));
  assert.ok(args.includes("--state") && args.includes("open"));
  assert.ok(args.join(" ").includes("number,headRefName,isDraft"));
});

test("filterPrs drops drafts and non-matching heads", () => {
  const prs = [
    { number: 64, headRefName: "integration/upstream-fix-2026-05-30", isDraft: false },
    { number: 70, headRefName: "integration/upstream-fix-2026-06-01", isDraft: true },
    { number: 71, headRefName: "feature/unrelated", isDraft: false },
  ];
  const out = filterPrs(prs, "integration/upstream-fix-*");
  assert.deepEqual(out.map((p) => p.number), [64]);
});

test("selectPrs filter mode queries list then filters", () => {
  const calls = [];
  const ghRunner = (args) => {
    calls.push(args);
    return JSON.stringify([
      { number: 64, headRefName: "integration/upstream-fix-2026-05-30", isDraft: false },
      { number: 71, headRefName: "feature/unrelated", isDraft: false },
    ]);
  };
  const r = selectPrs({ mode: "filter", filterGlob: "integration/upstream-fix-*", ghRunner });
  assert.equal(r.count, 1);
  assert.deepEqual(r.prs.map((p) => p.number), [64]);
  assert.ok(calls[0].includes("list"));
});

test("selectPrs explicit mode views each number and excludes drafts", () => {
  const ghRunner = (args) => {
    const n = Number(args[2]);
    return JSON.stringify({ number: n, headRefName: `integration/upstream-fix-${n}`, isDraft: n === 99, state: "OPEN" });
  };
  const r = selectPrs({ mode: "explicit", numbers: [64, 99], ghRunner });
  assert.deepEqual(r.prs.map((p) => p.number), [64]); // 99 is a draft, excluded
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/select-prs.test.mjs`
Expected: FAIL — `Cannot find module '../select-prs.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
/**
 * select-prs.mjs — resolve an invocation to a queued list of PRs.
 * Modes: explicit numbers | current branch | filter (default head glob).
 * Writes <date>-selected-prs.json; prints { count, path }.
 * CLI: node select-prs.mjs [--issues 64,70 | --filter [glob] | --current] [--out <path>] [--repo <owner/name>]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_REPO = "cmetech/otto-cli";
const DEFAULT_GLOB = "integration/upstream-fix-*";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }); }

export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function buildListArgs(repo = DEFAULT_REPO) {
  return ["pr", "list", "--repo", repo, "--base", "main", "--state", "open",
    "--limit", "100", "--json", "number,headRefName,isDraft"];
}

export function filterPrs(prs, glob) {
  const re = globToRegExp(glob);
  return prs.filter((p) => !p.isDraft && re.test(p.headRefName));
}

function normalize(p) { return { number: p.number, headRef: p.headRefName, isDraft: !!p.isDraft }; }

export function selectPrs({ mode, numbers = [], filterGlob = DEFAULT_GLOB, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, outPath = null }) {
  let prs;
  if (mode === "explicit") {
    prs = [];
    for (const n of numbers) {
      const p = JSON.parse(ghRunner(["pr", "view", String(n), "--repo", repo, "--json", "number,headRefName,isDraft,state"]));
      if (!p.isDraft) prs.push(normalize(p));
    }
  } else if (mode === "current") {
    const p = JSON.parse(ghRunner(["pr", "view", "--repo", repo, "--json", "number,headRefName,isDraft,state"]));
    prs = p.isDraft ? [] : [normalize(p)];
  } else { // filter
    const all = JSON.parse(ghRunner(buildListArgs(repo)));
    prs = filterPrs(Array.isArray(all) ? all : [], filterGlob).map(normalize);
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(prs, null, 2) + "\n");
  }
  return { count: prs.length, path: outPath, prs };
}

function parseArgv(argv) {
  let mode = "current", numbers = [], filterGlob = DEFAULT_GLOB, outPath = null, repo = DEFAULT_REPO;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--issues") { mode = "explicit"; numbers = argv[++i].split(",").map((s) => Number(s.trim())); }
    else if (a === "--filter") { mode = "filter"; if (argv[i + 1] && !argv[i + 1].startsWith("--")) filterGlob = argv[++i]; }
    else if (a === "--current") mode = "current";
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--repo") repo = argv[++i];
  }
  return { mode, numbers, filterGlob, outPath, repo };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { mode, numbers, filterGlob, outPath, repo } = parseArgv(process.argv.slice(2));
    const r = selectPrs({ mode, numbers, filterGlob, repo, outPath });
    process.stdout.write(JSON.stringify({ count: r.count, path: r.path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/select-prs.test.mjs`
Expected: PASS — `# pass 5 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-merge/scripts/select-prs.mjs .claude/skills/upstream-merge/scripts/__tests__/select-prs.test.mjs
git commit -m "feat(upstream-merge): PR discovery and selection"
```

---

## Task 4: trial-merge.mjs — worktree trial-merge into current main

**Files:**
- Create: `.claude/skills/upstream-merge/scripts/trial-merge.mjs`
- Test: `.claude/skills/upstream-merge/scripts/__tests__/trial-merge.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/skills/upstream-merge/scripts/__tests__/trial-merge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { trialMerge } from "../trial-merge.mjs";

function recorder(opts = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args.join(" "));
    if (opts.failOn && args.join(" ").includes(opts.failOn)) throw new Error("merge conflict");
    return "";
  };
  return { runner, calls };
}

test("clean merge fetches, adds detached worktree at base, merges PR head", () => {
  const { runner, calls } = recorder();
  const r = trialMerge({ prNumber: 64, headRef: "integration/upstream-fix-2026-05-30", gitRunner: runner });
  assert.equal(r.conflict, false);
  assert.equal(r.merged, true);
  assert.equal(r.worktree, ".worktrees/upstream-merge-pr-64");
  assert.ok(calls.some((c) => c.startsWith("fetch origin")));
  assert.ok(calls.some((c) => c.includes("worktree add --detach .worktrees/upstream-merge-pr-64 origin/main")));
  assert.ok(calls.some((c) => c.includes("merge --no-ff --no-edit origin/integration/upstream-fix-2026-05-30")));
});

test("conflict aborts the merge and reports conflict:true", () => {
  const { runner, calls } = recorder({ failOn: "merge --no-ff" });
  const r = trialMerge({ prNumber: 64, headRef: "integration/upstream-fix-2026-05-30", gitRunner: runner });
  assert.equal(r.merged, false);
  assert.equal(r.conflict, true);
  assert.ok(calls.some((c) => c.includes("merge --abort")));
});

test("rejects unsafe ref names", () => {
  const { runner } = recorder();
  assert.throws(() => trialMerge({ prNumber: 64, headRef: "evil; rm -rf /", gitRunner: runner }), /unsafe/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/trial-merge.test.mjs`
Expected: FAIL — `Cannot find module '../trial-merge.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
/**
 * trial-merge.mjs — create a detached worktree at current origin/main and merge
 * a PR's head ref into it (no force, abort-on-conflict). The caller then runs
 * the local full-suite gate inside the worktree (run-gates.mjs full).
 * CLI: node trial-merge.mjs <prNumber> <headRef> [base]
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

export function trialMerge({ prNumber, headRef, base = "origin/main", gitRunner = defaultGitRunner }) {
  if (!Number.isInteger(prNumber)) throw new Error(`prNumber must be an integer: ${prNumber}`);
  if (!SAFE.test(headRef) || !SAFE.test(base)) throw new Error(`unsafe ref name: ${headRef} / ${base}`);
  const worktree = `.worktrees/upstream-merge-pr-${prNumber}`;

  gitRunner(["fetch", "origin", "--prune"]);
  gitRunner(["worktree", "add", "--detach", worktree, base]);
  try {
    gitRunner(["-C", worktree, "merge", "--no-ff", "--no-edit", `origin/${headRef}`]);
    return { worktree, merged: true, conflict: false };
  } catch {
    try { gitRunner(["-C", worktree, "merge", "--abort"]); } catch { /* nothing to abort */ }
    return { worktree, merged: false, conflict: true };
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const prNumber = Number(process.argv[2]);
    const headRef = process.argv[3];
    const base = process.argv[4] ?? "origin/main";
    if (!headRef) throw new Error("Usage: node trial-merge.mjs <prNumber> <headRef> [base]");
    process.stdout.write(JSON.stringify(trialMerge({ prNumber, headRef, base }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/trial-merge.test.mjs`
Expected: PASS — `# pass 3 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-merge/scripts/trial-merge.mjs .claude/skills/upstream-merge/scripts/__tests__/trial-merge.test.mjs
git commit -m "feat(upstream-merge): trial-merge worktree against current main"
```

---

## Task 5: merge-pr.mjs — squash-merge wrapper

**Files:**
- Create: `.claude/skills/upstream-merge/scripts/merge-pr.mjs`
- Test: `.claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePr } from "../merge-pr.mjs";

test("squash-merges with delete-branch and returns the merge sha", () => {
  const calls = [];
  const ghRunner = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "view") return JSON.stringify({ mergeCommit: { oid: "abc1234567" } });
    return "";
  };
  const r = mergePr({ number: 64, ghRunner });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "abc1234");
  const mergeCall = calls.find((c) => c.startsWith("pr merge"));
  assert.ok(mergeCall.includes("--squash"));
  assert.ok(mergeCall.includes("--delete-branch"));
});

test("never passes bypass flags", () => {
  const calls = [];
  const ghRunner = (args) => { calls.push(args.join(" ")); return args[1] === "view" ? JSON.stringify({ mergeCommit: { oid: "deadbee" } }) : ""; };
  mergePr({ number: 64, ghRunner });
  const mergeCall = calls.find((c) => c.startsWith("pr merge"));
  assert.ok(!/--admin|--no-verify|--bypass/.test(mergeCall));
});

test("rejects a non-integer PR number", () => {
  assert.throws(() => mergePr({ number: "64; rm -rf /", ghRunner: () => "" }), /integer/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`
Expected: FAIL — `Cannot find module '../merge-pr.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
/**
 * merge-pr.mjs — squash-merge a PR via `gh pr merge` and return the merge sha.
 * Locked: --squash --delete-branch only; never --admin / --no-verify / bypass.
 * CLI: node merge-pr.mjs <number> [--repo <owner/name>]
 */
import { execFileSync } from "node:child_process";

const DEFAULT_REPO = "cmetech/otto-cli";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 }); }

export function mergePr({ number, repo = DEFAULT_REPO, ghRunner = defaultGhRunner }) {
  if (!Number.isInteger(number)) throw new Error(`PR number must be an integer: ${number}`);
  ghRunner(["pr", "merge", String(number), "--repo", repo, "--squash", "--delete-branch"]);
  const view = JSON.parse(ghRunner(["pr", "view", String(number), "--repo", repo, "--json", "mergeCommit"]));
  const sha = view?.mergeCommit?.oid ? String(view.mergeCommit.oid).slice(0, 7) : null;
  return { merged: true, sha };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const number = Number(process.argv[2]);
    let repo = DEFAULT_REPO;
    for (let i = 3; i < process.argv.length; i++) if (process.argv[i] === "--repo") repo = process.argv[++i];
    if (!Number.isInteger(number)) throw new Error("Usage: node merge-pr.mjs <number> [--repo <owner/name>]");
    process.stdout.write(JSON.stringify(mergePr({ number, repo }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs`
Expected: PASS — `# pass 3 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-merge/scripts/merge-pr.mjs .claude/skills/upstream-merge/scripts/__tests__/merge-pr.test.mjs
git commit -m "feat(upstream-merge): squash-merge wrapper"
```

---

## Task 6: SKILL.md — agent orchestrator

**Files:**
- Create: `.claude/skills/upstream-merge/SKILL.md`

No automated test (it is a prose orchestrator). Verification is a structure check: every phase and locked invariant must be present.

- [ ] **Step 1: Write SKILL.md**

````markdown
---
name: upstream-merge
description: >
  Confirm and merge upstream-fix PRs on cmetech/otto-cli. Discovers candidate
  PRs (filter, explicit numbers, or current branch), confirms each against a
  required-checks allowlist on GitHub AND a local trial-merge full-suite run,
  then squash-merges behind a human gate (default) or unattended under --auto.
  Third stage of the upstream-port pipeline (cherry-pick → fix → merge). Use
  when asked to "merge the upstream PRs", "confirm and merge PR <n>", or
  "/upstream-merge". High-stakes — it moves code onto main.
---

# Upstream-Merge

Third stage of the upstream-port pipeline. `upstream-fix` opens reviewable PRs;
this skill *confirms their CI and merges them to `main`*. It is high-stakes — the
only skill that lands code on `main` — so it gates every merge on **two
independent signals** and a **human gate by default**.

> **Self-modification note:** this skill edits only otto-cli state, PRs, and
> `.planning/` artifacts during a run — never its own skill files.

## When to use

- "Merge the upstream PRs." / "Confirm and merge PR 64."
- `/upstream-merge` (current branch's PR), `/upstream-merge 64,70`, `/upstream-merge --filter`.

## Locked invariants (never violate)

- Never force-push; never commit to `main` directly; merge only via `gh pr merge`.
- Never `--no-verify`, `--admin`, or any hook/required-check bypass.
- Never merge a PR with a **red or missing required-allowlist check**.
- Never merge without **both** signals green (required checks + local full suite).
- Human gate is the default; only `--auto` removes it; the two-signal confirmation still gates every merge.
- Issue cap: if discovery returns **> 10** PRs, STOP and confirm before processing.

## Context budget

The controller's context grows with the *number of PRs*, not check/log content.
Never read a check log, gate log, or diff into the controller — scripts write
those to disk and return compact summaries. The loop adds only selection
descriptors, one verdict line per PR, one merge-result line per merged PR.
Progress lives in the ledger; `--resume` reconstructs everything.

## Phase A — Select (deterministic)

1. Resolve the invocation → mode: explicit `--issues 64,70`, `--filter [glob]`
   (default head `integration/upstream-fix-*`), or no-arg `--current`.
   ```sh
   DATE=$(date +%F); DIR=.planning/upstream-merges
   node .claude/skills/upstream-merge/scripts/select-prs.mjs <mode-args> --out $DIR/$DATE-selected-prs.json
   ```
   Read only the printed `{ count, path }`.
2. **Issue cap.** If `count` > 10, STOP and ask the user to confirm.
3. **`--dry-run`?** Continue through Phase B for visibility, then STOP before any merge.
4. Initialise the ledger (skip on `--resume`):
   ```sh
   node -e "import('./.claude/skills/upstream-merge/scripts/merge-ledger.mjs').then(m=>m.initMergeLedger('$DIR/$DATE-run-state.json',{date:'$DATE',prs:require('./$DIR/$DATE-selected-prs.json')}))"
   ```

## Phase B — Confirm (per PR, sequential)

For each queued PR, in order:

1. **Mergeability.** `gh pr view <n> --repo cmetech/otto-cli --json isDraft,mergeable,mergeStateStatus`.
   Draft / `CONFLICTING` / not `MERGEABLE` ⇒ record `blocked` (reason), skip.
2. **GitHub checks.** Poll until checks settle (no `pending`), then evaluate the allowlist:
   ```sh
   node .claude/skills/upstream-merge/scripts/evaluate-checks.mjs <n> --repo cmetech/otto-cli
   ```
   `gh pr checks` exits non-zero when not all green; capture stdout regardless
   (e.g. `... || true` around a stdout capture) — the JSON verdict is what matters.
   `pass:true` ⇒ continue. Any `blocking` ⇒ record `blocked` (name the check), skip.
   Non-empty `pending` ⇒ wait and re-poll (bounded budget; on timeout record `blocked`).
   Collect `informationalReds` for the report.
3. **Local gate.** Trial-merge into current `main`, install deps in the worktree,
   run the full suite:
   ```sh
   node .claude/skills/upstream-merge/scripts/trial-merge.mjs <n> <headRef>
   ( cd <worktree> && npm ci )   # the cost of the two-signal choice; deps must exist in the worktree
   node .claude/skills/upstream-fix/scripts/run-gates.mjs full \
     --cwd <worktree> --log $DIR/$DATE-gate-logs/pr-<n>-full.log
   ```
   `pass:true` required; else record `blocked` (reason "local full suite red"),
   keep the worktree + note its path, skip.

Fold one compact verdict line per PR into the ledger via `recordVerdict`. If a
failure needs inspection, dispatch a subagent or read the on-disk log with a
**bounded** line range — never `cat` a whole log.

## Phase C — Merge (per PR with a passing verdict)

1. **Human gate (default).** Present the verdict via `AskUserQuestion` (required
   checks ✓, informational reds, local suite ✓, mergeability) → approve / skip.
   Under `--auto`, skip the prompt.
2. **Merge.**
   ```sh
   node .claude/skills/upstream-merge/scripts/merge-pr.mjs <n> --repo cmetech/otto-cli
   ```
   Record `mergeSha` + status `merged` via `recordMerge`.
3. **Post-merge.** Verify the PR's linked issues are closed (`upstream-fix`
   closes them at PR-creation, normally a no-op). If any remain open:
   ```sh
   node .claude/skills/upstream-fix/scripts/issue-update.mjs <issue> --repo cmetech/otto-cli \
     --comment "Merged in <mergeSha>." --close
   ```

## Phase D — Report + cleanup

1. Write a rollup to `$DIR/$DATE-merge-report.md`: merged / skipped / blocked
   counts, each with its one-line reason and informational-red checks observed.
2. Worktree hygiene: `git worktree remove <worktree>` on success; leave + note
   path on any local-gate failure.

## Flags

- `--auto` / `--yes` — skip the human merge gate.
- `--dry-run` — select + confirm, merge nothing.
- `--resume` — idempotent re-run from the ledger; already-`merged` PRs skipped.
- `--filter <glob>` — override the default head-branch filter.

## References

- Design spec: `docs/superpowers/specs/2026-05-31-upstream-merge-skill-design.md`
- Companions: `.claude/skills/upstream-fix/SKILL.md`, `.claude/skills/upstream-cherry-pick/SKILL.md`
````

- [ ] **Step 2: Verify structure**

Run:
```bash
for s in "Phase A" "Phase B" "Phase C" "Phase D" "Locked invariants" "Context budget" "name: upstream-merge"; do
  grep -q "$s" .claude/skills/upstream-merge/SKILL.md && echo "ok: $s" || echo "MISSING: $s"; done
```
Expected: every line prints `ok:`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/upstream-merge/SKILL.md
git commit -m "feat(upstream-merge): agent orchestrator SKILL.md"
```

---

## Task 7: README.md — pointer doc

**Files:**
- Create: `.claude/skills/upstream-merge/README.md`

- [ ] **Step 1: Write README.md**

```markdown
# upstream-merge

Third stage of the upstream-port pipeline:

```
upstream-cherry-pick  →  upstream-fix  →  upstream-merge
   (triage → issues)     (port → PR)      (confirm → merge)
```

Confirms an `upstream-fix` PR against two independent signals and squash-merges
it to `main`:

1. **GitHub required-checks allowlist** (`config.json` → `requiredChecks`) — listed
   checks must be green; all other checks are informational (reported, never blocking).
2. **Local trial-merge full suite** — merges the PR head into current `main` in a
   throwaway worktree and runs `run-gates.mjs full`.

Merges are **human-gated by default**; `--auto` opts into unattended batch merging.

## Usage

```sh
/upstream-merge              # current branch's PR
/upstream-merge 64,70        # explicit PR numbers
/upstream-merge --filter     # discover open PRs to main (head integration/upstream-fix-*)
```

Flags: `--auto`, `--dry-run`, `--resume`, `--filter <glob>`.

## Scripts

| Script | Responsibility |
| --- | --- |
| `select-prs.mjs` | Resolve invocation → queued PR list |
| `evaluate-checks.mjs` | Evaluate `gh pr checks` against the allowlist |
| `trial-merge.mjs` | Worktree trial-merge of a PR head into current `main` |
| `merge-pr.mjs` | `gh pr merge --squash --delete-branch` + merge sha |
| `merge-ledger.mjs` | On-disk run-state ledger |

Reuses `upstream-fix`'s `run-gates.mjs` (`full` gate) and `issue-update.mjs`.

Run the unit tests: `node --test .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs`

See `docs/superpowers/specs/2026-05-31-upstream-merge-skill-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/upstream-merge/README.md
git commit -m "docs(upstream-merge): README pointer doc"
```

---

## Task 8: Full test sweep

- [ ] **Step 1: Run every new unit test together**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs`
Expected: all suites pass — `# fail 0`. (merge-ledger 3 + evaluate-checks 5 + select-prs 5 + trial-merge 3 + merge-pr 3 = 19 tests.)

- [ ] **Step 2: Confirm reused scripts are untouched**

Run: `git status --porcelain .claude/skills/upstream-fix/`
Expected: no output (we reused `run-gates.mjs`/`issue-update.mjs` without modifying them).

---

## Self-Review notes (author)

- **Spec coverage:** §4 invocation→Task 3 + SKILL Phase A; §5 allowlist→Task 2; §6 Phase A→Task 3, Phase B mergeability/checks→Tasks 2/6, Phase B local gate→Task 4 + reused run-gates, Phase C→Tasks 5/6, Phase D→Task 6; §7 scripts→Tasks 1–5; §8 invariants→Task 5 (no-bypass test) + SKILL "Locked invariants". All covered.
- **Deferred items from spec §9:** poll/wait budget — SKILL Phase B says "bounded budget" (executor sets the number); allowlist location — resolved to `config.json` (Task 2); out-of-band-merge resume — SKILL `--resume` skips `merged`; add a `gh pr view state` check there if a PR was merged externally.
- **Type/name consistency:** ledger keys (`status,checks,localGate,mergeSha,reason`) match across Tasks 1/6; `evaluateChecks` return shape (`pass,pending,blocking,informationalReds`) matches Tasks 2/6; `trialMerge` returns `{worktree,merged,conflict}` used by SKILL Phase B; `mergePr` returns `{merged,sha}` used by SKILL Phase C.
- **No placeholders:** every code step is complete and runnable.
