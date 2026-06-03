# Upstream-Fix Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/upstream-fix` skill at `.claude/skills/upstream-fix/` — the implementer companion to `upstream-cherry-pick`. It selects filed `cmetech/otto-cli` issues by grouping, fixes each on a file-disjoint git-worktree lane via parallel fix subagents (cap 3), gates every fix on four mandatory confidence checks (regression test · build · targeted+full suite · reviewer subagent), integrates accepted fixes into one PR, closes issues, and writes a report — all while keeping the controller's context flat via an on-disk run-state ledger.

**Architecture:** Deterministic Node ESM `.mjs` helpers (`scripts/*.mjs`) do all scriptable plumbing — selection, lane planning, scheduling, worktree setup/merge, gate execution, ledger I/O, issue updates, report generation. `SKILL.md` is the agentic orchestration layer: it dispatches one fix subagent per lane and a reviewer subagent per resolved issue, makes accept/reject calls, and drives integration. A `.claude/commands/upstream-fix.md` wrapper enables `/upstream-fix <filter>`.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + co-located `__tests__/*.test.mjs`, `gh` CLI (DI-wrapped), `git` worktrees (DI-wrapped), markdown.

**Reference spec:** `docs/superpowers/specs/2026-05-30-upstream-fix-skill-design.md` — defer to it for rationale and locked decisions. This plan is the build order.

---

## Repo orientation (read before Task 1)

- **Working dir:** `/Users/coreyellis/code/github.com/cmetech/otto_app/otto-cli`
- **Sibling skill to mirror:** `.claude/skills/upstream-cherry-pick/` — same anatomy: `scripts/*.mjs` (DI-friendly named exports + a CLI entry guarded by `import.meta.url`), co-located `scripts/__tests__/*.test.mjs`, a `SKILL.md` with a trigger-phrase `description`, and a `README.md`.
- **Script convention (copy it):** every script exports a pure-ish function taking an options object with **injectable runners** (`ghRunner`, `gitRunner`) defaulting to `execFileSync`. The CLI block parses argv, calls the export, writes JSON to stdout, diagnostics to stderr, and `process.exit(1)` with `{ error }` on failure. See `scripts/dedup-check.mjs` and `scripts/state-read.mjs` for the exact shape.
- **Run a single script:** `node .claude/skills/upstream-fix/scripts/<name>.mjs <args>`
- **Run one test file:** `node --test .claude/skills/upstream-fix/scripts/__tests__/<name>.test.mjs`
- **Run all skill tests:** `node --test .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs`
- **`.worktrees/` is already gitignored** (`.gitignore:80`) — lane worktrees live there safely.
- **Workspace package names:** `@otto/pi-ai`, `@otto/pi-agent-core`, `@otto/pi-coding-agent`, `@otto/pi-tui`, `@otto/native`, `@otto-build/contracts`, `@otto-build/rpc-client`, `@otto-build/mcp-server`, `@otto-build/daemon`.

### CRITICAL: gate commands (spec §5.4 correction)

The spec's "`npm test -w @otto/<pkg>`" **does not work** — workspace packages have no `test` script. Use the repo's real commands instead. `run-gates.mjs` resolves gate commands from a fix's target files:

| Gate | Command | Notes |
| --- | --- | --- |
| Regression test (the new `*.test.ts`) | `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test <testfile>` | Fast path; runs ONE file, no compile step. This is how the subagent confirms fail→pass. |
| Build | `npm run build` | Heavy but authoritative. A scoped `npm run build:<pkg>` MAY be used when all target files are in one package (mapping in Task 7). |
| Targeted suite | `npm run test:packages` when any target file is under `packages/`; else `npm run test:unit` | No native `-w` targeting exists; these are the narrowest real commands. |
| Full suite (integration branch only) | `npm test` then `npm run verify:pr` | Run by the controller after integration, not per-lane. |

All four are slow-ish but run **inside subagent worktrees**, never in the controller. `run-gates.mjs` writes full logs to a file and returns only `{ pass, failTail }` (≤30 lines).

---

## File structure (what each file owns)

Under `.claude/skills/upstream-fix/`:

| File | Responsibility |
| --- | --- |
| `SKILL.md` | Agentic orchestration: dispatch fix/reviewer subagents, accept/reject, integration sequence, the subagent prompt templates. |
| `README.md` | Operator-facing quick start. |
| `scripts/ledger.mjs` | Run-state ledger primitives (read/write/init/mutators). Source of truth on disk. Shared by most scripts. |
| `scripts/select-issues.mjs` | `gh issue list` by filter → compact selected-issues JSON (parses `targetFiles` from guidance). |
| `scripts/plan-lanes.mjs` | Union-find on `targetFiles` → file-disjoint `lanes.json`. Pure. |
| `scripts/scheduler.mjs` | `--next`: return ≤3 runnable lane descriptors from `lanes.json` + ledger. |
| `scripts/worktree-setup.mjs` | `git worktree add` a lane worktree off main. |
| `scripts/worktree-merge.mjs` | Merge an accepted lane branch into the integration branch + post-hoc overlap check. |
| `scripts/run-gates.mjs` | Resolve + run build/targeted/full gates; return `{pass, failTail}`; log to file. |
| `scripts/record-result.mjs` | Fold one subagent result line into the ledger (CLI thin-ack). |
| `scripts/issue-update.mjs` | Labels / comment / close via `gh`. |
| `scripts/write-report.mjs` | Ledger → `YYYY-MM-DD-fix-report.md`. |
| `scripts/__tests__/*.test.mjs` | Co-located tests, one per script. |
| `scripts/__fixtures__/` | Sample guidance file + sample ledger for tests. |

Plus `.claude/commands/upstream-fix.md` (thin slash-command wrapper).

**Run artifacts** (all under `.planning/upstream-fixes/`):
- `<date>-selected-issues.json`, `<date>-lanes.json`
- `<date>-run-state.json` (the ledger — source of truth)
- `<date>-gate-logs/lane-<n>-<gate>.log`
- `<date>-fix-report.md`

### Ledger schema (every script agrees on this)

```json
{
  "version": 1,
  "date": "2026-05-30",
  "filter": "--severity critical-stability",
  "integrationBranch": "integration/upstream-fix-2026-05-30",
  "prUrl": null,
  "finalSuite": null,
  "lanes": {
    "1": {
      "issues": ["63"],
      "files": ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"],
      "branch": "fix/upstream-lane-1",
      "worktree": ".worktrees/upstream-fix-lane-1",
      "status": "pending"
    }
  },
  "issues": {
    "63": {
      "lane": 1,
      "sha": "ce0e801",
      "guidancePath": ".planning/upstream-audits/guidance/ce0e801.md",
      "targetFiles": ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"],
      "status": "pending",
      "commitSha": null,
      "touchedFiles": [],
      "gates": { "regression": null, "build": null, "targeted": null },
      "reviewer": null,
      "reviewerReason": null,
      "reason": null
    }
  }
}
```

- **lane.status:** `pending` → `in-progress` → `done` (subagent finished) → `merged` | `failed`.
- **issue.status:** `pending` → `in-progress` → `resolved` | `unresolved`; then `applied` (merged + reviewer-approved + final suite green) or `rejected` (reviewer rejected).

---

## Task 1: Scaffolding — skill dir, SKILL.md stub, README, fixtures

**Files:**
- Create: `.claude/skills/upstream-fix/SKILL.md` (stub; body written in Task 12)
- Create: `.claude/skills/upstream-fix/README.md`
- Create: `.claude/skills/upstream-fix/scripts/.gitkeep`
- Create: `.claude/skills/upstream-fix/scripts/__tests__/.gitkeep`
- Create: `.claude/skills/upstream-fix/scripts/__fixtures__/guidance.ce0e801.md`
- Create: `.claude/skills/upstream-fix/scripts/__fixtures__/ledger.sample.json`

- [ ] **Step 1.1: Create directories and gitkeeps**

```bash
mkdir -p .claude/skills/upstream-fix/scripts/__tests__
mkdir -p .claude/skills/upstream-fix/scripts/__fixtures__
touch .claude/skills/upstream-fix/scripts/.gitkeep
touch .claude/skills/upstream-fix/scripts/__tests__/.gitkeep
```

- [ ] **Step 1.2: Write SKILL.md stub**

`.claude/skills/upstream-fix/SKILL.md`:

```markdown
---
name: upstream-fix
description: >
  Implement filed upstream-cherry-pick issues on cmetech/otto-cli. Selects
  issues by grouping (severity, type, label, numbers, or all), fixes each on
  a file-disjoint git-worktree lane via parallel subagents (cap 3), gates
  every fix on a regression test, build, targeted+full suite, and an
  independent reviewer subagent, integrates accepted fixes into one PR, and
  closes the issues. Use when asked to "implement the critical upstream
  fixes", "port the cherry-pick candidates", or "fix the filed upstream
  issues". Highest-stakes skill — it changes otto-cli source.
---

# Upstream-Fix

(Body written in Task 12; this is the registry stub.)
```

- [ ] **Step 1.3: Write README.md**

`.claude/skills/upstream-fix/README.md`:

````markdown
# upstream-fix

Implement filed `upstream-cherry-pick` issues. Companion to that skill: it
*files* issues; this one *fixes* them.

## Quick start

```sh
# Preview: select + plan lanes, do no work
/upstream-fix --severity critical-stability --dry-run

# Real run
/upstream-fix --severity critical-stability

# Resume after interruption/compaction (idempotent)
/upstream-fix --resume
```

Full design: `docs/superpowers/specs/2026-05-30-upstream-fix-skill-design.md`.
````

- [ ] **Step 1.4: Write fixture guidance file** `.claude/skills/upstream-fix/scripts/__fixtures__/guidance.ce0e801.md`:

```markdown
verdict: manual-port

## Target file(s)

- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`

## Divergence

otto-cli renamed the package; logic diverged. Manual port required.

## Concrete edits

