# Pipeline Phase 2a — Driver Core + Unattended Pre-Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, unit-tested `driver-core.mjs` that holds every decision the unattended Workflow driver needs — map a scheduler tick's actions to a dispatch plan, build fix-lane and refute-lens prompts, build the exact `swarm-control` argv for each controller call, and the #6 unattended pre-authorization assertion — plus the `settings.local.json` allowlist entry for non-interactive merge. This is the testable foundation; the thin Workflow shell that wires it is **Phase 2b** (an interactive build — see "Why the Workflow shell is separate").

**Architecture:** `driver-core.mjs` is pure (no fs/shell/agent calls). Its argv builders are validated by feeding them straight into `swarm-control`'s real `dispatch()` — so the CLI seam (the class of bug Phase 1A's final review caught) is unit-tested. #6 is reframed correctly: there is no code-level auto-merge gate to unlock (`merge-pr` already refuses unless the refute verdict is `approve`); what blocks unattended merge is the agent/harness declining an outward-facing irreversible action without authorization, so #6 = a permission allowlist entry + an explicit, logged `assertUnattendedAuthorized` signal, with the locked invariants remaining the real authorization.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`. Reuses `swarm-control.mjs` (`dispatch`), `refute-panel.mjs` (`LENS_NAMES`).

## Why the Workflow shell is separate (Phase 2b)

A Workflow-tool script (`swarm-driver.mjs`) runs in a sandbox with no fs/shell access and **cannot be unit-tested** with `node:test`; its correctness depends on live Workflow runs and on the agent-return-value shapes you only see at runtime. Building it as scripted TDD tasks would mean shipping unvalidated glue dressed up as "done." Instead, this plan delivers all the *decision logic* as tested `driver-core` functions; the shell is thin glue developed interactively in Phase 2b (live dry-run → supervised 1–2 issue run → trust). The reference scaffold for that shell is in the Appendix.

---

## Reused (import; do NOT modify)

| Symbol | Module | Use |
|---|---|---|
| `dispatch` | `upstream-swarm/scripts/swarm-control.mjs` | tests run driver-core argv through it |
| `LENS_NAMES` | `upstream-merge/scripts/refute-panel.mjs` | the 4 refute lenses |

---

## File Structure

**Create:**
- `.claude/skills/upstream-swarm/scripts/driver-core.mjs`
- `.claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`

