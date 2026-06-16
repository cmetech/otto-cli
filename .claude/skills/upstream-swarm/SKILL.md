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

- "Run the swarm." / "Run a larger wave." / "Auto-port the triaged fixes." / "Port all the triaged issues."
- `/upstream-swarm`, `/upstream-swarm --dry-run`, `/upstream-swarm --resume`.

## Two ways to run (pick the right one)

1. **Unattended driver (DEFAULT for "run the swarm" / "run a larger wave").** Launch
   the tested `swarm-driver.mjs` Workflow — it loops the controller and fans out fix
   lanes + refute panels for you. This is the hands-off path; use it unless the
   operator explicitly wants to drive ticks by hand. **See "Unattended run (Workflow
   driver)" below — that section, not Phase A/B/C, is the entry point.** Validated
   end-to-end on a supervised live run (2026-06-16).
2. **Manual agentic loop (supervised / interactive).** You orchestrate Phase A → B →
   C tick-by-tick in the conversation. Use when the operator wants to watch and
   intervene at each step, or to debug the controller. Phases A/B/C document this.

**Resolve missing inputs before launching (both modes).** A human rarely supplies
every parameter. For each input the operator did NOT specify, ask with
`AskUserQuestion`, leading with the recommended option (see the parameter table in
"Unattended run"). Never silently guess **scope** (which issues / filter) or
**merge authorization** — confirm those. Sensible knobs (caps, timeout) may default
without asking, but state what you used.

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

1. **Pre-flight (clean-main + baseline gate).** Refuse to run if local
   `main` is ahead of `origin/main` (those unpushed commits would
   otherwise leak into every per-issue PR opened by the swarm), then run
   the full local gate against `origin/main`. Both checks run in one
   subcommand:
   ```sh
   DATE=$(date +%F); DIR=.planning/upstream-swarms
   node .claude/skills/upstream-swarm/scripts/swarm-control.mjs preflight \
     --workdir .worktrees/upstream-swarm-baseline \
     --log $DIR/$DATE-baseline-gate.log
   ```
   Read only the returned `{clean, cleanMessage, baseline:{pass, failTail,
   logPath}, ok}`. On `clean:false`, STOP — print `cleanMessage` (which
   names the offending commit count + the recovery command) and exit
   non-zero; resuming requires the operator to push, stash, or reset local
   main first. On `baseline.pass:false`, STOP — write a baseline-rot
   report and exit non-zero; resuming requires the baseline rot to be
   addressed. Pass `--skip-baseline` only for the documented RARE opt-out
   (see `--skip-baseline-gate` in Flags); it sets `baseline:null` and
   computes `ok` from `clean` alone.

3. **Select + partition + plan waves + initialize the ledger** (skip on
   `--resume`). One subcommand selects all open `status:triaged`
   cherry-pick candidates, splits them into auto-tier
   (`severity:nice-to-have-fix`) and human-tier (`severity:feature`,
   `severity:critical-stability`), greedily partitions them into
   file-disjoint waves capped at `--max-wave-size`, and writes the ledger:
   ```sh
   node .claude/skills/upstream-swarm/scripts/swarm-control.mjs select \
     --filter '{"label":"type:cherry-pick-candidate"}' \
     --out $DIR/$DATE-selected.json \
     --ledger-out $DIR/$DATE-run-state.json \
     --date $DATE \
     --max-wave-size 3
   ```
   Read `{totalAuto, totalHuman, totalNeedsTriage, waveCount, ledger}`.
   Issues in `needsTriage` are skipped with a comment; human-tier issues
   will skip Phase B–C and go straight to "pending-human-review" after
   fix opens the PR. **Note:** `--max-wave-size` only constrains the
   bundle passed into each fix lane; it does NOT cap how many lanes can
   run at once. Use `--fix-concurrency` for that (see Flags below).

## Phase B — Scheduler loop (pipelined, agentic)

Loop until `nextActions(ledger, caps)` returns `[]`:

1. Call the scheduler to get this tick's actions:
   ```sh
   node .claude/skills/upstream-swarm/scripts/swarm-control.mjs tick \
     --ledger $DIR/$DATE-run-state.json \
     --caps "$(cat .claude/skills/upstream-swarm/config.json | jq -c .defaultCaps)"
   ```
   `tick` is a pure planner — it reads the ledger and returns
   `{actions}` (the work list); it makes no state changes. The CLI injects
   the current wall-clock time, so `issueTimeoutMs`/`basePollMs`/
   `maxPollMs`/`pollBackoffAfter` apply correctly each tick.