Add backpressure retry around the rpc write loop.
```

- [ ] **Step 1.5: Write fixture ledger** `.claude/skills/upstream-fix/scripts/__fixtures__/ledger.sample.json`:

```json
{
  "version": 1,
  "date": "2026-05-30",
  "filter": "--issues 63",
  "integrationBranch": "integration/upstream-fix-2026-05-30",
  "prUrl": null,
  "finalSuite": null,
  "lanes": {
    "1": { "issues": ["63"], "files": ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"], "branch": "fix/upstream-lane-1", "worktree": ".worktrees/upstream-fix-lane-1", "status": "pending" }
  },
  "issues": {
    "63": { "lane": 1, "sha": "ce0e801", "guidancePath": ".planning/upstream-audits/guidance/ce0e801.md", "targetFiles": ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"], "status": "pending", "commitSha": null, "touchedFiles": [], "gates": { "regression": null, "build": null, "targeted": null }, "reviewer": null, "reviewerReason": null, "reason": null }
  }
}
```

- [ ] **Step 1.6: Commit**

```bash
git add .claude/skills/upstream-fix/
git commit -m "feat(skill): scaffold upstream-fix skeleton"
```

---

## Task 2: `ledger.mjs` — run-state ledger primitives

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/ledger.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs`

- [ ] **Step 2.1: Write the failing test** `scripts/__tests__/ledger.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, readLedger, writeLedger, recordIssueResult, setLaneStatus } from "../ledger.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-ledger-")); }

test("readLedger returns null for missing file", () => {
  const dir = tmp();
  try { assert.equal(readLedger(join(dir, "x.json")), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("initLedger builds lanes+issues maps from inputs and round-trips", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    const lanes = [{ id: 1, issues: ["63"], files: ["a.ts"] }];
    const issues = [{ number: "63", sha: "ce0e801", guidancePath: "g.md", targetFiles: ["a.ts"] }];
    initLedger(path, { date: "2026-05-30", filter: "--issues 63", integrationBranch: "integration/upstream-fix-2026-05-30", lanes, issues });
    const led = readLedger(path);
    assert.equal(led.version, 1);
    assert.equal(led.lanes["1"].status, "pending");
    assert.equal(led.lanes["1"].branch, "fix/upstream-lane-1");
    assert.equal(led.lanes["1"].worktree, ".worktrees/upstream-fix-lane-1");
    assert.equal(led.issues["63"].lane, 1);
    assert.equal(led.issues["63"].status, "pending");
    assert.equal(led.issues["63"].sha, "ce0e801");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordIssueResult sets resolved fields", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    initLedger(path, { date: "2026-05-30", filter: "x", integrationBranch: "b", lanes: [{ id: 1, issues: ["63"], files: ["a.ts"] }], issues: [{ number: "63", sha: "ce0e801", guidancePath: "g.md", targetFiles: ["a.ts"] }] });
    recordIssueResult(path, { number: "63", status: "resolved", commitSha: "deadbee", touchedFiles: ["a.ts"], reason: "ported" });
    const led = readLedger(path);
    assert.equal(led.issues["63"].status, "resolved");
    assert.equal(led.issues["63"].commitSha, "deadbee");
    assert.deepEqual(led.issues["63"].touchedFiles, ["a.ts"]);
    assert.equal(led.issues["63"].reason, "ported");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordIssueResult on unknown issue throws", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    initLedger(path, { date: "d", filter: "x", integrationBranch: "b", lanes: [], issues: [] });
    assert.throws(() => recordIssueResult(path, { number: "999", status: "resolved" }), /unknown issue/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("setLaneStatus updates lane and preserves issues", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json");
    initLedger(path, { date: "d", filter: "x", integrationBranch: "b", lanes: [{ id: 2, issues: ["7"], files: ["b.ts"] }], issues: [{ number: "7", sha: "abc1234", guidancePath: "g", targetFiles: ["b.ts"] }] });
    setLaneStatus(path, 2, "in-progress");
    assert.equal(readLedger(path).lanes["2"].status, "in-progress");
    assert.equal(readLedger(path).issues["7"].status, "pending");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2.2: Run, expect FAIL** — `node --test .claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs` → cannot find module `../ledger.mjs`.

- [ ] **Step 2.3: Implement** `scripts/ledger.mjs`:

```javascript
#!/usr/bin/env node
/**
 * ledger.mjs — run-state ledger primitives (source of truth on disk).
 * As module: import { initLedger, readLedger, writeLedger, recordIssueResult,
 *   setLaneStatus, setIssueStatus } from "./ledger.mjs"
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

export function initLedger(path, { date, filter, integrationBranch, lanes, issues }) {
  const ledger = { version: 1, date, filter, integrationBranch, prUrl: null, finalSuite: null, lanes: {}, issues: {} };
  for (const lane of lanes) {
    ledger.lanes[String(lane.id)] = {
      issues: lane.issues.map(String),
      files: lane.files,
      branch: `fix/upstream-lane-${lane.id}`,
      worktree: `.worktrees/upstream-fix-lane-${lane.id}`,
      status: "pending",
    };
  }
  const laneOf = (num) => {
    for (const lane of lanes) if (lane.issues.map(String).includes(String(num))) return lane.id;
    return null;
  };
  for (const iss of issues) {
    ledger.issues[String(iss.number)] = {
      lane: laneOf(iss.number),
      sha: iss.sha ?? null,
      guidancePath: iss.guidancePath ?? null,
      targetFiles: iss.targetFiles ?? [],
      status: "pending",
      commitSha: null,
      touchedFiles: [],
      gates: { regression: null, build: null, targeted: null },
      reviewer: null,
      reviewerReason: null,
      reason: null,
    };
  }
  writeLedger(path, ledger);
  return ledger;
}

export function recordIssueResult(path, { number, status, commitSha = null, touchedFiles = null, reason = null, gates = null }) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const iss = ledger.issues[String(number)];
  if (!iss) throw new Error(`unknown issue #${number} in ledger`);
  iss.status = status;
  if (commitSha !== null) iss.commitSha = commitSha;
  if (touchedFiles !== null) iss.touchedFiles = touchedFiles;
  if (reason !== null) iss.reason = reason;
  if (gates !== null) iss.gates = { ...iss.gates, ...gates };
  writeLedger(path, ledger);
  return iss;
}

export function setIssueStatus(path, number, status, extra = {}) {
  return recordIssueResult(path, { number, status, ...extra });
}

export function setLaneStatus(path, laneId, status) {
  const ledger = readLedger(path);
  if (!ledger) throw new Error(`ledger not found at ${path}`);
  const lane = ledger.lanes[String(laneId)];
  if (!lane) throw new Error(`unknown lane ${laneId} in ledger`);
  lane.status = status;
  writeLedger(path, ledger);
  return lane;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) { process.stderr.write(JSON.stringify({ error: "Usage: node ledger.mjs <ledger-path>" }) + "\n"); process.exit(1); }
  const led = readLedger(path);
  process.stdout.write(JSON.stringify(led, null, 2) + "\n");
}
```

- [ ] **Step 2.4: Run, expect PASS** — `node --test .claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs`.

- [ ] **Step 2.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/ledger.mjs .claude/skills/upstream-fix/scripts/__tests__/ledger.test.mjs
git commit -m "feat(skill): add upstream-fix run-state ledger primitives"
```

---

## Task 3: `select-issues.mjs` — query gh by filter, parse target files

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/select-issues.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/select-issues.test.mjs`

Behavior: given a filter, query `gh issue list --repo cmetech/otto-cli --state open --json number,labels,body,title`, map each issue to a record, parse `targetFiles` + `sha` + `guidancePath` from the issue's guidance file on disk (the body carries a `Guidance | <path>` line; fall back to `.planning/upstream-audits/guidance/<sha7>.md`). Exclude `type:do-not-port` and `status:applied`. Issues with no resolvable target files are flagged `needsTriage:true` and excluded from lanes (reported, not fixed). Writes `<date>-selected-issues.json`; prints `{ count, needsTriage, path }`.

- [ ] **Step 3.1: Write the failing test** `scripts/__tests__/select-issues.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectIssues, parseGuidanceTargets, buildSearchArgs } from "../select-issues.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-select-")); }

test("buildSearchArgs maps --severity to a label filter", () => {
  const args = buildSearchArgs({ severity: "critical-stability" });
  assert.ok(args.includes("--label"));
  assert.ok(args.includes("severity:critical-stability"));
});

test("buildSearchArgs maps --issues to no label filter (numbers handled post-fetch)", () => {
  const args = buildSearchArgs({ issues: ["62", "63"] });
  assert.ok(!args.includes("severity:"));
});

test("parseGuidanceTargets reads Target file(s) bullet list", () => {
  const dir = tmp();
  try {
    const g = join(dir, "ce0e801.md");
    writeFileSync(g, "verdict: manual-port\n\n## Target file(s)\n\n- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`\n- `packages/pi-ai/src/x.ts`\n\n## Divergence\n\nfoo\n");
    const targets = parseGuidanceTargets(g);
    assert.deepEqual(targets, ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts", "packages/pi-ai/src/x.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parseGuidanceTargets returns [] for 'no equivalent exists'", () => {
  const dir = tmp();
  try {
    const g = join(dir, "x.md");
    writeFileSync(g, "verdict: do-not-port\n\n## Target file(s)\n\nno equivalent exists\n");
    assert.deepEqual(parseGuidanceTargets(g), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues excludes do-not-port and applied, flags missing-guidance as needsTriage", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`\n");
    const fakeIssues = [
      { number: 63, title: "x", labels: [{ name: "severity:critical-stability" }, { name: "type:port-required" }], body: "[sha=ce0e801]\nGuidance | .planning/upstream-audits/guidance/ce0e801.md" },
      { number: 2, title: "y", labels: [{ name: "type:do-not-port" }], body: "[sha=d0d1d8e]" },
      { number: 9, title: "z", labels: [{ name: "status:applied" }], body: "[sha=abc1234]" },
      { number: 11, title: "w", labels: [{ name: "type:port-required" }], body: "[sha=4b4641c]" },
    ];
    const ghRunner = () => JSON.stringify(fakeIssues);
    const out = join(dir, "selected.json");
    const result = selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir, outPath: out });
    assert.equal(result.count, 1);
    assert.equal(result.needsTriage, 1); // #11 has no guidance file
    const written = JSON.parse(readFileSync(out, "utf-8"));
    const sel = written.filter((r) => !r.needsTriage);
    assert.equal(sel.length, 1);
    assert.equal(sel[0].number, 63);
    assert.deepEqual(sel[0].targetFiles, ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"]);
    assert.equal(sel[0].sha, "ce0e801");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues --issues filters to the requested numbers post-fetch", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `a.ts`\n");
    writeFileSync(join(gdir, "abc1234.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `b.ts`\n");
    const fakeIssues = [
      { number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]" },
      { number: 7, title: "y", labels: [{ name: "type:port-required" }], body: "[sha=abc1234]" },
    ];
    const ghRunner = () => JSON.stringify(fakeIssues);
    const out = join(dir, "selected.json");
    const result = selectIssues({ filter: { issues: ["63"] }, ghRunner, guidanceDir: gdir, outPath: out });
    assert.equal(result.count, 1);
    const written = JSON.parse(readFileSync(out, "utf-8")).filter((r) => !r.needsTriage);
    assert.equal(written[0].number, 63);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 3.2: Run, expect FAIL.**

- [ ] **Step 3.3: Implement** `scripts/select-issues.mjs`:

```javascript
#!/usr/bin/env node
/**
 * select-issues.mjs — query cmetech/otto-cli issues by filter, resolve each to
 * a compact fix record (number, severity, type, sha, guidancePath, targetFiles).
 * Writes <date>-selected-issues.json; prints { count, needsTriage, path }.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULT_REPO = "cmetech/otto-cli";
const DEFAULT_GUIDANCE_DIR = ".planning/upstream-audits/guidance";
const EXCLUDE_TYPE = "type:do-not-port";
const EXCLUDE_STATUS = "status:applied";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }

export function buildSearchArgs(filter, repo = DEFAULT_REPO) {
  const args = ["issue", "list", "--repo", repo, "--state", "open", "--limit", "500", "--json", "number,title,labels,body"];
  if (filter.severity) args.push("--label", `severity:${filter.severity}`);
  if (filter.type) args.push("--label", `type:${filter.type}`);
  if (filter.label) args.push("--label", filter.label);
  // --issues and --all need no label filter; numbers are filtered post-fetch.
  return args;
}

export function parseGuidanceTargets(guidancePath) {
  if (!existsSync(guidancePath)) return null;
  const text = readFileSync(guidancePath, "utf-8");
  const m = text.match(/##\s*Target file\(s\)\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i);
  if (!m) return [];
  const block = m[1];
  if (/no equivalent exists/i.test(block)) return [];
  const files = [];
  for (const line of block.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s*`?([^`\n]+?)`?\s*$/);
    if (bullet) files.push(bullet[1].trim());
  }
  return files;
}

function shaFromBody(body) {
  const m = (body ?? "").match(/sha=([0-9a-f]{7,40})/i);
  return m ? m[1].slice(0, 7) : null;
}

function severityFromLabels(labels) {
  const l = labels.find((x) => x.name.startsWith("severity:"));
  return l ? l.name.slice("severity:".length) : null;
}

function typeFromLabels(labels) {
  const l = labels.find((x) => x.name.startsWith("type:"));
  return l ? l.name.slice("type:".length) : null;
}

export function selectIssues({ filter, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, guidanceDir = DEFAULT_GUIDANCE_DIR, outPath }) {
  const raw = ghRunner(buildSearchArgs(filter, repo));
  let issues = JSON.parse(raw);
  if (!Array.isArray(issues)) issues = [];

  if (filter.issues) {
    const want = new Set(filter.issues.map(String));
    issues = issues.filter((i) => want.has(String(i.number)));
  }

  const records = [];
  for (const i of issues) {
    const labels = (i.labels ?? []).map((l) => (typeof l === "string" ? { name: l } : l));
    const names = labels.map((l) => l.name);
    if (names.includes(EXCLUDE_TYPE) || names.includes(EXCLUDE_STATUS)) continue;

    const sha = shaFromBody(i.body);
    // Prefer an explicit "Guidance | <path>" line; else derive from sha.
    const gmatch = (i.body ?? "").match(/Guidance\s*\|\s*(\S+)/);
    const guidancePath = gmatch ? gmatch[1] : sha ? join(guidanceDir, `${sha}.md`) : null;
    const targetFiles = guidancePath ? parseGuidanceTargets(guidancePath) : null;

    const rec = {
      number: i.number,
      severity: severityFromLabels(labels),
      type: typeFromLabels(labels),
      sha,
      guidancePath,
      targetFiles: targetFiles ?? [],
    };
    // No resolvable target files → cannot place in a lane.
    if (!targetFiles || targetFiles.length === 0) rec.needsTriage = true;
    records.push(rec);
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(records, null, 2) + "\n");
  }
  return { count: records.filter((r) => !r.needsTriage).length, needsTriage: records.filter((r) => r.needsTriage).length, path: outPath, records };
}

function parseArgv(argv) {
  const filter = {}; let outPath = null; let guidanceDir = DEFAULT_GUIDANCE_DIR;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") filter.all = true;
    else if (a === "--severity") filter.severity = argv[++i];
    else if (a === "--type") filter.type = argv[++i];
    else if (a === "--label") filter.label = argv[++i];
    else if (a === "--issues") filter.issues = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--guidance-dir") guidanceDir = argv[++i];
  }
  return { filter, outPath, guidanceDir };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { filter, outPath, guidanceDir } = parseArgv(process.argv.slice(2));
    const r = selectIssues({ filter, guidanceDir, outPath });
    process.stdout.write(JSON.stringify({ count: r.count, needsTriage: r.needsTriage, path: r.path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 3.4: Run, expect PASS.**

- [ ] **Step 3.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/select-issues.mjs .claude/skills/upstream-fix/scripts/__tests__/select-issues.test.mjs
git commit -m "feat(skill): add upstream-fix issue selection"
```

---

## Task 4: `plan-lanes.mjs` — union-find on target files

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/plan-lanes.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/plan-lanes.test.mjs`

Behavior: pure function. Input = selected records (the non-`needsTriage` ones). Build `file → issues` map, union-find so two issues share a lane iff they share a target file (transitively). Each connected component is one lane. Within a lane, order issues critical-severity first. Emit `{ lanes: [{ id, issues:[...], files:[...] }] }`.

- [ ] **Step 4.1: Write the failing test** `scripts/__tests__/plan-lanes.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { planLanes } from "../plan-lanes.mjs";

const SEV = { "critical-stability": 0, "critical-security": 1, feature: 2, "nice-to-have-fix": 3 };

test("disjoint files → separate lanes", () => {
  const recs = [
    { number: 63, severity: "critical-stability", targetFiles: ["a.ts"] },
    { number: 7, severity: "feature", targetFiles: ["b.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].issues.length, 1);
});

test("shared file → one lane", () => {
  const recs = [
    { number: 1, severity: "feature", targetFiles: ["a.ts", "shared.ts"] },
    { number: 2, severity: "nice-to-have-fix", targetFiles: ["shared.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0].issues, ["1", "2"]);
  assert.deepEqual(lanes[0].files.sort(), ["a.ts", "shared.ts"]);
});

test("transitive sharing merges into one lane", () => {
  const recs = [
    { number: 1, severity: "feature", targetFiles: ["a.ts"] },
    { number: 2, severity: "feature", targetFiles: ["a.ts", "b.ts"] },
    { number: 3, severity: "feature", targetFiles: ["b.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].issues.length, 3);
});

test("within a lane, critical severity is ordered first", () => {
  const recs = [
    { number: 5, severity: "nice-to-have-fix", targetFiles: ["x.ts"] },
    { number: 6, severity: "critical-stability", targetFiles: ["x.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.deepEqual(lanes[0].issues, ["6", "5"]);
});

test("lane ids are 1-based and stable", () => {
  const recs = [
    { number: 10, severity: "feature", targetFiles: ["a.ts"] },
    { number: 20, severity: "feature", targetFiles: ["b.ts"] },
  ];
  const { lanes } = planLanes(recs);
  assert.deepEqual(lanes.map((l) => l.id), [1, 2]);
});
```

- [ ] **Step 4.2: Run, expect FAIL.**

- [ ] **Step 4.3: Implement** `scripts/plan-lanes.mjs`:

```javascript
#!/usr/bin/env node
/**
 * plan-lanes.mjs — union-find on target files → file-disjoint lanes.
 * Pure: input selected records, output { lanes: [{ id, issues, files }] }.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SEV_ORDER = { "critical-stability": 0, "critical-security": 1, feature: 2, "nice-to-have-fix": 3 };

export function planLanes(records) {
  const recs = records.filter((r) => !r.needsTriage && (r.targetFiles ?? []).length > 0);

  // Union-find keyed by issue number string.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const r of recs) parent.set(String(r.number), String(r.number));

  // First issue seen per file; union subsequent issues touching that file.
  const fileOwner = new Map();
  for (const r of recs) {
    const num = String(r.number);
    for (const f of r.targetFiles) {
      if (fileOwner.has(f)) union(num, fileOwner.get(f));
      else fileOwner.set(f, num);
    }
  }

  // Group by root.
  const byRoot = new Map();
  for (const r of recs) {
    const root = find(String(r.number));
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(r);
  }

  // Stable lane ordering: by the smallest issue number in each component.
  const components = [...byRoot.values()].sort(
    (a, b) => Math.min(...a.map((r) => Number(r.number))) - Math.min(...b.map((r) => Number(r.number))),
  );

  const lanes = components.map((comp, idx) => {
    const issues = [...comp]
      .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || Number(a.number) - Number(b.number))
      .map((r) => String(r.number));
    const files = [...new Set(comp.flatMap((r) => r.targetFiles))];
    return { id: idx + 1, issues, files };
  });

  return { lanes };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const inPath = process.argv[2];
    const outPath = process.argv[3];
    if (!inPath) throw new Error("Usage: node plan-lanes.mjs <selected-issues.json> [lanes.json]");
    const records = JSON.parse(readFileSync(inPath, "utf-8"));
    const result = planLanes(records);
    if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n"); }
    process.stdout.write(JSON.stringify({ lanes: result.lanes.length, path: outPath ?? null }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4.4: Run, expect PASS.**

- [ ] **Step 4.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/plan-lanes.mjs .claude/skills/upstream-fix/scripts/__tests__/plan-lanes.test.mjs
git commit -m "feat(skill): add upstream-fix lane planner (union-find)"
```

---

## Task 5: `scheduler.mjs` — `--next` returns ≤3 runnable lanes

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/scheduler.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/scheduler.test.mjs`

Behavior: reads the ledger. A lane is *runnable* if `status === "pending"`. *In flight* = `status === "in-progress"`. Return up to `cap - inFlight` runnable lanes (cap default 3), as compact descriptors `{ id, branch, worktree, issues: [{ number, sha, guidancePath, targetFiles }] }`. This is the O(1) controller loop primitive.

- [ ] **Step 5.1: Write the failing test** `scripts/__tests__/scheduler.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, setLaneStatus } from "../ledger.mjs";
import { nextLanes } from "../scheduler.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-sched-")); }

function seed(path) {
  initLedger(path, {
    date: "d", filter: "x", integrationBranch: "b",
    lanes: [
      { id: 1, issues: ["63"], files: ["a.ts"] },
      { id: 2, issues: ["7"], files: ["b.ts"] },
      { id: 3, issues: ["8"], files: ["c.ts"] },
      { id: 4, issues: ["9"], files: ["d.ts"] },
    ],
    issues: [
      { number: "63", sha: "ce0e801", guidancePath: "g1", targetFiles: ["a.ts"] },
      { number: "7", sha: "abc1234", guidancePath: "g2", targetFiles: ["b.ts"] },
      { number: "8", sha: "bbb2222", guidancePath: "g3", targetFiles: ["c.ts"] },
      { number: "9", sha: "ccc3333", guidancePath: "g4", targetFiles: ["d.ts"] },
    ],
  });
}

test("returns at most cap=3 pending lanes when none in flight", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    const lanes = nextLanes(path, { cap: 3 });
    assert.equal(lanes.length, 3);
    assert.deepEqual(lanes.map((l) => l.id), [1, 2, 3]);
    assert.equal(lanes[0].branch, "fix/upstream-lane-1");
    assert.equal(lanes[0].issues[0].sha, "ce0e801");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("subtracts in-flight lanes from the cap", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    setLaneStatus(path, 1, "in-progress");
    setLaneStatus(path, 2, "in-progress");
    const lanes = nextLanes(path, { cap: 3 });
    assert.equal(lanes.length, 1); // 3 - 2 in flight
    assert.equal(lanes[0].id, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("returns [] when cap is saturated", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    setLaneStatus(path, 1, "in-progress");
    setLaneStatus(path, 2, "in-progress");
    setLaneStatus(path, 3, "in-progress");
    assert.deepEqual(nextLanes(path, { cap: 3 }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("skips done/merged/failed lanes", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    setLaneStatus(path, 1, "merged");
    setLaneStatus(path, 2, "failed");
    const lanes = nextLanes(path, { cap: 3 });
    assert.deepEqual(lanes.map((l) => l.id), [3, 4]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 5.2: Run, expect FAIL.**

- [ ] **Step 5.3: Implement** `scripts/scheduler.mjs`:

```javascript
#!/usr/bin/env node
/**
 * scheduler.mjs — return the next runnable lanes from the ledger.
 * CLI: node scheduler.mjs --next <ledger-path> [--cap 3]
 */
import { readLedger } from "./ledger.mjs";

export function nextLanes(ledgerPath, { cap = 3 } = {}) {
  const ledger = readLedger(ledgerPath);
  if (!ledger) throw new Error(`ledger not found at ${ledgerPath}`);
  const laneEntries = Object.entries(ledger.lanes).sort((a, b) => Number(a[0]) - Number(b[0]));
  const inFlight = laneEntries.filter(([, l]) => l.status === "in-progress").length;
  const budget = Math.max(0, cap - inFlight);
  const pending = laneEntries.filter(([, l]) => l.status === "pending").slice(0, budget);

  return pending.map(([id, lane]) => ({
    id: Number(id),
    branch: lane.branch,
    worktree: lane.worktree,
    issues: lane.issues.map((num) => {
      const iss = ledger.issues[num];
      return { number: num, sha: iss.sha, guidancePath: iss.guidancePath, targetFiles: iss.targetFiles };
    }),
  }));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const argv = process.argv.slice(2);
    if (!argv.includes("--next")) throw new Error("Usage: node scheduler.mjs --next <ledger-path> [--cap N]");
    const path = argv[argv.indexOf("--next") + 1];
    const capIdx = argv.indexOf("--cap");
    const cap = capIdx >= 0 ? Number(argv[capIdx + 1]) : 3;
    if (!path) throw new Error("missing ledger path after --next");
    process.stdout.write(JSON.stringify(nextLanes(path, { cap }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 5.4: Run, expect PASS.**

- [ ] **Step 5.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/scheduler.mjs .claude/skills/upstream-fix/scripts/__tests__/scheduler.test.mjs
git commit -m "feat(skill): add upstream-fix lane scheduler"
```

---

## Task 6: `worktree-setup.mjs` — create a lane worktree off main

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/worktree-setup.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/worktree-setup.test.mjs`

Behavior: `git worktree add .worktrees/upstream-fix-lane-<n> -b fix/upstream-lane-<n> <base>` (base default `main`). If the branch already exists (resume), check it out instead of creating. DI `gitRunner`. Returns `{ worktree, branch }`. Safety: refuses any base/branch containing shell metacharacters; never force.

- [ ] **Step 6.1: Write the failing test** `scripts/__tests__/worktree-setup.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWorktree } from "../worktree-setup.mjs";

function recordingRunner(branchExists = false) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      if (!branchExists) { const e = new Error("unknown rev"); e.status = 128; throw e; }
      return "abc1234\n";
    }
    return "";
  };
  runner.calls = calls;
  return runner;
}

test("creates a new branch worktree off main when branch absent", () => {
  const runner = recordingRunner(false);
  const r = setupWorktree({ laneId: 1, base: "main", gitRunner: runner });
  assert.equal(r.worktree, ".worktrees/upstream-fix-lane-1");
  assert.equal(r.branch, "fix/upstream-lane-1");
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-1", "-b", "fix/upstream-lane-1", "main"]);
});

test("reuses an existing branch on resume (no -b)", () => {
  const runner = recordingRunner(true);
  setupWorktree({ laneId: 2, base: "main", gitRunner: runner });
  const add = runner.calls.find((c) => c[0] === "worktree" && c[1] === "add");
  assert.deepEqual(add, ["worktree", "add", ".worktrees/upstream-fix-lane-2", "fix/upstream-lane-2"]);
});

test("rejects unsafe base names", () => {
  const runner = recordingRunner(false);
  assert.throws(() => setupWorktree({ laneId: 1, base: "main; rm -rf /", gitRunner: runner }), /unsafe/i);
});
```

- [ ] **Step 6.2: Run, expect FAIL.**

- [ ] **Step 6.3: Implement** `scripts/worktree-setup.mjs`:

```javascript
#!/usr/bin/env node
/**
 * worktree-setup.mjs — create (or resume) a lane worktree off a base branch.
 * CLI: node worktree-setup.mjs <laneId> [base]
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

function branchExists(branch, gitRunner) {
  try { gitRunner(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); return true; }
  catch { return false; }
}

export function setupWorktree({ laneId, base = "main", gitRunner = defaultGitRunner }) {
  const branch = `fix/upstream-lane-${laneId}`;
  const worktree = `.worktrees/upstream-fix-lane-${laneId}`;
  if (!SAFE.test(base) || !SAFE.test(branch)) throw new Error(`unsafe base/branch name: ${base} / ${branch}`);

  if (branchExists(branch, gitRunner)) {
    gitRunner(["worktree", "add", worktree, branch]);
  } else {
    gitRunner(["worktree", "add", worktree, "-b", branch, base]);
  }
  return { worktree, branch };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const laneId = process.argv[2];
    const base = process.argv[3] ?? "main";
    if (!laneId) throw new Error("Usage: node worktree-setup.mjs <laneId> [base]");
    process.stdout.write(JSON.stringify(setupWorktree({ laneId, base }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 6.4: Run, expect PASS.**

- [ ] **Step 6.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/worktree-setup.mjs .claude/skills/upstream-fix/scripts/__tests__/worktree-setup.test.mjs
git commit -m "feat(skill): add upstream-fix worktree setup"
```

---

## Task 7: `run-gates.mjs` — resolve + run build/targeted/full gates

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/run-gates.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/run-gates.test.mjs`

Behavior: the context-budget firewall around heavy test output. `resolveGateCommands(targetFiles)` maps files → real otto-cli commands (see "CRITICAL: gate commands" table). `runGate({ gate, cwd, logPath, targetFiles, testFile, runner })` runs the command, writes the FULL combined stdout/stderr to `logPath`, and returns `{ pass, failTail }` where `failTail` is the last ≤30 lines (empty on pass). The controller never sees full logs.

- [ ] **Step 7.1: Write the failing test** `scripts/__tests__/run-gates.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGateCommands, runGate, tailLines } from "../run-gates.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-gates-")); }

test("resolveGateCommands picks test:packages when a packages/ file is touched", () => {
  const cmds = resolveGateCommands(["packages/pi-coding-agent/src/x.ts"]);
  assert.deepEqual(cmds.build, ["npm", "run", "build"]);
  assert.deepEqual(cmds.targeted, ["npm", "run", "test:packages"]);
});

test("resolveGateCommands picks test:unit for src-only files", () => {
  const cmds = resolveGateCommands(["src/foo/bar.ts"]);
  assert.deepEqual(cmds.targeted, ["npm", "run", "test:unit"]);
});

test("tailLines returns the last N lines", () => {
  const text = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
  const tail = tailLines(text, 30);
  assert.equal(tail.split("\n").length, 30);
  assert.ok(tail.endsWith("line49"));
});

test("runGate returns pass:true and empty failTail on success, writes log", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const runner = () => ({ status: 0, stdout: "all good\n", stderr: "" });
    const r = runGate({ gate: "build", cwd: dir, logPath, targetFiles: ["src/a.ts"], runner });
    assert.equal(r.pass, true);
    assert.equal(r.failTail, "");
    assert.ok(existsSync(logPath));
    assert.match(readFileSync(logPath, "utf-8"), /all good/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runGate returns pass:false and failTail (<=30 lines) on failure", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const big = Array.from({ length: 100 }, (_, i) => `err${i}`).join("\n");
    const runner = () => ({ status: 1, stdout: big, stderr: "boom" });
    const r = runGate({ gate: "targeted", cwd: dir, logPath, targetFiles: ["packages/pi-ai/src/x.ts"], runner });
    assert.equal(r.pass, false);
    assert.ok(r.failTail.split("\n").length <= 30);
    assert.match(r.failTail, /boom|err99/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runGate regression gate runs the single test file via strip-types", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    let captured;
    const runner = (cmd, args) => { captured = [cmd, ...args]; return { status: 0, stdout: "", stderr: "" }; };
    runGate({ gate: "regression", cwd: dir, logPath, testFile: "packages/pi-ai/src/x.test.ts", targetFiles: [], runner });
    assert.ok(captured.includes("--experimental-strip-types"));
    assert.ok(captured.includes("packages/pi-ai/src/x.test.ts"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("full gate chains multiple commands and stops at the first failure", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const seen = [];
    const runner = (cmd, args) => { seen.push([cmd, ...args].join(" ")); return { status: seen.length === 2 ? 1 : 0, stdout: "", stderr: "fail-here" }; };
    const r = runGate({ gate: "full", cwd: dir, logPath, targetFiles: [], runner });
    assert.equal(r.pass, false);
    assert.equal(seen.length, 2); // stopped after the second (failing) step
    assert.match(r.failTail, /fail-here/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("full gate passes when all steps succeed", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const runner = () => ({ status: 0, stdout: "ok", stderr: "" });
    const r = runGate({ gate: "full", cwd: dir, logPath, targetFiles: [], runner });
    assert.equal(r.pass, true);
    assert.equal(r.failTail, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 7.2: Run, expect FAIL.**

- [ ] **Step 7.3: Implement** `scripts/run-gates.mjs`:

```javascript
#!/usr/bin/env node
/**
 * run-gates.mjs — run a confidence gate; write full log to disk; return
 * { pass, failTail } so the controller never ingests heavy test output.
 * CLI: node run-gates.mjs <gate> --cwd <dir> --log <path> [--files a,b] [--test-file f]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STRIP_TYPES_IMPORT = "./src/resources/extensions/workflow/tests/resolve-ts.mjs";

export function tailLines(text, n = 30) {
  const lines = (text ?? "").split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

export function resolveGateCommands(targetFiles = []) {
  const touchesPackages = targetFiles.some((f) => f.startsWith("packages/"));
  return {
    build: ["npm", "run", "build"],
    targeted: touchesPackages ? ["npm", "run", "test:packages"] : ["npm", "run", "test:unit"],
  };
}

function defaultRunner(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

// The `full` gate chains two heavy commands; all others are single commands.
const FULL_STEPS = [["npm", "test"], ["npm", "run", "verify:pr"]];

export function runGate({ gate, cwd, logPath, targetFiles = [], testFile = null, runner = defaultRunner }) {
  // Build the ordered list of [cmd, ...args] steps this gate runs.
  let steps;
  if (gate === "regression") {
    if (!testFile) throw new Error("regression gate requires testFile");
    steps = [["node", "--import", STRIP_TYPES_IMPORT, "--experimental-strip-types", "--test", testFile]];
  } else if (gate === "full") {
    steps = FULL_STEPS;
  } else {
    const cmds = resolveGateCommands(targetFiles);
    const resolved = cmds[gate];
    if (!resolved) throw new Error(`unknown gate: ${gate}`);
    steps = [resolved];
  }

  let log = "";
  let pass = true;
  let lastOut = "";
  for (const [cmd, ...args] of steps) {
    const res = runner(cmd, args, cwd);
    lastOut = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    log += `$ ${cmd} ${args.join(" ")}\n--- stdout ---\n${res.stdout ?? ""}\n--- stderr ---\n${res.stderr ?? ""}\n`;
    if (res.status !== 0) { pass = false; break; } // stop at first failing step
  }

  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, log);
  return { pass, failTail: pass ? "" : tailLines(lastOut, 30) };
}

function parseArgv(argv) {
  const gate = argv[0];
  let cwd = process.cwd(), logPath = null, targetFiles = [], testFile = null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd") cwd = argv[++i];
    else if (a === "--log") logPath = argv[++i];
    else if (a === "--files") targetFiles = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--test-file") testFile = argv[++i];
  }
  return { gate, cwd, logPath, targetFiles, testFile };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { gate, cwd, logPath, targetFiles, testFile } = parseArgv(process.argv.slice(2));
    if (!gate || !logPath) throw new Error("Usage: node run-gates.mjs <gate> --cwd <dir> --log <path> [--files a,b] [--test-file f]");
    const r = runGate({ gate, cwd, logPath, targetFiles, testFile });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.pass) process.exit(2); // distinct from usage error (1)
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

> Note: the CLI exits `2` on a clean gate failure (vs `1` for usage/error) so the controller can distinguish "gate ran and failed" from "couldn't run the gate."

- [ ] **Step 7.4: Run, expect PASS.**

- [ ] **Step 7.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/run-gates.mjs .claude/skills/upstream-fix/scripts/__tests__/run-gates.test.mjs
git commit -m "feat(skill): add upstream-fix gate runner"
```

---

## Task 8: `worktree-merge.mjs` — merge accepted lane + overlap safety net

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/worktree-merge.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/worktree-merge.test.mjs`

Behavior: two exported helpers. `detectOverlap(declaredFiles, actualFiles)` → array of files the subagent touched outside its declared `targetFiles` (the post-hoc safety net). `mergeLane({ laneBranch, integrationBranch, gitRunner })` runs `git merge --no-ff <laneBranch>` onto the integration branch and returns `{ merged: bool, conflict: bool }` — on conflict it aborts the merge (`git merge --abort`) and reports `conflict:true` rather than force-resolving.

- [ ] **Step 8.1: Write the failing test** `scripts/__tests__/worktree-merge.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectOverlap, mergeLane } from "../worktree-merge.mjs";

test("detectOverlap finds files touched outside declared set", () => {
  const stray = detectOverlap(["a.ts", "b.ts"], ["a.ts", "c.ts"]);
  assert.deepEqual(stray, ["c.ts"]);
});

test("detectOverlap allows a new co-located test file next to a declared source file", () => {
  const stray = detectOverlap(["packages/pi-ai/src/x.ts"], ["packages/pi-ai/src/x.ts", "packages/pi-ai/src/x.test.ts"]);
  assert.deepEqual(stray, []);
});

test("detectOverlap returns [] when actual ⊆ declared", () => {
  assert.deepEqual(detectOverlap(["a.ts", "b.ts"], ["a.ts"]), []);
});

test("mergeLane returns merged:true on clean merge", () => {
  const calls = [];
  const gitRunner = (args) => { calls.push(args); return ""; };
  const r = mergeLane({ laneBranch: "fix/upstream-lane-1", integrationBranch: "integration/upstream-fix-x", gitRunner });
  assert.equal(r.merged, true);
  assert.equal(r.conflict, false);
  assert.ok(calls.some((c) => c[0] === "merge" && c.includes("--no-ff") && c.includes("fix/upstream-lane-1")));
});

test("mergeLane aborts and reports conflict on merge failure", () => {
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "merge") { const e = new Error("CONFLICT"); e.status = 1; throw e; }
    return "";
  };
  const r = mergeLane({ laneBranch: "fix/upstream-lane-2", integrationBranch: "integration/upstream-fix-x", gitRunner });
  assert.equal(r.merged, false);
  assert.equal(r.conflict, true);
  assert.ok(calls.some((c) => c[0] === "merge" && c[1] === "--abort"));
});

test("mergeLane rejects unsafe branch names", () => {
  assert.throws(() => mergeLane({ laneBranch: "x; rm -rf /", integrationBranch: "y", gitRunner: () => "" }), /unsafe/i);
});
```

- [ ] **Step 8.2: Run, expect FAIL.**

- [ ] **Step 8.3: Implement** `scripts/worktree-merge.mjs`:

```javascript
#!/usr/bin/env node
/**
 * worktree-merge.mjs — merge an accepted lane branch into the integration
 * branch (no force, abort-on-conflict) + post-hoc overlap detection.
 * CLI: node worktree-merge.mjs <laneBranch> <integrationBranch>
 */
import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8" }); }

/** Files actually touched but not declared. A co-located *.test.* beside a
 *  declared source file is allowed (the regression test the fix subagent adds). */
export function detectOverlap(declaredFiles, actualFiles) {
  const declared = new Set(declaredFiles);
  const isAllowedTest = (f) => {
    const m = f.match(/^(.*)\.test\.[cm]?[jt]s$/);
    if (!m) return false;
    return [...declared].some((d) => d.startsWith(m[1]) || m[1].startsWith(d.replace(/\.[cm]?[jt]s$/, "")));
  };
  return actualFiles.filter((f) => !declared.has(f) && !isAllowedTest(f));
}

export function mergeLane({ laneBranch, integrationBranch, gitRunner = defaultGitRunner }) {
  if (!SAFE.test(laneBranch) || !SAFE.test(integrationBranch)) throw new Error(`unsafe branch name: ${laneBranch} / ${integrationBranch}`);
  // Caller has already checked out integrationBranch.
  try {
    gitRunner(["merge", "--no-ff", "--no-edit", laneBranch]);
    return { merged: true, conflict: false };
  } catch {
    try { gitRunner(["merge", "--abort"]); } catch { /* nothing to abort */ }
    return { merged: false, conflict: true };
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const [laneBranch, integrationBranch] = process.argv.slice(2);
    if (!laneBranch || !integrationBranch) throw new Error("Usage: node worktree-merge.mjs <laneBranch> <integrationBranch>");
    process.stdout.write(JSON.stringify(mergeLane({ laneBranch, integrationBranch }), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 8.4: Run, expect PASS.**

- [ ] **Step 8.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/worktree-merge.mjs .claude/skills/upstream-fix/scripts/__tests__/worktree-merge.test.mjs
git commit -m "feat(skill): add upstream-fix lane merge + overlap check"
```

---

## Task 9: `record-result.mjs` — fold one subagent result line into the ledger

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/record-result.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/record-result.test.mjs`

Behavior: the controller's O(1) fold step. Parses a thin subagent result line of the form `#<num> <resolved|unresolved> <sha-or-none> "<reason>"` and folds it into the ledger via `ledger.mjs`. Also exposes `recordLaneResult` to mark a lane `done`. Returns a one-line ack string.

- [ ] **Step 9.1: Write the failing test** `scripts/__tests__/record-result.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, readLedger } from "../ledger.mjs";
import { parseResultLine, foldResult } from "../record-result.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-rec-")); }
function seed(path) {
  initLedger(path, { date: "d", filter: "x", integrationBranch: "b",
    lanes: [{ id: 1, issues: ["63"], files: ["a.ts"] }],
    issues: [{ number: "63", sha: "ce0e801", guidancePath: "g", targetFiles: ["a.ts"] }] });
}

test("parseResultLine handles a resolved line with quoted reason", () => {
  const r = parseResultLine('#63 resolved deadbee "added rpc backpressure retry + test"');
  assert.equal(r.number, "63");
  assert.equal(r.status, "resolved");
  assert.equal(r.commitSha, "deadbee");
  assert.equal(r.reason, "added rpc backpressure retry + test");
});

test("parseResultLine handles unresolved with sha 'none'", () => {
  const r = parseResultLine('#71 unresolved none "otto-cli already handles this"');
  assert.equal(r.status, "unresolved");
  assert.equal(r.commitSha, null);
});

test("foldResult writes status into the ledger and acks", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    const ack = foldResult(path, '#63 resolved deadbee "ported"');
    assert.match(ack, /#63.*resolved/);
    const led = readLedger(path);
    assert.equal(led.issues["63"].status, "resolved");
    assert.equal(led.issues["63"].commitSha, "deadbee");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 9.2: Run, expect FAIL.**

- [ ] **Step 9.3: Implement** `scripts/record-result.mjs`:

```javascript
#!/usr/bin/env node
/**
 * record-result.mjs — fold a thin subagent result line into the ledger.
 * Line grammar: #<num> <resolved|unresolved> <sha|none> "<reason>"
 * CLI: node record-result.mjs <ledger-path> '<result-line>'
 */
import { recordIssueResult, setLaneStatus } from "./ledger.mjs";

export function parseResultLine(line) {
  const m = line.trim().match(/^#(\d+)\s+(resolved|unresolved)\s+(\S+)\s+"([\s\S]*)"\s*$/);
  if (!m) throw new Error(`unparseable result line: ${line}`);
  const [, number, status, shaRaw, reason] = m;
  const commitSha = shaRaw === "none" ? null : shaRaw;
  return { number, status, commitSha, reason };
}

export function foldResult(ledgerPath, line) {
  const { number, status, commitSha, reason } = parseResultLine(line);
  recordIssueResult(ledgerPath, { number, status, commitSha, reason });
  return `#${number} ${status}${commitSha ? ` ${commitSha}` : ""}`;
}

export function recordLaneResult(ledgerPath, laneId, status = "done") {
  setLaneStatus(ledgerPath, laneId, status);
  return `lane ${laneId} ${status}`;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledgerPath = process.argv[2];
    const line = process.argv[3];
    if (!ledgerPath || !line) throw new Error("Usage: node record-result.mjs <ledger-path> '<result-line>'");
    process.stdout.write(foldResult(ledgerPath, line) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 9.4: Run, expect PASS.**

- [ ] **Step 9.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/record-result.mjs .claude/skills/upstream-fix/scripts/__tests__/record-result.test.mjs
git commit -m "feat(skill): add upstream-fix result folding"
```

---

## Task 10: `issue-update.mjs` — labels / comment / close via gh

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/issue-update.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/issue-update.test.mjs`

Behavior: `updateIssue({ number, repo, addLabels, removeLabels, comment, close, ghRunner })`. Adds/removes labels, posts a comment, optionally closes. DI `ghRunner`. Returns `{ number, actions: [...] }`. Never deletes issues; only edits/comments/closes.

- [ ] **Step 10.1: Write the failing test** `scripts/__tests__/issue-update.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { updateIssue } from "../issue-update.mjs";

function recorder() {
  const calls = [];
  const r = (args) => { calls.push(args); return ""; };
  r.calls = calls;
  return r;
}

test("adds a label", () => {
  const gh = recorder();
  const out = updateIssue({ number: 63, repo: "cmetech/otto-cli", addLabels: ["status:in-progress"], ghRunner: gh });
  const edit = gh.calls.find((c) => c[0] === "issue" && c[1] === "edit");
  assert.ok(edit.includes("--add-label"));
  assert.ok(edit.includes("status:in-progress"));
  assert.ok(out.actions.includes("add-label"));
});

test("posts a comment and closes", () => {
  const gh = recorder();
  updateIssue({ number: 63, repo: "cmetech/otto-cli", comment: "applied in abc1234", close: true, ghRunner: gh });
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"));
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "close"));
});

test("swaps status label: remove triaged, add applied", () => {
  const gh = recorder();
  updateIssue({ number: 7, repo: "r", addLabels: ["status:applied"], removeLabels: ["status:triaged", "status:in-progress"], ghRunner: gh });
  const edit = gh.calls.find((c) => c[1] === "edit");
  assert.ok(edit.includes("--remove-label"));
  assert.ok(edit.filter((x) => x === "--remove-label").length === 2);
});

test("no-op when nothing requested", () => {
  const gh = recorder();
  const out = updateIssue({ number: 7, repo: "r", ghRunner: gh });
  assert.equal(gh.calls.length, 0);
  assert.deepEqual(out.actions, []);
});
```

- [ ] **Step 10.2: Run, expect FAIL.**

- [ ] **Step 10.3: Implement** `scripts/issue-update.mjs`:

```javascript
#!/usr/bin/env node
/**
 * issue-update.mjs — label / comment / close a cmetech/otto-cli issue via gh.
 * CLI: node issue-update.mjs <number> --repo R [--add-label L]... [--remove-label L]... [--comment TEXT] [--close]
 */
import { execFileSync } from "node:child_process";

const DEFAULT_REPO = "cmetech/otto-cli";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8" }); }

export function updateIssue({ number, repo = DEFAULT_REPO, addLabels = [], removeLabels = [], comment = null, close = false, ghRunner = defaultGhRunner }) {
  const actions = [];

  if (addLabels.length || removeLabels.length) {
    const args = ["issue", "edit", String(number), "--repo", repo];
    for (const l of addLabels) args.push("--add-label", l);
    for (const l of removeLabels) args.push("--remove-label", l);
    ghRunner(args);
    if (addLabels.length) actions.push("add-label");
    if (removeLabels.length) actions.push("remove-label");
  }

  if (comment) {
    ghRunner(["issue", "comment", String(number), "--repo", repo, "--body", comment]);
    actions.push("comment");
  }

  if (close) {
    ghRunner(["issue", "close", String(number), "--repo", repo]);
    actions.push("close");
  }

  return { number, actions };
}

function parseArgv(argv) {
  const number = argv[0];
  let repo = DEFAULT_REPO; const addLabels = []; const removeLabels = []; let comment = null; let close = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") repo = argv[++i];
    else if (a === "--add-label") addLabels.push(argv[++i]);
    else if (a === "--remove-label") removeLabels.push(argv[++i]);
    else if (a === "--comment") comment = argv[++i];
    else if (a === "--close") close = true;
  }
  return { number, repo, addLabels, removeLabels, comment, close };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const opts = parseArgv(process.argv.slice(2));
    if (!opts.number) throw new Error("Usage: node issue-update.mjs <number> --repo R [--add-label L] [--remove-label L] [--comment T] [--close]");
    process.stdout.write(JSON.stringify(updateIssue(opts), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 10.4: Run, expect PASS.**

- [ ] **Step 10.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/issue-update.mjs .claude/skills/upstream-fix/scripts/__tests__/issue-update.test.mjs
git commit -m "feat(skill): add upstream-fix issue updater"
```

---

## Task 11: `write-report.mjs` — ledger → markdown fix report

**Files:**
- Create: `.claude/skills/upstream-fix/scripts/write-report.mjs`
- Test: `.claude/skills/upstream-fix/scripts/__tests__/write-report.test.mjs`

Behavior: pure render from the on-disk ledger. Per issue: status, commit sha, gate results, reviewer verdict, and — for every unresolved/rejected issue — the explicit reason. Roll-up: N resolved / M unresolved / lanes / PR link / final-suite status. Writes `<date>-fix-report.md`; returns the markdown string.

- [ ] **Step 11.1: Write the failing test** `scripts/__tests__/write-report.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReport, writeReport } from "../write-report.mjs";

const ledger = {
  version: 1, date: "2026-05-30", filter: "--severity critical-stability",
  integrationBranch: "integration/upstream-fix-2026-05-30",
  prUrl: "https://github.com/cmetech/otto-cli/pull/99", finalSuite: "green",
  lanes: { "1": { issues: ["63"], status: "merged" }, "2": { issues: ["71"], status: "failed" } },
  issues: {
    "63": { lane: 1, sha: "ce0e801", status: "applied", commitSha: "deadbee", gates: { regression: true, build: true, targeted: true }, reviewer: "approve", reviewerReason: null, reason: "ported rpc backpressure" },
    "71": { lane: 2, sha: "4b4641c", status: "unresolved", commitSha: null, gates: { regression: null, build: null, targeted: null }, reviewer: null, reviewerReason: null, reason: "otto-cli already handles this via X" },
  },
};

test("renderReport includes rollup counts and PR link", () => {
  const md = renderReport(ledger);
  assert.match(md, /1 resolved/);
  assert.match(md, /1 unresolved/);
  assert.match(md, /pull\/99/);
  assert.match(md, /green/);
});

test("renderReport lists the explicit reason for every unresolved issue", () => {
  const md = renderReport(ledger);
  assert.match(md, /#71/);
  assert.match(md, /already handles this via X/);
});

test("renderReport shows applied issue with commit sha and reviewer verdict", () => {
  const md = renderReport(ledger);
  assert.match(md, /#63/);
  assert.match(md, /deadbee/);
  assert.match(md, /approve/);
});

test("writeReport writes a dated file and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "uf-report-"));
  try {
    const { path, markdown } = writeReport(ledger, dir);
    assert.ok(existsSync(path));
    assert.match(path, /2026-05-30-fix-report\.md$/);
    assert.equal(readFileSync(path, "utf-8"), markdown);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 11.2: Run, expect FAIL.**

- [ ] **Step 11.3: Implement** `scripts/write-report.mjs`:

```javascript
#!/usr/bin/env node
/**
 * write-report.mjs — render the run-state ledger into a markdown fix report.
 * CLI: node write-report.mjs <ledger-path> <out-dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readLedger } from "./ledger.mjs";

function gatesLine(g) {
  const mark = (v) => (v === true ? "✅" : v === false ? "❌" : "—");
  return `regression ${mark(g.regression)} · build ${mark(g.build)} · targeted ${mark(g.targeted)}`;
}

export function renderReport(ledger) {
  const issues = Object.entries(ledger.issues);
  const resolved = issues.filter(([, i]) => i.status === "applied" || i.status === "resolved");
  const unresolved = issues.filter(([, i]) => i.status === "unresolved" || i.status === "rejected");
  const laneCount = Object.keys(ledger.lanes).length;

  const lines = [];
  lines.push(`# Upstream-Fix Report — ${ledger.date}`);
  lines.push("");
  lines.push(`**Filter:** \`${ledger.filter}\``);
  lines.push("");
  lines.push("## Roll-up");
  lines.push("");
  lines.push(`- ${resolved.length} resolved / ${unresolved.length} unresolved`);
  lines.push(`- ${laneCount} lanes`);
  lines.push(`- Integration branch: \`${ledger.integrationBranch}\``);
  lines.push(`- PR: ${ledger.prUrl ?? "_not opened_"}`);
  lines.push(`- Final suite: ${ledger.finalSuite ?? "_not run_"}`);
  lines.push("");
  lines.push("## Resolved");
  lines.push("");
  if (resolved.length === 0) lines.push("_none_");
  for (const [num, i] of resolved) {
    lines.push(`- **#${num}** (sha ${i.sha}) → \`${i.commitSha ?? "?"}\` — reviewer: ${i.reviewer ?? "—"}`);
    lines.push(`  - gates: ${gatesLine(i.gates)}`);
    if (i.reason) lines.push(`  - ${i.reason}`);
  }
  lines.push("");
  lines.push("## Unresolved");
  lines.push("");
  if (unresolved.length === 0) lines.push("_none_");
  for (const [num, i] of unresolved) {
    const why = i.status === "rejected" ? i.reviewerReason : i.reason;
    lines.push(`- **#${num}** (sha ${i.sha}) — ${i.status}: ${why ?? "no reason recorded"}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(ledger, outDir) {
  mkdirSync(outDir, { recursive: true });
  const markdown = renderReport(ledger);
  const path = join(outDir, `${ledger.date}-fix-report.md`);
  writeFileSync(path, markdown);
  return { path, markdown };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const ledgerPath = process.argv[2];
    const outDir = process.argv[3];
    if (!ledgerPath || !outDir) throw new Error("Usage: node write-report.mjs <ledger-path> <out-dir>");
    const ledger = readLedger(ledgerPath);
    if (!ledger) throw new Error(`ledger not found at ${ledgerPath}`);
    const { path } = writeReport(ledger, outDir);
    process.stdout.write(JSON.stringify({ path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 11.4: Run, expect PASS.**

- [ ] **Step 11.5: Commit**

```bash
git add .claude/skills/upstream-fix/scripts/write-report.mjs .claude/skills/upstream-fix/scripts/__tests__/write-report.test.mjs
git commit -m "feat(skill): add upstream-fix report writer"
```

---

## Task 12: `SKILL.md` body — the agentic orchestration layer

**Files:**
- Modify: `.claude/skills/upstream-fix/SKILL.md` (replace the Task-1 stub body; keep frontmatter)

This is the heart of the skill: it is the controller. The `.mjs` scripts are deterministic plumbing; SKILL.md tells the agent how to drive them, dispatch subagents, and make accept/reject calls while keeping its own context flat. There is no automated test for prose — Step 12.2 is a manual read-through against the checklist.

- [ ] **Step 12.1: Replace the SKILL.md body** (everything after the frontmatter `---`):

````markdown
# Upstream-Fix

Implement filed `upstream-cherry-pick` issues on `cmetech/otto-cli`. This skill
*changes otto-cli source* — it is the highest-stakes skill in the set. Its design
priorities, in order: **correctness** (four mandatory gates), **structural
conflict avoidance** (file-disjoint lanes, never after-the-fact resolution), and
**flat controller context** (an on-disk ledger is the source of truth).

> **Self-modification note:** editing files under `.claude/skills/` triggers an
> auto-mode self-modification block. This skill only ever edits otto-cli *source*
> and `.planning/` artifacts — never its own skill files during a run.

## When to use

- "Implement the critical upstream fixes."
- "Port the cherry-pick candidates."
- "Fix the filed upstream issues for `severity:critical-stability`."
- `/upstream-fix <filter>`

## Locked invariants (never violate)

- Never force-push; never commit to `main` directly — always integration branch + PR.
- Never `--no-verify`; never stage `.env`/secrets.
- Excludes `type:do-not-port` by default.
- **Low confidence ⇒ do NOT touch code.** Comment on the issue, mark `unresolved`.
- Max **3** lanes in flight.

## Context budget (the rule that makes long runs possible)

The controller's context must grow with the *number of lanes*, not the *content
of issues*. Therefore:

- **Never** read an issue body, a guidance file, a diff, or a gate log into the
  controller. Scripts write those to disk and return compact summaries.
- The loop adds only: a few `scheduler --next` descriptors, one thin result line
  per issue, one reviewer verdict per resolved issue. That is O(1) per iteration.
- If you must inspect a failure, do it **in a subagent** or read the on-disk log
  with a **bounded line range** — never `cat` a whole log/diff.
- Progress lives in the ledger, so auto-compaction or a restart is safe; `--resume`
  reconstructs everything.

## Phase A — Plan (deterministic, up front)

1. **Resolve the filter** from the invocation (e.g. `--severity critical-stability`,
   `--issues 62,63`, `--all`). Set `DATE=$(date +%F)` and
   `DIR=.planning/upstream-fixes`.
2. **Select issues:**
   ```sh
   node .claude/skills/upstream-fix/scripts/select-issues.mjs <filter> \
     --out $DIR/$DATE-selected-issues.json
   ```
   Read only the printed `{ count, needsTriage, path }`. A non-zero `needsTriage`
   means some issues lack resolvable target files — they are reported, not fixed.
3. **Plan lanes:**
   ```sh
   node .claude/skills/upstream-fix/scripts/plan-lanes.mjs \
     $DIR/$DATE-selected-issues.json $DIR/$DATE-lanes.json
   ```
4. **Issue cap.** If `count` exceeds **25**, STOP and ask the user to confirm
   before launching that many lanes (guards a stray `--all`).
5. **`--dry-run`?** Print the plan (lane count, issues per lane, parallelism) from
   `lanes.json` and STOP. Do no work.
6. **Initialise the ledger** (the source of truth) from `selected-issues.json` +
   `lanes.json`, with `integrationBranch = integration/upstream-fix-$DATE`. (Use a
   one-off `node -e` that imports `initLedger`, or add the records via the CLI.)
   On `--resume`, skip init — the ledger already exists; issues already
   `status:applied` are skipped automatically by the scheduler (their lanes are
   `merged`).

## Phase B — Fix lanes (agentic, ≤3 in flight)

Loop until `scheduler --next` returns `[]`:

1. **Ask for the next runnable lanes:**
   ```sh
   node .claude/skills/upstream-fix/scripts/scheduler.mjs --next $DIR/$DATE-run-state.json --cap 3
   ```
   You get ≤3 compact lane descriptors. If `[]` and no lanes are `in-progress`,
   Phase B is done.
2. **For each returned lane:** mark it `in-progress` (set lane status via the
   ledger), create its worktree, then **dispatch ONE fix subagent** (Agent tool;
   the lanes are file-disjoint, so dispatch the batch in parallel):
   ```sh
   node .claude/skills/upstream-fix/scripts/worktree-setup.mjs <laneId> main
   ```
3. **Fold each subagent's thin result** into the ledger and mark the lane `done`:
   ```sh
   node .claude/skills/upstream-fix/scripts/record-result.mjs $DIR/$DATE-run-state.json '#63 resolved deadbee "..."'
   ```
   Do **not** read anything the subagent wrote beyond its one-liners.

### Fix-subagent prompt template

Dispatch with the Agent tool. The prompt is assembled from **ledger fields only**
(numbers, guidance *paths*, target files, worktree) — never inlined content:

```
You are fixing upstream-port issues on an isolated git worktree for otto-cli.

Worktree: <worktree path>   (cd here first; do ALL work here)
Branch:   <branch>

Fix these issues IN THIS ORDER (critical first). For EACH issue:

  Issues:
  - #<num> sha=<sha> guidance=<guidancePath> targetFiles=<targetFiles>
  ...

PROTOCOL per issue (all four gates are mandatory):

0. CONFIDENCE GATE. Read the issue body (`gh issue view <num> --repo
   cmetech/otto-cli`) and its guidance file at <guidancePath>. Then INDEPENDENTLY
   verify against the ACTUAL otto-cli source that the proposed port is correct.
   otto-cli is NOT a 1:1 mirror of upstream (packages renamed/restructured) — the
   guidance is a strong pointer, not ground truth. If your confidence is not full:
   DO NOT modify code. Run:
     gh issue comment <num> --repo cmetech/otto-cli --body "<concrete concern>"
   and record the issue as unresolved (see RETURN). Move to the next issue.

1. REGRESSION TEST. Write a node:test `*.test.ts` co-located with the source you
   will change. Confirm it FAILS against current behaviour:
     node .claude/skills/upstream-fix/scripts/run-gates.mjs regression \
       --cwd <worktree> --log <DIR>/<DATE>-gate-logs/lane-<n>-<num>-reg-before.log \
       --test-file <relpath-to-test>
   It MUST fail now. Apply the fix. Re-run the same gate; it MUST pass.
   (If a runtime regression test is genuinely impossible — e.g. pure
   packaging/metadata — record a justification in your return line; such issues
   need explicit reviewer approval later.)

2. BUILD GATE:
     node .claude/skills/upstream-fix/scripts/run-gates.mjs build \
       --cwd <worktree> --log <...>-build.log --files <targetFiles csv>
   Must return pass:true.

3. TARGETED SUITE GATE:
     node .claude/skills/upstream-fix/scripts/run-gates.mjs targeted \
       --cwd <worktree> --log <...>-targeted.log --files <targetFiles csv>
   Must return pass:true.

4. COMMIT (one granular Conventional Commit per issue, in the worktree):
     git add <changed files>
     git commit -m "fix(<scope>): <summary> (closes #<num>)"

RETURN CONTRACT — output ONE line per issue, NOTHING else (no diffs, no logs):
  #<num> resolved <commit-sha-7> "<one-line what you did>"
  #<num> unresolved none "<concrete reason / concern>"
```

## Phase C — Review, integrate, final gate (sequential, after lanes finish)

1. **Reviewer gate (per resolved issue).** Dispatch an **independent reviewer
   subagent** for each issue whose ledger status is `resolved`:

   ### Reviewer-subagent prompt template
   ```
   Independently review a committed fix in worktree <worktree> for otto-cli
   issue #<num> (sha=<sha>, guidance=<guidancePath>).

   - Read the committed diff: `git -C <worktree> show <commitSha>`
   - Read the issue + guidance for upstream intent.
   - Judge: does the diff correctly and completely fix the described problem,
     without regressions or scope creep? (Catch "passes tests but wrong/incomplete".)

   RETURN exactly one line:
     approve <one-line rationale>
     reject  <one-line concrete reason>
   ```
   Fold the verdict into the ledger (set `reviewer`/`reviewerReason`; on `reject`
   set issue status `rejected`). A reject excludes that commit from integration.

2. **Integration.** Create `integration/upstream-fix-$DATE` off `main`. For each
   lane with ≥1 approved issue, in lane order, **post-hoc overlap check then merge:**
   - Compare each issue's `touchedFiles` (from the subagent / `git show --name-only`)
     against its declared `targetFiles` via `detectOverlap`. A lane that strayed
     into another lane's files is merged **last** and re-verified.
   ```sh
   git checkout integration/upstream-fix-$DATE
   node .claude/skills/upstream-fix/scripts/worktree-merge.mjs <laneBranch> integration/upstream-fix-$DATE
   ```
   On `conflict:true`, mark that lane's issues `unresolved` (reason: "merge
   conflict on integration") rather than force-resolving; set lane `failed`.

3. **Final full suite** on the integration branch (controller runs this once):
   ```sh
   node .claude/skills/upstream-fix/scripts/run-gates.mjs full \
     --cwd . --log $DIR/$DATE-gate-logs/final.log
   ```
   The `full` gate chains `npm test` → `npm run verify:pr` through the log
   firewall (returns only `{pass, failTail}`, stops at the first failure). Set
   ledger `finalSuite` from the result. **If red, hold integration, report, and
   STOP — nothing reaches main.**

4. **PR.** One PR from the integration branch to `main`, body summarising
   resolved/unresolved counts and linking the issues:
   ```sh
   gh pr create --base main --head integration/upstream-fix-$DATE \
     --title "fix(upstream): port <N> filed issues" --body "<rollup>"
   ```
   Record `prUrl` in the ledger.

## Phase D — Close issues + report

1. **Lifecycle (per issue):**
   - Applied (merged + reviewer-approved + final suite green):
     ```sh
     node .claude/skills/upstream-fix/scripts/issue-update.mjs <num> --repo cmetech/otto-cli \
       --add-label status:applied --remove-label status:triaged --remove-label status:in-progress \
       --comment "Applied in <commitSha> (PR <prUrl>)." --close
     ```
     Set ledger issue status `applied`.
   - Unresolved/rejected: leave open, keep `status:triaged`, comment the blocker
     (no `--close`).
2. **Report:**
   ```sh
   node .claude/skills/upstream-fix/scripts/write-report.mjs $DIR/$DATE-run-state.json $DIR
   ```
3. **Worktree hygiene:** on success `git worktree remove <worktree>`; on failure
   leave it and note its path in the report.

## Flags

- `--dry-run` — select + plan lanes, print the plan, do no work.
- `--resume` — idempotent re-run from the ledger; skips `status:applied`.
- `--severity | --type | --label | --issues | --all` — selection groupings (Task 3).
- `--guidance-dir <dir>` — alternate guidance directory.

## References

- Design spec: `docs/superpowers/specs/2026-05-30-upstream-fix-skill-design.md`
- Companion: `.claude/skills/upstream-cherry-pick/SKILL.md`
````

- [ ] **Step 12.2: Manual checklist read-through.** Confirm SKILL.md states: all four gates mandatory; ≤3 lanes; low-confidence ⇒ no code change + comment + `unresolved`; never force-push / never commit to main / never `--no-verify`; subagents return thin one-liners only; controller never reads diffs/logs; `--resume` safety. Fix any gap inline.

- [ ] **Step 12.3: Commit**

```bash
git add .claude/skills/upstream-fix/SKILL.md
git commit -m "feat(skill): write upstream-fix orchestration body"
```

---

## Task 13: `/upstream-fix` slash-command wrapper

**Files:**
- Create: `.claude/commands/upstream-fix.md`

- [ ] **Step 13.1: Inspect an existing command wrapper for format**

```bash
ls .claude/commands/ | head; sed -n '1,40p' .claude/commands/$(ls .claude/commands/ | head -1)
```

Match its frontmatter shape (e.g. `description`, `argument-hint`).

- [ ] **Step 13.2: Write the wrapper** `.claude/commands/upstream-fix.md`:

```markdown
---
description: Implement filed upstream-cherry-pick issues (file-disjoint lanes, four confidence gates, one PR).
argument-hint: "<filter> e.g. --severity critical-stability | --issues 62,63 | --all [--dry-run] [--resume]"
---

Invoke the `upstream-fix` skill to implement filed `cmetech/otto-cli` issues.

Arguments: $ARGUMENTS

Follow `.claude/skills/upstream-fix/SKILL.md` exactly. Honor every locked
invariant (≤3 lanes, four mandatory gates, never force-push, never commit to
main directly, low-confidence ⇒ comment + unresolved). Keep the controller
context flat: drive the `.mjs` scripts, dispatch subagents for the heavy work,
and never read diffs/guidance/logs into your own context.
```

- [ ] **Step 13.3: Commit**

```bash
git add .claude/commands/upstream-fix.md
git commit -m "feat(skill): add /upstream-fix slash command"
```

---

## Task 14: Full skill test sweep + E2E acceptance against issue #63

**Files:** none created — this is verification (spec §13).

- [ ] **Step 14.1: Run every skill unit test, expect all green**

```bash
node --test .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs
```

Expected: all tests pass across ledger, select-issues, plan-lanes, scheduler, worktree-setup, run-gates, worktree-merge, record-result, issue-update, write-report.

- [ ] **Step 14.2: Dry-run against a single critical issue** (no source changes)

```bash
node .claude/skills/upstream-fix/scripts/select-issues.mjs --issues 63 --out .planning/upstream-fixes/$(date +%F)-selected-issues.json
node .claude/skills/upstream-fix/scripts/plan-lanes.mjs .planning/upstream-fixes/$(date +%F)-selected-issues.json .planning/upstream-fixes/$(date +%F)-lanes.json
```

Expected: `count: 1`, exactly 1 lane containing `#63` with its target file(s) from `guidance/ce0e801.md`. If `needsTriage: 1` instead, the guidance file's "Target file(s)" section needs a concrete path — fix the guidance, not the script.

- [ ] **Step 14.3: Full E2E (real, against #63 / ce0e801).** Run the skill end to
  end for `--issues 63` and confirm the full chain from spec §13:

  lane planned → worktree created → regression test written (fails→passes) →
  build green → targeted+full suite green → reviewer approved → merged to
  integration → PR opened → issue closed with `status:applied` → report written →
  worktree cleaned up → **controller context stayed flat** (verify: no diff/log/issue
  body was ever read into the controller transcript).

  Capture evidence in the report at `.planning/upstream-fixes/$(date +%F)-fix-report.md`.

- [ ] **Step 14.4: Verify gates on the integration branch** before the PR merges

```bash
npm test && npm run verify:pr
```

Expected: green. If red, integration is held — nothing reaches main (per invariant).

- [ ] **Step 14.5: Final commit (artifacts only — skill code already committed)**

```bash
git add .planning/upstream-fixes/
git commit -m "test(skill): upstream-fix E2E acceptance against #63"
```

---

## Self-review (completed during planning)

- **Spec coverage:** §3 orchestration split → Tasks 2–11 (scripts) + 12 (SKILL.md). §4 selection/lanes → Tasks 3–4. §5 fix subagent + four gates → Task 7 + Task 12 prompt template. §6 reviewer/integrate/final → Task 12 Phase C + Task 8. §7 lifecycle/report → Tasks 10–11 + Task 12 Phase D. §8 context budget → ledger (Task 2) + scheduler (Task 5) + run-gates failTail (Task 7) + SKILL.md "Context budget". §9 triggering → Task 13. §10 robustness (dry-run/resume/cap/safety) → Task 12 flags + Phase A. §11 script inventory → Tasks 2–11 (one per script). §12 standards → gate-command table + Conventional Commits throughout. §13 E2E → Task 14.
- **Spec correction surfaced:** §5.4's `npm test -w @otto/<pkg>` does not exist in this repo; the plan substitutes real commands (regression via strip-types, build via `npm run build`, targeted via `test:packages`/`test:unit`, full via `npm test` + `verify:pr`).
- **Type consistency:** ledger field names (`status`, `commitSha`, `touchedFiles`, `gates.{regression,build,targeted}`, `reviewer`, `reviewerReason`, `reason`) are identical across `ledger.mjs`, `record-result.mjs`, `write-report.mjs`, and the SKILL.md prompts. Function names stable: `readLedger/writeLedger/initLedger/recordIssueResult/setLaneStatus/setIssueStatus`, `selectIssues/buildSearchArgs/parseGuidanceTargets`, `planLanes`, `nextLanes`, `setupWorktree`, `runGate/resolveGateCommands/tailLines`, `mergeLane/detectOverlap`, `parseResultLine/foldResult/recordLaneResult`, `updateIssue`, `renderReport/writeReport`.
- **No placeholders:** every code step contains complete, runnable code.