**Modify:**
- `.claude/settings.local.json` — merge-command permission allow entry (#6).
- `.claude/skills/upstream-swarm/SKILL.md` — document the unattended path + that the Workflow shell is Phase 2b.

---

## Task 1: `driver-core.mjs` — action bucketing + loop termination

**Files:**
- Create: `.claude/skills/upstream-swarm/scripts/driver-core.mjs`
- Test: `.claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`

**Contract:**
- `isDone(actions)` → `Array.isArray(actions) && actions.length === 0`.
- `bucketActions(actions)` → `{ startFix: number[], quarantineTimeout: {issueNumber, reason}[], pollBatch: number[], localGate: number[], refute: number[], merge: number[] }`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: FAIL — `Cannot find module '../driver-core.mjs'`.

- [ ] **Step 3: Write implementation**

```js
// .claude/skills/upstream-swarm/scripts/driver-core.mjs
#!/usr/bin/env node
/**
 * driver-core.mjs — PURE decision logic for the unattended Workflow driver.
 * No fs/shell/agent calls: it maps a scheduler tick's actions into a dispatch
 * plan, builds fix-lane / refute-lens prompts, and builds the exact
 * `swarm-control.mjs` argv arrays for each controller call. The Phase 2b
 * Workflow shell wires agent()/parallel() + shelled-out controller calls to
 * these. Unit-tested by feeding the argv builders into swarm-control dispatch().
 */
import { LENS_NAMES } from "../../upstream-merge/scripts/refute-panel.mjs";

export function isDone(actions) {
  return Array.isArray(actions) && actions.length === 0;
}

export function bucketActions(actions) {
  const b = { startFix: [], quarantineTimeout: [], pollBatch: [], localGate: [], refute: [], merge: [] };
  for (const a of actions ?? []) {
    switch (a.kind) {
      case "start-fix": b.startFix.push(a.issueNumber); break;
      case "quarantine-timeout": b.quarantineTimeout.push({ issueNumber: a.issueNumber, reason: a.reason }); break;
      case "poll-ci-batch": b.pollBatch.push(...(a.issueNumbers ?? [])); break;
      case "run-local-gate": b.localGate.push(a.issueNumber); break;
      case "run-refute": b.refute.push(a.issueNumber); break;
      case "merge-pr": b.merge.push(a.issueNumber); break;
      default: break; // unknown kinds ignored here (the shell logs them)
    }
  }
  return b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/driver-core.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs
git commit -m "feat(driver-core): action bucketing + loop termination

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `driver-core.mjs` — controller argv builders (verified through dispatch)

**Files:**
- Modify: `driver-core.mjs`
- Modify: `__tests__/driver-core.test.mjs`

**Contract** — each returns a `string[]` argv for `swarm-control.mjs`:
- `tickArgv({ ledger, caps, now })` → `["tick","--ledger",ledger,"--caps",caps,("--now",String(now))?]`.
- `pollArgv(pr)` → `["poll","--pr",String(pr)]`.
- `gateArgv({ pr, headRef, targets, logDir })` → `["gate","--pr",…,"--head-ref",headRef,"--targets",targets,"--log-dir",logDir]`.
- `verifyFixArgv({ pr, issue, branch, targets })` → `["verify-fix",…]`.
- `recordArgv({ ledger, issue, state, payload })` → `["record",…,("--payload",payload)?]`.
- `mergeArgv({ pr, issue, ledger, refuteReason })` → `["merge",…]`.
- `classifyArgv({ stage, failTail })` → `["classify","--stage",stage,"--fail-tail",failTail]`.
- `retryArgv({ ledger, issue, reason })` → `["retry",…]`.

These mirror the documented flags; `parseFlags` camelCases kebab (`--head-ref`→`headRef`, `--log-dir`→`logDir`, `--fail-tail`→`failTail`, `--refute-reason`→`refuteReason`) to match the handlers' destructured params.

- [ ] **Step 1: Write the failing tests**

Append to `driver-core.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: FAIL — argv builders not exported.

- [ ] **Step 3: Add the builders to `driver-core.mjs`**

```js
const s = (v) => String(v);

export function tickArgv({ ledger, caps, now }) {
  const a = ["tick", "--ledger", ledger, "--caps", caps];
  if (now != null) a.push("--now", s(now));
  return a;
}
export function pollArgv(pr) { return ["poll", "--pr", s(pr)]; }
export function gateArgv({ pr, headRef, targets, logDir }) {
  return ["gate", "--pr", s(pr), "--head-ref", headRef, "--targets", targets, "--log-dir", logDir];
}
export function verifyFixArgv({ pr, issue, branch, targets }) {
  return ["verify-fix", "--pr", s(pr), "--issue", s(issue), "--branch", branch, "--targets", targets];
}
export function recordArgv({ ledger, issue, state, payload }) {
  const a = ["record", "--ledger", ledger, "--issue", s(issue), "--state", state];
  if (payload) a.push("--payload", payload);
  return a;
}
export function mergeArgv({ pr, issue, ledger, refuteReason }) {
  return ["merge", "--pr", s(pr), "--issue", s(issue), "--ledger", ledger, "--refute-reason", refuteReason];
}
export function classifyArgv({ stage, failTail }) {
  return ["classify", "--stage", stage, "--fail-tail", failTail];
}
export function retryArgv({ ledger, issue, reason }) {
  return ["retry", "--ledger", ledger, "--issue", s(issue), "--reason", reason];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: PASS — the dispatch round-trips prove the argv reach the real handlers correctly.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/driver-core.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs
git commit -m "feat(driver-core): swarm-control argv builders verified through dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `driver-core.mjs` — fix-lane + refute-lens prompt builders

**Files:**
- Modify: `driver-core.mjs`
- Modify: `__tests__/driver-core.test.mjs`

**Contract:**
- `fixLanePrompt(issue)` → string. `issue` = `{ number, sha?, targetFiles? }`. Returns the single-issue lane prompt: run `upstream-fix --single-issue <number>`, stop at PR-open, **do NOT run the full suite** (controller gate owns it — Phase 1A), run the lighter in-lane gates (regression/build/targeted/reviewer), and return a strict JSON summary.
- `lensPrompts(bundlePath, { prNumber, issueNumber })` → array of 4 `{ lens, prompt }` (one per `LENS_NAMES`); the `upstream-alignment` prompt is strategy-aware.

- [ ] **Step 1: Write the failing tests**

Append:

```js
import { fixLanePrompt, lensPrompts } from "../driver-core.mjs";
import { LENS_NAMES } from "../../upstream-merge/scripts/refute-panel.mjs";

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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: FAIL — `fixLanePrompt`/`lensPrompts` not exported.

- [ ] **Step 3: Implement** (append to `driver-core.mjs`; `LENS_NAMES` is already imported at the top from Task 1)

```js
export function fixLanePrompt(issue) {
  const targets = (issue.targetFiles ?? []).join(", ");
  return [
    `You are a fix-lane subagent for the upstream-swarm pipeline. Execute the upstream-fix skill in single-issue mode for GitHub issue #${issue.number} on cmetech/otto-cli.`,
    ``,
    `Invoke the skill via the Skill tool: upstream-fix with args "--single-issue ${issue.number}". It creates a file-disjoint git-worktree lane, implements the fix (sha ${issue.sha ?? "see issue"}, target files: ${targets || "see guidance"}), runs its IN-LANE gates — regression (fails-before/passes-after), build, targeted suite, and an independent reviewer — to completion in-process, pushes the branch, and opens ONE PR that closes the issue.`,
    ``,
    `CRITICAL constraints:`,
    `- Do NOT run the full test suite in the lane — the swarm controller runs it once via swarm-control gate. Running it here is what caused mid-gate subagent deaths.`,
    `- Do NOT merge. Stop at PR-open.`,
    `- Work ONLY in the issue-${issue.number} worktree lane; run builds/tests inside it only.`,
    `- If blocked on an unported prerequisite or low confidence, do NOT touch code — report outcome "blocked" with the reason and post a blocker comment.`,
    ``,
    `Return ONLY this compact JSON as your entire final message:`,
    `{ "issue": ${issue.number}, "outcome": "pr-opened"|"fix-failed"|"blocked", "prNumber": <n|null>, "prUrl": <url|null>, "branch": <name|null>, "gatesPassed": <bool>, "notes": "<one line>" }`,
  ].join("\n");
}