2. For each action, dispatch the right sub-skill / subagent:

   | Action kind | What to run |
   |---|---|
   | `start-fix` | Transition `selected → planning` recording `fixStartedAt: <now ms>` (the per-issue timeout clock), then dispatch a subagent to run `upstream-fix --single-issue <N>`. **On "done", do NOT trust the subagent's text — verify durable artifacts before recording `fix-ok`** (subagents can emit a premature "completed" signal or die mid-gate; only the PR + pushed branch are ground truth): the PR is OPEN (`gh pr view <pr>`), its head branch is pushed (`git ls-remote --heads origin <branch>`), and the diff is scoped to the issue's target files (`gh pr diff <pr> --name-only`). Record `fix-ok` (with `prNumber`/`prUrl`) only when all three hold; otherwise treat as `fix-failed` and classify. **Never run a gate inside a lane's live worktree** (`.worktrees/upstream-fix-issue-<N>`) — a concurrent compile/`dist-test` in the same dir corrupts both runs (observed 2026-06-15: 340 spurious failures); the swarm's own gates (`run-local-gate`) always use a *fresh* origin/main worktree, one operation per worktree. |
   | `quarantine-timeout` | The issue exceeded `issueTimeoutMs` in an active fix state (stuck lane). Transition it `→ quarantined` (reason from the action), free the lane, comment the issue with the timeout note, and feed the timeout into the abort-streak detector (step 4). |
   | `poll-ci-batch` | For each PR in `issueNumbers`, run `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs poll --pr <prNumber>` — ONE non-blocking HTTP poll each. The scheduler has already applied per-issue exponential backoff (it only lists PRs whose backoff interval has elapsed), so add no delay of your own. On a PR's `pass` → `ci-green`; on `fail` → classify, retry or quarantine; on `pending` → **no state transition**, but update that issue's ledger fields `lastPolledAt = <now ms>` and increment `pollNoChangeCount` so the next tick backs off. On any state change reset `pollNoChangeCount` to 0. **Never** `gh pr checks --watch`. |
   | `run-local-gate` | Run `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs gate --pr <prNumber> --head-ref <branch> --targets <csv> --log-dir <DIR>/<DATE>-gate-logs`. This trial-merges onto origin/main in a fresh worktree and runs the `full` suite **in-process** (result captured as a return value, never parsed from stdout), with a single isolated re-run that distinguishes a load-induced flake (`verdict:"flake"` → treat as pass) from a real break (`verdict:"real"` → classify + quarantine). Read only the returned `{pass, verdict, failTail}`. On `pass` (verdict `pass` or `flake`) → `local-gate-pending`. On `verdict:"real"` or `"conflict"` → classify, retry or quarantine. The controller serializes gates (one full-suite at a time); never run a gate inside a lane's live worktree. |
   | `run-refute` | `buildInputBundle` then dispatch 4 lens subagents in parallel (Workflow `parallel(LENS_NAMES.map(lens => () => agent(prompt(lens, bundle), {schema: VERDICT_SCHEMA})))`); apply `tallyVerdicts`; record. The bundle carries `bundle.fixStrategy` from the issue's `fix-strategy:*` label — the `upstream-alignment` lens is strategy-aware (`essence-reimplement` judges intent/root-cause alignment, not diff-fidelity); see the full branch definition in `.claude/skills/upstream-merge/SKILL.md`. |
   | `merge-pr` | Run `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs merge --pr <prNumber> --issue <N> --ledger $DIR/$DATE-run-state.json --refute-reason "..."`. The subcommand reads the recorded panel verdict from the ledger itself and refuses to merge unless it is exactly `"approve"` (returning `{merged:false, blockedBy:"refute"}` otherwise) — this read-back means an out-of-band merge can't supply `approve` without the panel having recorded it (the state machine still gates merge on the `approved` state; this is defense-in-depth). On approve it squash-merges under `--auto`. Severity routing for `feature`/`critical-stability` happens at fix-ok→pending-human-review (skip merge). |

3. On any failure, classify it with
   `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs classify --stage <stage> --fail-tail "<first lines of the gate log>"`
   (returns `{category, reason, signature}`). If `category:"transient"`
   and retryCount < 1, run
   `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs retry --ledger $DIR/$DATE-run-state.json --issue <N> --reason "<reason>"`
   then transition `retrying → fixing`. If `real`, transition to
   `quarantined` (via `swarm-control.mjs record --ledger … --issue <N>
   --state quarantined --payload '<json>'`), post a comment on the issue
   with the failure log path, label `status:needs-human`.

   For `stage:"rebase"` the classifier needs `touchedFilesDisjoint` — compute it as
   *(our `targetFiles`) ∩ (files changed by the new origin/main commits) = ∅*. A
   transient rebase retry MUST **re-fetch `origin/main` and rebase the lane onto the
   new tip** — never replay the cached patch into the same conflicting region (a
   blind replay re-hits the identical conflict). If the touched files overlap the new
   commits the classifier returns `real`; quarantine for a manual rebase.

