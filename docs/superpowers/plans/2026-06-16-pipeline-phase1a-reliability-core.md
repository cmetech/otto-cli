# Pipeline Phase 1A — Reliability Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `swarm-control.mjs` controller spine with its two new reliability subcommands — `gate` (#3) and `verify-fix` (#4) — and move the full test suite out of the `--single-issue` fix lane (#1), so lane subagents stop dying mid-suite and gate results are captured in-process instead of by fragile shell parsing.

**Architecture:** A new Node CLI `swarm-control.mjs` dispatches to focused modules. `control-gate.mjs` imports `trialMerge` + `runGate` as functions (no shell/stdout parsing) and adds an isolated flake re-run. `control-verify.mjs` checks PR/branch/diff artifacts and refuses to bless a fix unless they exist. The `upstream-fix` SKILL `--single-issue` contract is rewritten so the lane runs regression+build+targeted+reviewer only; the full suite runs once in the controller's `gate` subcommand (which the swarm already invokes as its local gate, and which standalone single-issue runs on the lane branch).

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, injectable runner functions for `gh`/`git`/gate (the seam pattern from `refute-panel.mjs` and `trial-merge.mjs`).

---

## File Structure

**Create:**
- `.claude/skills/upstream-swarm/scripts/swarm-control.mjs` — CLI dispatcher (routes `verify-fix`, `gate`; later plans add the rest).
- `.claude/skills/upstream-swarm/scripts/control-verify.mjs` — `verifyFixArtifacts(...)` (#4), pure + injectable runners.
- `.claude/skills/upstream-swarm/scripts/control-gate.mjs` — `gateForPr(...)` (#3), imports `trialMerge` + `runGate`.
- `.claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs`
- `.claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs`
- `.claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`

**Modify:**
- `.claude/skills/upstream-fix/SKILL.md` — rewrite the §79-88 "Gate completion (no premature exit)" block and the `--single-issue` protocol so the lane no longer runs the full suite; document the controller `gate` step.
- `.claude/skills/upstream-swarm/SKILL.md` — point the `run-local-gate` action at `swarm-control.mjs gate`.

**Reuse (do not modify):**
- `.claude/skills/upstream-merge/scripts/trial-merge.mjs` — `trialMerge({prNumber, headRef, base, gitRunner, provisionDeps})` → `{worktree, merged, conflict}`.
- `.claude/skills/_common/scripts/run-gates.mjs` — `runGate({gate, cwd, logPath, targetFiles, testFile, runner})` → `{pass, failTail}`.

---

## Task 1: Scaffold the `swarm-control.mjs` CLI dispatcher

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/swarm-control.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch, KNOWN_COMMANDS } from "../swarm-control.mjs";

test("dispatch routes to a registered handler and returns its result", async () => {
  const calls = [];
  const handlers = { ping: async (args) => { calls.push(args); return { ok: true, echo: args }; } };
  const out = await dispatch(["ping", "--x", "1"], handlers);
  assert.deepEqual(out, { ok: true, echo: ["--x", "1"] });
  assert.deepEqual(calls, [["--x", "1"]]);
});

test("dispatch throws a usage error for an unknown command", async () => {
  await assert.rejects(() => dispatch(["bogus"], {}), /unknown command: bogus/);
});

test("KNOWN_COMMANDS lists the subcommands this plan ships", () => {
  assert.ok(KNOWN_COMMANDS.includes("verify-fix"));
  assert.ok(KNOWN_COMMANDS.includes("gate"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`
Expected: FAIL — `Cannot find module '../swarm-control.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/upstream-swarm/scripts/swarm-control.mjs
#!/usr/bin/env node
/**
 * swarm-control.mjs — deterministic controller spine for the upstream-port
 * pipeline. Sole writer of the swarm ledger; every subcommand is JSON in / JSON
 * out so the orchestrator (and the future Workflow driver) never ingest heavy
 * output. This plan (Phase 1A) ships `verify-fix` and `gate`; later plans add
 * preflight/select/plan/tick/record/classify/merge/report/cleanup.
 */
import { verifyFixArtifacts } from "./control-verify.mjs";
import { gateForPr } from "./control-gate.mjs";

export const KNOWN_COMMANDS = ["verify-fix", "gate"];

// Each handler takes the post-subcommand argv array and returns a plain object.
export function defaultHandlers() {
  return {
    "verify-fix": (args) => verifyFixArtifacts(parseFlags(args)),
    "gate": (args) => gateForPr(parseFlags(args)),
  };
}

export function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

export async function dispatch(argv, handlers = defaultHandlers()) {
  const [command, ...rest] = argv;
  const handler = handlers[command];
  if (!handler) throw new Error(`unknown command: ${command}`);
  return handler(rest);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  dispatch(process.argv.slice(2))
    .then((result) => { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); })
    .catch((err) => {
      process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it fails differently**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`
Expected: FAIL — `Cannot find module './control-verify.mjs'` (the imports don't exist yet). This is expected; Task 2 and Task 3 create them. Proceed to Task 2; this test goes green at the end of Task 3.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-swarm/scripts/swarm-control.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs
git commit -m "feat(swarm-control): CLI dispatcher scaffold for the controller spine"
```

---

## Task 2: `verify-fix` subcommand (#4 — structural artifact verification)

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/control-verify.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs`

**Contract:** `verifyFixArtifacts({ pr, issue, branch, targets, repo, ghRunner, gitRunner })` returns
`{ ok: boolean, reasons: string[], scopeNotes: string[] }`.
- `ok:false` (hard fail) if: PR is not OPEN, branch is not pushed to origin, the diff is empty, or the diff touches **none** of the declared `targets`.
- `ok:true` otherwise. Files in the diff that are **not** in `targets` do not fail — they are appended to `scopeNotes` (passed downstream to the refute scope-discipline lens).
- `targets` is a comma-separated string (CLI) or an array (programmatic).

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyFixArtifacts } from "../control-verify.mjs";

function fakes({ prState = "OPEN", lsRemote = "abc123\trefs/heads/b\n", diffFiles = [] }) {
  return {
    ghRunner: (args) => {
      if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ state: prState });
      if (args[0] === "pr" && args[1] === "diff") return diffFiles.join("\n") + (diffFiles.length ? "\n" : "");
      throw new Error("unexpected gh " + args.join(" "));
    },
    gitRunner: (args) => {
      if (args[0] === "ls-remote") return lsRemote;
      throw new Error("unexpected git " + args.join(" "));
    },
  };
}

test("passes when PR open, branch pushed, diff scoped to targets", () => {
  const r = verifyFixArtifacts({
    pr: 400, issue: 114, branch: "fix/x", targets: ["a.ts", "a.test.ts"],
    ...fakes({ diffFiles: ["a.ts", "a.test.ts"] }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.scopeNotes, []);
});

test("extra files become scopeNotes, not a hard fail", () => {
  const r = verifyFixArtifacts({
    pr: 395, issue: 88, branch: "fix/y", targets: ["pm.ts", "pm.test.ts"],
    ...fakes({ diffFiles: ["pm.ts", "pm.test.ts", "worktree-lifecycle.ts"] }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.scopeNotes, ["worktree-lifecycle.ts"]);
});

test("fails when PR is not open", () => {
  const r = verifyFixArtifacts({
    pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"],
    ...fakes({ prState: "CLOSED", diffFiles: ["a.ts"] }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /not open/i);
});

test("fails when branch is not pushed", () => {
  const r = verifyFixArtifacts({
    pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"],
    ...fakes({ lsRemote: "", diffFiles: ["a.ts"] }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /not pushed/i);
});

test("fails when diff touches none of the declared targets", () => {
  const r = verifyFixArtifacts({
    pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"],
    ...fakes({ diffFiles: ["totally-unrelated.ts"] }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /none of the declared targets/i);
});

test("fails when diff is empty", () => {
  const r = verifyFixArtifacts({
    pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"],
    ...fakes({ diffFiles: [] }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /empty diff/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs`
Expected: FAIL — `Cannot find module '../control-verify.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/upstream-swarm/scripts/control-verify.mjs
#!/usr/bin/env node
/**
 * control-verify.mjs — verifyFixArtifacts (#4). Confirms a fix lane's durable
 * artifacts exist before the controller records `fix-ok`, closing the
 * premature-completion hole by construction (a subagent's "done" text is never
 * trusted). Extra (collateral) files do not fail; they become scopeNotes for
 * the refute scope-discipline lens.
 */
import { execFileSync } from "node:child_process";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }
function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }

function toList(targets) {
  if (Array.isArray(targets)) return targets.filter(Boolean);
  if (typeof targets === "string") return targets.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function verifyFixArtifacts({
  pr, issue, branch, targets,
  repo = "cmetech/otto-cli",
  ghRunner = defaultGhRunner,
  gitRunner = defaultGitRunner,
}) {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) throw new Error(`pr must be an integer: ${pr}`);
  if (!branch) throw new Error("branch is required");
  const targetList = toList(targets);
  const reasons = [];

  // 1. PR is OPEN.
  const prView = JSON.parse(ghRunner(["pr", "view", String(prNumber), "--repo", repo, "--json", "state"]));
  if (prView.state !== "OPEN") reasons.push(`PR #${prNumber} is not open (state=${prView.state})`);

  // 2. Branch is pushed to origin.
  const lsRemote = gitRunner(["ls-remote", "--heads", "origin", branch]).trim();
  if (!lsRemote) reasons.push(`branch ${branch} is not pushed to origin`);

  // 3. Diff is non-empty and intersects the declared targets.
  const diffFiles = ghRunner(["pr", "diff", String(prNumber), "--repo", repo, "--name-only"])
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const scopeNotes = [];
  if (diffFiles.length === 0) {
    reasons.push(`empty diff for PR #${prNumber}`);
  } else if (targetList.length > 0) {
    const targetSet = new Set(targetList);
    const hitsTarget = diffFiles.some((f) => targetSet.has(f));
    if (!hitsTarget) reasons.push(`diff touches none of the declared targets (${targetList.join(", ")})`);
    for (const f of diffFiles) if (!targetSet.has(f)) scopeNotes.push(f);
  }

  return { ok: reasons.length === 0, reasons, scopeNotes, issue: issue ?? null, pr: prNumber };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs`
Expected: PASS — all six tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-swarm/scripts/control-verify.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs
git commit -m "feat(swarm-control): verify-fix subcommand for structural artifact verification (#4)"
```

---

## Task 3: `gate` subcommand (#3 — deterministic gate runner with flake re-run)

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/control-gate.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs`

**Contract:** `gateForPr({ pr, headRef, targets, logDir, base, trialMergeFn, runGateFn, gitRunner })` returns
`{ pass, verdict, failTail, worktree, reran, suspiciousOverlap }` where `verdict ∈ {"pass","flake","real","conflict"}`.
Algorithm:
1. `trialMergeFn` → if `conflict`, return `{pass:false, verdict:"conflict"}` (no gate run).
2. Run `runGateFn` (the `full` gate) in the worktree. If `pass`, return `{pass:true, verdict:"pass"}`.
3. On fail, compute `suspiciousOverlap` = any declared target's basename appears in the failTail (a changed-file name showing up among failures ⇒ likely a real, PR-related break). If suspicious, return `{pass:false, verdict:"real"}` — do **not** re-run.
4. Otherwise re-run the `full` gate **once** in a fresh isolated trial-merge worktree (no other gate runs concurrently — the controller serializes). If the re-run passes ⇒ `{pass:true, verdict:"flake", reran:true}`; if it fails again ⇒ `{pass:false, verdict:"real", reran:true}`.

This captures the gate result **as a function return value** (the `runGate`/`trialMerge` objects) — never by parsing stdout, the wave2 bug. Known-flaky allowlist (#5) is deferred to Phase 3.

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateForPr } from "../control-gate.mjs";

const baseArgs = { pr: 400, headRef: "fix/x", targets: ["repo-registry.ts"], logDir: "/tmp/gatelogs" };

test("conflict on trial-merge short-circuits with verdict=conflict", () => {
  const r = gateForPr({
    ...baseArgs,
    trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: false, conflict: true }),
    runGateFn: () => { throw new Error("should not run gate on conflict"); },
  });
  assert.equal(r.verdict, "conflict");
  assert.equal(r.pass, false);
});

test("clean pass returns verdict=pass without re-run", () => {
  let runs = 0;
  const r = gateForPr({
    ...baseArgs,
    trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }),
    runGateFn: () => { runs++; return { pass: true, failTail: "" }; },
  });
  assert.equal(r.verdict, "pass");
  assert.equal(r.pass, true);
  assert.equal(runs, 1);
});

test("fail then clean re-run = flake", () => {
  let runs = 0;
  const r = gateForPr({
    ...baseArgs,
    trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }),
    runGateFn: () => { runs++; return runs === 1
      ? { pass: false, failTail: "not ok 214 - headless --output-format stream-json" }
      : { pass: true, failTail: "" }; },
  });
  assert.equal(r.verdict, "flake");
  assert.equal(r.pass, true);
  assert.equal(r.reran, true);
  assert.equal(runs, 2);
});

test("fail twice = real", () => {
  const r = gateForPr({
    ...baseArgs,
    trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }),
    runGateFn: () => ({ pass: false, failTail: "not ok 9 - some unrelated test" }),
  });
  assert.equal(r.verdict, "real");
  assert.equal(r.pass, false);
  assert.equal(r.reran, true);
});

test("failTail naming a changed target file is real without re-run (suspicious overlap)", () => {
  let runs = 0;
  const r = gateForPr({
    ...baseArgs,
    trialMergeFn: () => ({ worktree: ".worktrees/wt", merged: true, conflict: false }),
    runGateFn: () => { runs++; return { pass: false, failTail: "FAIL repo-registry.ts > resolves root" }; },
  });
  assert.equal(r.verdict, "real");
  assert.equal(r.pass, false);
  assert.equal(r.suspiciousOverlap, true);
  assert.equal(runs, 1); // no re-run
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs`
Expected: FAIL — `Cannot find module '../control-gate.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/upstream-swarm/scripts/control-gate.mjs
#!/usr/bin/env node
/**
 * control-gate.mjs — gateForPr (#3). Trial-merges a PR onto origin/main in a
 * fresh worktree and runs the `full` suite IN-PROCESS via runGate (the result
 * is a function return value, never parsed from stdout — that shell-parse was
 * the wave2 false-negative bug). On failure, an isolated single re-run
 * distinguishes a load-induced flake from a real break, unless a changed target
 * file appears in the failure tail (suspicious → real without re-run).
 */
import { basename } from "node:path";
import { join } from "node:path";
import { trialMerge as defaultTrialMerge } from "../../upstream-merge/scripts/trial-merge.mjs";
import { runGate as defaultRunGate } from "../../_common/scripts/run-gates.mjs";

function toList(targets) {
  if (Array.isArray(targets)) return targets.filter(Boolean);
  if (typeof targets === "string") return targets.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// A changed target file name surfacing in the failure tail means the break is
// likely caused by this PR — treat as real and skip the flake re-run.
function isSuspiciousOverlap(failTail, targetList) {
  const tail = failTail ?? "";
  return targetList.some((t) => {
    const b = basename(t);
    return tail.includes(t) || tail.includes(b);
  });
}

export function gateForPr({
  pr, headRef, targets, logDir, base = "origin/main",
  trialMergeFn = defaultTrialMerge,
  runGateFn = defaultRunGate,
}) {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) throw new Error(`pr must be an integer: ${pr}`);
  if (!headRef) throw new Error("headRef is required");
  const targetList = toList(targets);

  const tm = trialMergeFn({ prNumber, headRef, base });
  if (tm.conflict) {
    return { pass: false, verdict: "conflict", failTail: "trial-merge conflict", worktree: tm.worktree, reran: false, suspiciousOverlap: false };
  }

  const first = runGateFn({ gate: "full", cwd: tm.worktree, logPath: join(logDir, `gate-pr${prNumber}.log`), targetFiles: targetList });
  if (first.pass) {
    return { pass: true, verdict: "pass", failTail: "", worktree: tm.worktree, reran: false, suspiciousOverlap: false };
  }

  const suspiciousOverlap = isSuspiciousOverlap(first.failTail, targetList);
  if (suspiciousOverlap) {
    return { pass: false, verdict: "real", failTail: first.failTail, worktree: tm.worktree, reran: false, suspiciousOverlap: true };
  }

  // Isolated single re-run in a fresh worktree (controller serializes gates, so
  // nothing competes for CPU this time — load-induced flakes clear here).
  const tm2 = trialMergeFn({ prNumber, headRef, base });
  if (tm2.conflict) {
    return { pass: false, verdict: "real", failTail: "re-run trial-merge conflict", worktree: tm2.worktree, reran: true, suspiciousOverlap: false };
  }
  const second = runGateFn({ gate: "full", cwd: tm2.worktree, logPath: join(logDir, `gate-pr${prNumber}-rerun.log`), targetFiles: targetList });
  if (second.pass) {
    return { pass: true, verdict: "flake", failTail: "", worktree: tm2.worktree, reran: true, suspiciousOverlap: false };
  }
  return { pass: false, verdict: "real", failTail: second.failTail, worktree: tm2.worktree, reran: true, suspiciousOverlap: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs`
Expected: PASS — all five tests.

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`
Expected: PASS — the Task 1 dispatcher test now resolves its imports and goes green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-swarm/scripts/control-gate.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs
git commit -m "feat(swarm-control): gate subcommand with in-process capture + isolated flake re-run (#3)"
```

---

## Task 4: Verify the CLI end-to-end against real `gh`/`git` shims

**Files:**
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs` (extend)

This proves the `--json`-out CLI path works (the orchestrator/Workflow driver call it as a process), using the programmatic seam so no real network is touched.

- [ ] **Step 1: Add a CLI-shape test**

Append to `swarm-control.test.mjs`:

```js
import { parseFlags } from "../swarm-control.mjs";

test("parseFlags parses --k v pairs and boolean flags", () => {
  assert.deepEqual(parseFlags(["--pr", "400", "--branch", "fix/x", "--unattended"]),
    { pr: "400", branch: "fix/x", unattended: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`
Expected: FAIL — `parseFlags is not exported` only if missing; if Task 1 already exported it, this passes immediately. If it fails, ensure `parseFlags` is exported in `swarm-control.mjs` (it is, per Task 1 Step 3).

- [ ] **Step 3: No implementation needed**

`parseFlags` was exported in Task 1. If the test fails, the fix is to add `export` to `parseFlags` — no other change.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs
git commit -m "test(swarm-control): cover CLI flag parsing"
```

---

## Task 5: Rewrite `upstream-fix` SKILL `--single-issue` contract (#1 — full suite out of the lane)

**Files:**
- Modify: `.claude/skills/upstream-fix/SKILL.md` (the §79-88 "Gate completion (no premature exit)" block)

The lane must stop running the full suite in-process. The full suite moves to the controller `gate` subcommand (invoked by the swarm as its local gate; for standalone single-issue, run on the lane branch after PR-open).

- [ ] **Step 1: Read the current block to anchor the edit**

Run: `sed -n '79,88p' .claude/skills/upstream-fix/SKILL.md`
Expected: the paragraph beginning "**Gate completion (no premature exit).** A `--single-issue` lane MUST run every gate — regression (fails-before/passes-after), build, targeted, **full suite**, and the **independent reviewer** …".

- [ ] **Step 2: Replace the block**

Replace that paragraph with:

```markdown
**Gate completion (no premature exit).** A `--single-issue` lane MUST run its
in-lane gates — regression (fails-before/passes-after), build, targeted, and the
**independent reviewer** — to completion *in-process* before pushing the branch
and opening the PR. The lane does **NOT** run the full suite: that is the
controller's job, run **once** in a fresh trial-merge worktree by
`swarm-control.mjs gate` (the swarm invokes this as its local gate; a standalone
single-issue run invokes it on the lane branch after PR-open). This keeps the
lane subagent fast and in-budget — the multi-minute full suite was the cause of
mid-gate subagent deaths (premature "done" signals with an un-pushed commit).
NEVER background a gate. The lane's last in-process step is PR-open, after
regression+build+targeted+reviewer are green; the full-suite verdict is recorded
later by the controller, not the lane.
```

- [ ] **Step 3: Verify the edit**

Run: `grep -n "does \*\*NOT\*\* run the full suite" .claude/skills/upstream-fix/SKILL.md`
Expected: one match.

Run: `grep -nc "full suite" .claude/skills/upstream-fix/SKILL.md`
Expected: the count drops (the in-lane mandate is gone); remaining matches are the controller/Phase-C references.

- [ ] **Step 4: Confirm multi-issue Phase C is already compliant (no change)**

Run: `sed -n '265,273p' .claude/skills/upstream-fix/SKILL.md`
Expected: the "Final full suite on the integration branch (controller runs this once)" block is present and unchanged — multi-issue mode already runs the full suite once, in the controller, not the lane. No edit needed; this step is a confirmation.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/upstream-fix/SKILL.md
git commit -m "docs(upstream-fix): move full suite out of the single-issue lane into the controller gate (#1)"
```

---

## Task 6: Point the swarm `run-local-gate` action at `swarm-control.mjs gate`

**Files:**
- Modify: `.claude/skills/upstream-swarm/SKILL.md` (the `run-local-gate` row of the Phase B action table)

- [ ] **Step 1: Read the current action row to anchor the edit**

Run: `grep -n "run-local-gate" .claude/skills/upstream-swarm/SKILL.md`
Expected: the row: "`run-local-gate` | `trial-merge` + `run-gates.mjs full` in a worktree at origin/main. On pass → `local-gate-pending` …".

- [ ] **Step 2: Replace the action description**

Replace the `run-local-gate` cell body with:

```markdown
Run `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs gate --pr <prNumber> --head-ref <branch> --targets <csv> --log-dir <DIR>/<DATE>-gate-logs`. This trial-merges onto origin/main in a fresh worktree and runs the `full` suite **in-process** (result captured as a return value, never parsed from stdout), with a single isolated re-run that distinguishes a load-induced flake (`verdict:"flake"` → treat as pass) from a real break (`verdict:"real"` → classify + quarantine). Read only the returned `{pass, verdict, failTail}`. On `pass` (verdict `pass` or `flake`) → `local-gate-pending`. On `verdict:"real"` or `"conflict"` → classify, retry or quarantine. The controller serializes gates (one full-suite at a time); never run a gate inside a lane's live worktree.
```

- [ ] **Step 3: Verify the edit**

Run: `grep -n "swarm-control.mjs gate" .claude/skills/upstream-swarm/SKILL.md`
Expected: one match in the `run-local-gate` row.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/upstream-swarm/SKILL.md
git commit -m "docs(upstream-swarm): route run-local-gate through swarm-control gate (#1/#3)"
```

---

## Task 7: Full test sweep + skill self-test

**Files:** none (verification only)

- [ ] **Step 1: Run all new unit tests together**

Run:
```bash
node --test .claude/skills/upstream-swarm/scripts/__tests__/swarm-control.test.mjs \
            .claude/skills/upstream-swarm/scripts/__tests__/control-verify.test.mjs \
            .claude/skills/upstream-swarm/scripts/__tests__/control-gate.test.mjs
```
Expected: all tests PASS, exit 0.

- [ ] **Step 2: Run the skill test harness if present**

Run: `node .claude/skills/_common/scripts/run-skill-tests.mjs upstream-swarm 2>/dev/null || echo "no skill-test harness wrapper; unit tests above are authoritative"`
Expected: PASS, or the fallback message.

- [ ] **Step 3: Confirm no regression in the existing swarm tests**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs`
Expected: all existing + new tests PASS.

- [ ] **Step 4: Commit (if any snapshot/fixture updates were needed)**

```bash
git add -A && git commit -m "test(swarm-control): green sweep for Phase 1A reliability core" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** #1 (Tasks 5,6 + confirmation of compliant multi-issue Phase C), #3 (Task 3), #4 (Task 2), controller scaffold for #2's future driver (Task 1). Deferred by design: #2 driver, #5 allowlist, #6 pre-auth, #7 deps — Plans 1B/2/3.
- **Type consistency:** `verifyFixArtifacts` returns `{ok, reasons, scopeNotes, issue, pr}`; `gateForPr` returns `{pass, verdict, failTail, worktree, reran, suspiciousOverlap}`; both consumed by the dispatcher as plain objects. `runGate`/`trialMerge` signatures match the reused scripts verified during planning.
- **No placeholders:** every code/test step is complete and runnable.
- **Out of scope guard:** standalone single-issue invocation of `swarm-control gate` is documented in the SKILL (Task 5) but its orchestration wiring (who calls it, when) lands with the `tick`/driver work in Plan 1B/2 — Phase 1A delivers the gate *mechanism* and the lane *contract* change, which is independently valuable.