const LENS_QUESTION = {
  "upstream-alignment":
    `Does the PR deliver the upstream change's intent? If fixStrategy is "essence-reimplement", judge alignment to the upstream INTENT / root cause (NOT diff-fidelity) — otto has diverged; refute only if it fails to resolve the documented root cause. For "direct-merge"/"adapted-port", judge fidelity to the upstream change. ABSTAIN if you genuinely cannot tell.`,
  "scope-discipline":
    `Is the diff scoped strictly to resolving this issue — no unrelated changes, scope creep, or out-of-target-file edits? Justified collateral is acceptable; refute meaningful out-of-scope modifications.`,
  "test-quality":
    `Do the tests genuinely pin the behavior the fix addresses (fail-before/pass-after), rather than being tautological, over-mocked, or asserting nothing? Refute if testing is inadequate to catch a regression.`,
  "blast-radius":
    `Could this change break unrelated behavior? Is the risk surface proportionate to the issue's severity? Refute if the change risks regressions disproportionate to its value.`,
};

export function lensPrompts(bundlePath, { prNumber, issueNumber }) {
  return LENS_NAMES.map((lens) => ({
    lens,
    prompt: [
      `You are the \`${lens}\` lens of a 4-lens refute panel reviewing PR #${prNumber} (closes issue #${issueNumber}).`,
      `Read the input bundle at \`${bundlePath}\` (fields: prTitle, prBody, prDiff, issueBody, upstreamSha, upstreamShow, fixStrategy, severity).`,
      ``,
      `Your question: ${LENS_QUESTION[lens]}`,
      ``,
      `Be adversarial but fair. Return ONLY this JSON as your entire final message (no prose, no fence):`,
      `{"lens":"${lens}","verdict":"approve"|"refute"|"abstain","confidence":0.0-1.0,"reason":"<=200 chars","blocking":true|false}`,
    ].join("\n"),
  }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-swarm/scripts/driver-core.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs
git commit -m "feat(driver-core): fix-lane + refute-lens prompt builders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: #6 — unattended pre-authorization (allowlist + auditable assertion)

**Files:**
- Modify: `.claude/settings.local.json`
- Modify: `driver-core.mjs` + `__tests__/driver-core.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { assertUnattendedAuthorized } from "../driver-core.mjs";

test("assertUnattendedAuthorized passes only with explicit pre-auth", () => {
  const r = assertUnattendedAuthorized({ unattended: true });
  assert.equal(r.authorized, true);
  assert.match(r.note, /gates .* remain the authorization/i);
  assert.throws(() => assertUnattendedAuthorized({ unattended: false }), /requires explicit --unattended/i);
  assert.throws(() => assertUnattendedAuthorized({}), /requires explicit --unattended/i);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: FAIL — `assertUnattendedAuthorized` not exported.

- [ ] **Step 3: Implement** (append to `driver-core.mjs`)

```js
export function assertUnattendedAuthorized({ unattended } = {}) {
  if (unattended !== true) {
    throw new Error("unattended merge requires explicit --unattended pre-authorization");
  }
  return { authorized: true, note: "unattended run pre-authorized; gates (two signals + refute approve + severity routing) remain the authorization" };
}
```

- [ ] **Step 4: Add the merge command to the permission allowlist**

Read `.claude/settings.local.json` (it has `permissions.allow` — an array; current sample entries include `"Edit(.claude/skills/**)"`, `"Bash(git push origin main)"`). Add, preserving all existing entries and matching the existing string style:
```
"Bash(node .claude/skills/upstream-swarm/scripts/swarm-control.mjs merge:*)"
```
Keep the file valid JSON.

- [ ] **Step 5: Run tests + verify settings JSON**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs`
Expected: PASS.
Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8')); console.log('settings valid')"`
Expected: `settings valid`.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/settings.local.json \
        .claude/skills/upstream-swarm/scripts/driver-core.mjs \
        .claude/skills/upstream-swarm/scripts/__tests__/driver-core.test.mjs
git commit -m "feat(driver-core): #6 unattended pre-authorization (allowlist + auditable assertion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Document the unattended path + Phase 2b in SKILL.md

**Files:**
- Modify: `.claude/skills/upstream-swarm/SKILL.md`

- [ ] **Step 1: Add an "Unattended run (Workflow driver)" subsection** after the existing Phase B section (do NOT remove the manual loop — it stays valid for supervised runs):

```markdown
## Unattended run (Workflow driver)

For a fully hands-off run, a Workflow driver loops `swarm-control` and fans out
fix lanes + refute panels as agents, calling the pure `driver-core.mjs` for
every decision (action bucketing, fix-lane / lens prompts, controller argv,
pre-auth). `driver-core` is unit-tested; its argv builders are verified through
`swarm-control`'s real `dispatch()`.

- **#6 pre-authorization:** the driver calls `driver-core.assertUnattendedAuthorized`
  — it refuses to proceed unless the run is launched with `unattended: true`, and
  logs an auditable authorization note. The `merge` command is on the
  `settings.local.json` allowlist so it does not prompt. **The locked invariants
  remain the real authorization** (two signals + refute `approve` + severity
  routing); the flag only signals that no human will click approve this run.
- **Severity routing unchanged:** `feature`/`critical-stability` still stop at
  `pending-human-review`; only `nice-to-have-fix` auto-merges.
- **The Workflow shell (`swarm-driver.mjs`) is built in Phase 2b** — an
  interactive build validated by a live dry-run + a supervised first run on a
  1–2 issue batch before trusting it on a large wave (the shell is not
  unit-testable; its decision logic lives in the tested `driver-core`). See the
  Phase 2 plan's Appendix for the reference scaffold.
```

- [ ] **Step 2: Verify**

Run: `grep -nE "Unattended run|driver-core|assertUnattendedAuthorized|Phase 2b" .claude/skills/upstream-swarm/SKILL.md`
Expected: matches for each.

- [ ] **Step 3: Commit**

```bash
git add -f .claude/skills/upstream-swarm/SKILL.md
git commit -m "docs(upstream-swarm): document unattended driver path + Phase 2b (#2/#6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full sweep

- [ ] **Step 1: Unit tests**

Run: `node --test .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs`
Expected: all PASS (Phases 1A/1B + new driver-core), exit 0.

- [ ] **Step 2: settings JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "test(driver-core): Phase 2a green sweep" || echo "nothing to commit"
```

---

## Appendix — Phase 2b reference scaffold (interactive build, NOT a task here)

This is the target shape of `.claude/skills/upstream-swarm/workflows/swarm-driver.mjs`, to be built interactively in Phase 2b with live Workflow dry-runs. It is reference, not a checkbox task — do not "implement" it under this plan. Key points the interactive build must resolve against the live runtime: how `core()`/`ctl()` agents return values (schema-validated objects), threading per-issue branch/targets from the ledger into `gateArgv`, and the start-fix → `verifyFixArgv` → `recordArgv`(fix-ok) / `classifyArgv`→`retryArgv` sequence.

```js
export const meta = {
  name: 'upstream-swarm-driver',
  description: 'Unattended driver: loops swarm-control (fix→CI→gate→refute→merge) with agent fan-out',
  phases: [{ title: 'Preflight' }, { title: 'Select' }, { title: 'Loop' }, { title: 'Report' }],
}
const CONTROL = '.claude/skills/upstream-swarm/scripts/swarm-control.mjs'
const CORE = '.claude/skills/upstream-swarm/scripts/driver-core.mjs'
const ctl = (argv, label) => agent(
  `Run EXACTLY from repo root, output ONLY stdout JSON:\nnode ${CONTROL} ${argv.map(a=>JSON.stringify(a)).join(' ')}`,
  { label: label ?? `ctl:${argv[0]}`, schema: { type: 'object', additionalProperties: true } })
const core = (fn, argJson, label) => agent(
  `Run EXACTLY, output ONLY stdout JSON:\nnode -e "import('./${CORE}').then(m=>process.stdout.write(JSON.stringify(m.${fn}(${argJson}))))"`,
  { label: label ?? `core:${fn}`, schema: { type: 'object', additionalProperties: true } })

phase('Preflight')
await core('assertUnattendedAuthorized', JSON.stringify({ unattended: args.unattended }))  // aborts unless pre-authorized
const pre = await ctl(['preflight','--workdir',`${args.dir}/.baseline`,'--log',`${args.dir}/${args.date}-baseline.log`])
if (!pre.ok) return { aborted: 'preflight', pre }
phase('Select')
await ctl(['select','--filter',JSON.stringify(args.filter ?? {label:'type:cherry-pick-candidate'}),'--out',`${args.dir}/${args.date}-selected.json`,'--ledger-out',args.ledger,'--date',args.date,'--max-wave-size','3'])
phase('Loop')
let guard = 0
while (guard++ < 500) {
  const { actions } = await ctl(['tick','--ledger',args.ledger,'--caps',args.caps])
  if (actions.length === 0) break
  const b = await core('bucketActions', JSON.stringify(actions))
  // 2b wiring: start-fix lanes (fixLanePrompt → agent → verifyFixArgv → recordArgv/classifyArgv),
  //            run-local-gate (gateArgv with branch+targets from ledger), poll, run-refute
  //            (buildInputBundle → lensPrompts → parallel agents → tally → recordArgv), merge (mergeArgv).
}
phase('Report')
await ctl(['report','--ledger',args.ledger,'--out',`${args.dir}/${args.date}-report.md`])
await ctl(['cleanup','--ttl-hours','24'])
return { ok: true }
```

---

## Self-Review Notes (author)

- **No placeholders in the TDD tasks:** Tasks 1–6 are complete, runnable, unit-tested. The Workflow shell — which genuinely cannot be unit-tested and needs live iteration — is explicitly carved out as Phase 2b with the scaffold in the Appendix (reference, not a checkbox task), so the plan does not pretend a subagent can TDD it.
- **CLI seam tested:** argv builders round-trip through `swarm-control` `dispatch()` (the Phase 1A bug class).
- **#6 reframed correctly:** allowlist entry + auditable `assertUnattendedAuthorized`; locked invariants unchanged.
- **Execution-handoff recommendation:** after 2a merges, build 2b interactively, and do a **supervised first live run** on a 1–2 issue batch before any large unattended wave.
- **Scope:** #5 and #7 are Phase 3.