4. **Abort-streak detection.** On every `quarantined` event (including
   `quarantine-timeout`), use the structured `signature` returned by the
   `classify` call in step 3 (or recompute it via `classify`), then feed
   it to the abort-streak detector:
   ```sh
   node .claude/skills/upstream-swarm/scripts/swarm-control.mjs abort-check \
     --ledger $DIR/$DATE-run-state.json \
     --signature "$SIG" \
     --threshold 5
   ```
   (threshold = `config.json.abortThreshold`, default 5). When it returns
   `{abort:true}` — `threshold` consecutive quarantines share the **same**
   root-cause signature — STOP: record a swarm-abort report, start no new
   fixes, exit non-zero. A *different* signature resets the streak.
   Recovery: resolve the root cause, then
   `node abort-streak.mjs reset <ledger>` (or `--reset-abort-counter`) and
   `--resume`.

## Unattended run (Workflow driver) — DEFAULT entry for "run the swarm"

The hands-off path: launch the tested `swarm-driver.mjs` Workflow, which loops
`swarm-control` and fans out fix lanes + refute panels as agents, calling the pure
unit-tested `driver-core.mjs` for every decision. Validated end-to-end on a
supervised live run (2026-06-16). Run these steps in order.

### Step 0 — Resolve run parameters (ASK for anything not given)

For each input the operator did not specify, ask with `AskUserQuestion`, leading
with the recommended option. **Never silently guess scope or merge authorization.**

| Parameter | Recommended default | When to ask |
|---|---|---|
| **Scope / selection** | A **curated batch** of ~8–12 `nice-to-have-fix` issues that are small, **file-disjoint** across the set (lanes run in parallel), and have **no open prerequisite**. | ALWAYS surface the concrete issue list and get an explicit OK before seeding/launching. For a first/large run prefer curated over full-backlog. |
| **Severity tier** | `nice-to-have-fix` only (these auto-merge; `feature`/`critical-stability` stop at `pending-human-review`). | Ask if the operator implied a broader port. |
| **fixConcurrency** | `3` | Ask only if they hinted at a supervised/sequential run → then `1`. |
| **issueTimeoutMs** | `2700000` (45 min) — **arms the hung-lane breaker.** Always include it in caps. | No; state the value you used. |
| **Dry-run first** | For a large/unfamiliar batch, offer a `dryRun:true` Phase-A preview (one plan tick, no PRs) before the real run. | Ask for large batches. |

Default caps to pass (merge the resolved knobs in):
`{"fixConcurrency":3,"prWindow":10,"refuteConcurrency":5,"issueTimeoutMs":2700000,"basePollMs":60000,"maxPollMs":480000,"pollBackoffAfter":1}`

### Step 1 — Preflight + authorization

- Run `node .claude/skills/upstream-swarm/scripts/preflight-clean-main.mjs`; it must
  be `clean:true` (local main == origin). If ahead, **STOP** and ask the operator
  before pushing — unpushed commits leak into every PR.
- Confirm the **#6 merge opt-in**: grep `.claude/settings.local.json` for
  `swarm-control.mjs merge:*`. If absent, autonomous merges will not proceed — tell
  the operator and offer to add it (per-operator, **gitignored, never commit** this
  grant). The locked invariants remain the real authorization (two signals + refute
  `approve` + severity routing); `assertUnattendedAuthorized` requires `unattended:true`.

### Step 2 — Seed (curated) or let the driver select

- **Curated batch (recommended):** seed a ledger with exactly the agreed issues —
  `swarm-control select --filter '{"issues":["N1","N2",...]}' --out <DIR>/<DATE>-selected.json
  --ledger-out <DIR>/<DATE>-run-state.json --date <DATE>` — then launch with
  `skipSelect:true`. Verify the ledger holds those issues (`state:selected`, sha +
  targetFiles set).
- **Full filtered backlog:** launch WITHOUT `skipSelect` and pass `filter` in args; the
  driver runs `select` (waved by `maxWaveSize`, bounded by `prWindow`). Use only when
  the operator explicitly asks for the whole backlog — it can be 100+ issues.

### Step 3 — Launch the driver

Use the **Workflow tool**, `scriptPath` =
`.claude/skills/upstream-swarm/workflows/swarm-driver.mjs`, args =
`{ ledger:<path>, caps:"<json string from Step 0>", dir:".planning/upstream-swarms",
   date:"<YYYY-MM-DD>", unattended:true, dryRun:<bool>, skipSelect:<bool>, maxTicks:50 }`.
Watch with `/workflows`; narrate ticks; **be ready to `TaskStop`** (the timeout
breaker is armed via `issueTimeoutMs`, but watch anyway).

### Step 4 — Drain passes (the CI tail)

