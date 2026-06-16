# Upstream-Port Pipeline — Reliability + Autonomy Redesign

**Date:** 2026-06-16
**Status:** Design approved; ready for implementation planning
**Affects:** `.claude/skills/upstream-fix`, `.claude/skills/upstream-merge`,
`.claude/skills/upstream-swarm`, `.claude/skills/_common`
**Related:** `2026-06-05-upstream-swarm-design.md`,
`2026-06-13-upstream-pipeline-hardening-design.md`

## Motivation

After several controlled runs (the critical-stability dogfood, wave1 3/3, and
wave2 8/12-merged + 4-quarantined), the same structural failure modes recur.
This redesign addresses the seven highest-leverage ones, grounded in observed
evidence from those runs.

The two dominant problems:

1. **The full test suite runs twice per issue, and the in-lane run kills
   subagents.** Each fix lane self-gates by running the full suite *inside the
   lane subagent*, then the swarm runs the full suite *again* in its local
   gate. The in-lane suite is long and token-heavy; in wave2 it caused 3/3
   premature subagent deaths (#88, #98, #138-inner) — the agent exhausted its
   turn budget mid-suite and emitted a fake "done" before push/PR.

2. **The orchestration is a runbook executed by hand, not a program.** The
   wave2 run was driven by dozens of inline `node -e` ledger transitions,
   hand-built refute bundles, hand-sequenced background gates, and manual
   monitors. This is the source of operator bugs (a `cwd` breakage, a
   gate-stdout JSON-parse that falsely reported `pass:false`) and is the core
   autonomy gap: "autonomous" today means *the operator being diligent*, not a
   driver that runs unattended.

## Goals

- **Reliability:** eliminate the subagent-death spiral; make gate execution and
  failure-classification deterministic and load-safe; close the
  premature-completion hole by construction.
- **Autonomy:** a **fully unattended** run — launch and walk away. The pipeline
  runs fix → CI → gate → refute → merge on its own, auto-merges everything that
  passes all gates, and only surfaces to a human on abort-streak or to leave
  quarantined issues for later.

## Non-goals

- No change to the locked safety invariants (two green signals + refute approve
  before any merge; never auto-merge `severity:feature` /
  `severity:critical-stability`; 1 retry cap; mandatory baseline gate; worktree
  cleanup on every terminal state).
- No change to the `swarm-ledger` state machine or its states/transitions.
- The cherry-pick/triage stage is **not** modified in this spec (see #7).

## Operating-mode decision

Target operating mode: **fully unattended.** Consequence: a plain Node process
cannot spawn Claude subagents, so the driver must be a mechanism that can — a
**Workflow run** (chosen) rather than a Node daemon. See Architecture.

---

## Architecture

Two layers over the existing `_common` scripts:

```
┌─ Workflow driver (autonomous, background) ───────────────┐
│  loop: tick → fan-out agents → record → execute → report  │
└──────────────────────┬───────────────────────────────────┘
                       │ shells out to
┌──────────────────────▼───────────────────────────────────┐
│  swarm-control.mjs  (deterministic spine, pure + tested)  │
│  preflight · select · plan · tick · gate · verify-fix ·    │
│  classify · record · merge · report · cleanup              │
└──────────────────────┬───────────────────────────────────┘
                       │ reuses
        _common: run-gates · base-ledger · worktree · alignment …
```

- **Spine (`swarm-control.mjs`):** a new Node CLI that absorbs every
  deterministic step currently hand-run, as tested subcommands. It is the only
  writer of the ledger. Shared by the Workflow driver **and** standalone
  `upstream-fix`. This is the reliability win on its own.
- **Workflow driver:** the unattended brain. Its loop decides only *what agents
  to fan out* each tick; all mechanical work is delegated to the spine. Runs in
  the background, resumable via the Workflow journal *and* the durable ledger.

Rationale for the split: the Workflow script sandbox has no filesystem/shell
access in its body, so all disk/shell/git/gh work lives in the spine (a normal
Node process invoked via a bash step). The Workflow layer provides exactly what
a Node daemon cannot: native `agent()` fan-out for the agentic work.

---

## #1 — Full suite out of the fix lane

| | Fix-lane subagent does | Full suite runs |
|---|---|---|
| **Today** | fix + regression + build + targeted + **full suite** + reviewer + push + PR | inside every lane (kills subagents) **and** again in the swarm gate |
| **New** | fix + regression + build + targeted + reviewer + push + PR | **once**, in the controller |

- **Swarm mode:** the full suite runs once in the controller's `gate` subcommand
  (trial-merge worktree at `origin/main`), exactly as the swarm local gate does
  today.
- **Standalone `upstream-fix` mode:** the controller runs the full suite **once
  on the integrated PR branch** (after all accepted lanes merge into the
  integration branch), in a controlled worktree — never inside a lane subagent.
  This preserves the local pre-PR full-suite safety net while running it once.

The lane subagent's work becomes fast and in-budget; the multi-minute suite no
longer exhausts its turn. This kills the dominant failure mode and halves
per-issue compute.

**Skill change:** `upstream-fix` SKILL §79-88 ("Gate completion (no premature
exit)" — the mandate that the lane run the full suite in-process before PR) is
rewritten to: *the lane runs regression + build + targeted + reviewer; the
integration/swarm gate owns the full suite.* The `--single-issue` lane contract
loses the full-suite step.

---

## #2 — Consolidated controller + Workflow driver

### `swarm-control.mjs` subcommands

Each subcommand is pure-ish (JSON in / JSON out), unit-tested, with the ledger
as the only shared state. Injectable `gh` / `git` / `run-gates` runners for
testability (the pattern `refute-panel.mjs` already uses).

| Subcommand | Responsibility |
|---|---|
| `preflight` | clean-main check + baseline gate + abort-counter check |
| `select` / `plan` | select issues, partition tiers, dependency-aware wave plan (#7), init ledger |
| `tick` | advance every deterministic transition it can, then return the work items needed this tick: `{ fixes[], refutes[]` (agentic — model fans these out), `gates[], merges[]` (heavy-deterministic — run via the controller), `done }` |
| `gate <pr>` | trial-merge + full suite in fresh worktree; flake re-run + hardened capture (#3) |
| `verify-fix <issue> <pr> <branch>` | PR-open + branch-pushed + diff-scoped check (#4) |
| `classify <ctx>` | transient-vs-real (existing classifier) + abort-streak signature |
| `record <kind> <payload>` | apply one validated ledger transition (fix-ok, refute verdict, merged, quarantine) |
| `merge <pr>` | read verdict, gate on approve, squash-merge, record sha, cleanup worktree (#6 pre-auth flag) |
| `report` / `cleanup` | rollup report + worktree hygiene |

### Workflow driver loop

```js
controller('preflight'); controller('select --plan')          // Phase A, deterministic
while (true) {
  const { fixes, refutes, gates, merges, done } = controller('tick')
  if (done) break
  await parallel(fixes.map(f => () => agent(fixLanePrompt(f))   // #1: lane = fast work only
    .then(r => controller('verify-fix', r) && controller('record fix-ok', r))))
  await pipeline(refutes, r => panel(r), v => controller('record refute', v))  // 4-lens fan-out
  gates.forEach(g => controller('gate', g))                    // heavy suite, controller-owned, serialized
  merges.forEach(m => controller('merge', m))                  // gated on approve + pre-auth
}
controller('report'); controller('cleanup')
```

Every non-`agent(...)` box is a deterministic CLI call. The model writes only
fix code and refute verdicts. The state machine is unchanged; the controller
simply becomes its **sole writer**, so illegal transitions cannot occur via a
mistyped inline script.

### Unattended launch path

cron / `/schedule` → a thin Claude session whose only job is to invoke
`Workflow(swarm-driver)` and exit → the Workflow runs in the background to
completion and notifies on done. The session is not the driver; the Workflow is.

---

## #3 — Deterministic gate runner

Inside `gate <pr>`:

1. Trial-merge the PR branch onto current `origin/main` in a fresh worktree.
2. Run `run-gates full`; **capture the result from a result-JSON file plus the
   process exit code (0 = pass, 2 = fail). Never shell-parse stdout** — stderr
   noise corrupted the capture in wave2 and produced a false `pass:false`.
3. On fail: compute the failing-test set. If it is **disjoint from the PR's
   changed files AND a single isolated re-run passes**, mark transient (flake),
   record, and proceed. Otherwise real → quarantine.
4. The controller serializes to **one full-suite at a time** globally. Trivial
   now that lanes run no suite, so nothing overlaps a gate (the wave2
   load-flake cause for #108/#114).

This encodes the manual reasoning the operator did for #108/#114.

## #4 — Structural artifact verification

`verify-fix <issue> <pr> <branch>` checks: PR is OPEN, branch is pushed
(`git ls-remote`), diff ⊆ declared target files. **Justified collateral files**
(e.g. #88's `worktree-lifecycle.ts`, #111's `agent-session.ts`) do not hard-fail
— they are recorded as scope-expansion notes passed to the refute
scope-discipline lens, which already judges them correctly. The controller
**refuses `record fix-ok` unless `verify-fix` passes**, closing the
premature-signal hole by construction rather than by operator discipline.

## #5 — Known-flaky allowlist

A curated `flaky-tests.json` (initially the `headless --output-format` and
`gsd --list-models` offenders) that the gate runner auto-retries *individually*
once before counting them as failures. Distinct from #3: #5 is a curated list
for known offenders; #3 is the general disjoint-rerun heuristic. Both feed the
same real-vs-flake verdict. Any silently-dropped/known-flaky retry is logged.

## #6 — Unattended merge pre-authorization

A run-scoped `--unattended` (a.k.a. `--pre-authorized`) flag the launcher sets,
threaded by the controller to `merge`. **The gates remain the real
authorization** (two green signals + refute `approve`); the flag only signals
the auto-mode classifier that no human will click approve — the gates *are* the
approval. All locked invariants are unchanged (never auto-merge
`feature`/`critical-stability`; never merge without an `approve` verdict). Every
auto-merge is logged prominently. Without the flag, behavior is unchanged
(merge requires the human gate).

## #7 — Dependency-aware selection

The wave planner topologically **defers any issue whose prerequisite is still
OPEN** (not merged), skipping-with-reason in Phase A instead of dispatching a
lane that will discover the block and quarantine (wave2 #94, blocked on the
unported #134, would have been deferred up front).

**Dependency source (decision):** parse the issue's guidance file / body for an
explicit `depends-on:#N` or `prerequisite: #N` marker **now** — no new skill
dependency. Optionally, later, the cherry-pick triage stage can emit a
`depends-on:` label as an accelerator; that label-emission is intentionally
**out of scope** for this spec to avoid pulling in the `upstream-cherry-pick`
skill.

---

## Error handling & resumability

- The ledger remains the durable source of truth; the controller is its sole
  writer with transition validation.
- Resumability is doubled: the ledger (as today) plus the Workflow journal — a
  killed run resumes from the last unchanged `agent()` call.
- Abort-streak detection is unchanged: `threshold` consecutive same-signature
  quarantines abort the run.
- A failing controller subcommand surfaces as a structured error the driver
  records (retry-or-quarantine per `classify`), never a silent stall.

## Testing strategy

- **Unit:** each `swarm-control.mjs` subcommand tested over ledger fixtures with
  injectable `gh` / `git` / `run-gates` runners (mirrors `refute-panel.mjs`'s
  `ghRunner`/`gitRunner` seams).
- **Integration:** one dry-run that drives a full pipeline over fixtures,
  extending the existing
  `upstream-swarm/scripts/__tests__/integration/full-suite.test.mjs`.
- **Driver:** the Workflow loop tested against a fixture controller (stubbed
  subcommands) to assert the fan-out/record/execute ordering.

## Migration / rollout

Old scripts remain until the spine reaches parity, then are deprecated. The
swarm SKILL.md and `upstream-fix` SKILL.md are rewritten to call
`swarm-control.mjs` subcommands instead of the inline runbook.

## Phasing

- **Phase 1 (start here):** build `swarm-control.mjs` (the spine) + the #1
  lane/gate full-suite split. Includes **#3** (`gate`) and **#4** (`verify-fix`)
  since they are naturally controller subcommands. Standalone `upstream-fix`
  adopts the spine. This front-loads the reliability wins.
- **Phase 2:** the Workflow-script driver (#2's autonomous driver) + **#6**
  unattended-merge pre-auth (required for hands-off merging).
- **Phase 3:** **#5** known-flaky allowlist + **#7** dependency-aware selection.

## Evidence index (wave2, 2026-06-15)

- Subagent mid-gate deaths: #88, #98, #138-inner → motivates #1, #4.
- Load-induced gate flakes (unrelated `headless`/`list-models` tests): #108,
  #114 → motivates #3, #5.
- Operator harness bugs: `cwd` breakage, gate-stdout JSON-parse false-negative →
  motivates #2, #3.
- Refute panel caught a real coverage gap: #111 (untested race-critical
  `bindCore` hunk) → validates keeping the 4-lens panel.
- Prerequisite discovered in-lane instead of up front: #94 (blocked on #134) →
  motivates #7.