One invocation **drains-on-empty between backoff-gated CI polls**, so it returns with
lanes still in `awaiting-ci` — that's expected, not a failure. Wait for those PRs'
required checks to go green (`swarm-control poll --pr <n>`; the `triage` check is
informational and is ignored), then **re-invoke the SAME driver with
`skipSelect:true, skipPreflight:true`** (the ledger persists) to push them through
`ci-green → gate → refute → merge`. Repeat until every issue is `merged` or
`quarantined`. A real many-in-flight wave keeps the loop busy and drains in fewer passes.

### Step 5 — Report

`swarm-control report` + `cleanup` (Phase C). Summarize merges and quarantines
(refute reasons live in the ledger); a refute-quarantine is the gate working, not a bug.

> Runbook companion (verbose, copy-paste commands): `.planning/upstream-swarms/2026-06-16-larger-wave-handoff.md`.

## Phase C — Report + cleanup

1. Generate the rollup:
   ```sh
   node .claude/skills/upstream-swarm/scripts/swarm-control.mjs report \
     --ledger $DIR/$DATE-run-state.json \
     --out $DIR/$DATE-swarm-report.md
   ```

2. Worktree hygiene: remove every `.worktrees/upstream-fix-issue-*` and
   `.worktrees/upstream-merge-pr-*` directory on terminal-state. Prune any
   leaked worktrees tracked in the registry by TTL:
   ```sh
   node .claude/skills/upstream-swarm/scripts/swarm-control.mjs cleanup --ttl-hours 24
   ```
   The baseline worktree at `.worktrees/upstream-swarm-baseline` is removed on the
   gate's success path; on failure it is left for inspection but the next run (or
   `--resume`) force-removes it before re-creating, so a leaked baseline worktree
   no longer blocks a re-run. It is also tracked in the worktree registry, so
   `cleanup` (or the `--clean-worktrees` flag) prunes it by TTL.

3. Final exit: 0 if no issues quarantined; non-zero (with summary) if any
   are.

## Flags

- `--filter <expr>` — override default `--label type:cherry-pick-candidate`.
- `--fix-concurrency N` (default 3). Scheduler back-pressure: how many
  `start-fix` actions can be live at once. **This is the lever that
  serializes fix lanes** — pass `--fix-concurrency 1` for a supervised
  batch where you want one fix subagent to complete before the next
  starts. The scheduler reads this from the caps object; the orchestrator
  must include it in the `--caps` passed to `swarm-control.mjs tick`.
- `--pr-window N` (default 10). Cap on the number of issues simultaneously
  occupying any "open PR" state (`awaiting-ci`, `ci-green`, `local-gate-pending`,
  `refute-pending`, `approved`, `pending-human-review`, …). Prevents the
  swarm from drowning the merge queue.
- `--refute-concurrency N` (default 5). Cap on parallel refute panels
  (each panel itself fans out to 4 lens subagents).
- `--max-wave-size N` (default 3). Feeds **only** the `select`
  subcommand's file-disjoint wave partitioning — it caps how many issues
  go in one wave's fix bundle. It does **NOT** bind the scheduler. Lowering it to 1 will
  not force sequential fix lanes; use `--fix-concurrency 1` for that.
- `--issue-timeout <ms>` (default 1800000 = 30 min). Per-issue wall-clock budget
  for active fix states (`planning`/`fixing`/`retrying`); on breach the issue is
  quarantined and its lane freed. Passed to the scheduler as `caps.issueTimeoutMs`.
- `--reset-abort-counter` — clear the abort-streak counter
  (`node abort-streak.mjs reset <ledger>`) before resuming, after a human has
  resolved the recurring root cause.
- `--dry-run` — Phase A only; opens no PRs.
- `--skip-baseline-gate` — explicit opt-out (RARE; documented).
- `--resume` — re-enter Phase B from the existing ledger.

### Supervised batch (worked example)

A supervised run that processes ten specific issues one fix at a time,
while still pipelining CI / refute / merge stages freely:

```sh
# Caps passed as --caps to `swarm-control.mjs tick` on every tick:
'{"fixConcurrency":1,"prWindow":10,"refuteConcurrency":5,"maxWaveSize":1,"issueTimeoutMs":1800000,"basePollMs":60000,"maxPollMs":480000,"pollBackoffAfter":1}'
```

`fixConcurrency:1` is the load-bearing knob. `maxWaveSize:1` is harmless
but doesn't substitute for it. The other caps stay at default so PRs in
`awaiting-ci` / `refute-pending` / `approved` continue to make progress.
`tick` injects the current wall-clock time for you, so
`issueTimeoutMs`/`basePollMs`/`maxPollMs`/`pollBackoffAfter` are applied
correctly on each tick.

## References

- Design spec: `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-05-upstream-swarm.md`
- Companions: `.claude/skills/upstream-fix/SKILL.md`,
  `.claude/skills/upstream-merge/SKILL.md`,
  `.claude/skills/upstream-cherry-pick/SKILL.md`.
