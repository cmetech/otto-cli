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

1. **Clean-main preflight.** Refuse to run if local `main` is ahead of
   `origin/main` — those unpushed commits would otherwise leak into every
   per-issue PR opened by the swarm:
   ```sh
   DATE=$(date +%F); DIR=.planning/upstream-swarms
   node .claude/skills/upstream-swarm/scripts/preflight-clean-main.mjs
   ```
   On `clean:false` (exit 2), STOP — print the printed `message` (which
   names the offending commit count + the recovery command) and exit
   non-zero. Resuming requires the operator to push, stash, or reset
   local main first.

2. **Baseline gate.** Run the full local gate against `origin/main`:
   ```sh
   node .claude/skills/upstream-swarm/scripts/baseline-gate.mjs \
     --workdir .worktrees/upstream-swarm-baseline \
     --log $DIR/$DATE-baseline-gate.log
   ```
   Read only the printed `{pass, failTail, logPath}`. If `pass:false`, STOP —
   write a baseline-rot report and exit non-zero. Resuming requires the
   baseline rot to be addressed.

3. **Select + partition.** Pull all open `status:triaged` cherry-pick
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

4. **Plan waves.** Greedy file-disjoint partitioning capped at
   `--max-wave-size`. **Note:** wave size only constrains the bundle
   passed into each fix lane; it does NOT cap how many lanes can run at
   once. Use `--fix-concurrency` for that (see Flags below).
   ```sh
   node .claude/skills/upstream-swarm/scripts/wave-plan.mjs \
     $DIR/$DATE-selected.json --max-wave-size 3 \
     --out $DIR/$DATE-waves.json
   ```

5. **Initialize the ledger** (skip on `--resume`):
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
   | `start-fix` | Transition `selected → planning` recording `fixStartedAt: <now ms>` (the per-issue timeout clock), then dispatch a subagent to run `upstream-fix --single-issue <N>`; on done record `fix-ok`/`fix-failed`. |
   | `quarantine-timeout` | The issue exceeded `issueTimeoutMs` in an active fix state (stuck lane). Transition it `→ quarantined` (reason from the action), free the lane, comment the issue with the timeout note, and feed the timeout into the abort-streak detector (step 4). |
   | `poll-ci-batch` | For each PR in `issueNumbers`, run `node poll-pr-checks.mjs <prNumber>` — ONE non-blocking HTTP poll each. The scheduler has already applied per-issue exponential backoff (it only lists PRs whose backoff interval has elapsed), so add no delay of your own. On a PR's `pass` → `ci-green`; on `fail` → classify, retry or quarantine; on `pending` → **no state transition**, but update that issue's ledger fields `lastPolledAt = <now ms>` and increment `pollNoChangeCount` so the next tick backs off. On any state change reset `pollNoChangeCount` to 0. **Never** `gh pr checks --watch`. |
   | `run-local-gate` | `trial-merge` + `run-gates.mjs full` in a worktree at origin/main. On pass → `local-gate-pending` (becomes refute-pending via state). |
   | `run-refute` | `buildInputBundle` then dispatch 4 lens subagents in parallel (Workflow `parallel(LENS_NAMES.map(lens => () => agent(prompt(lens, bundle), {schema: VERDICT_SCHEMA})))`); apply `tallyVerdicts`; record. The bundle carries `bundle.fixStrategy` from the issue's `fix-strategy:*` label — the `upstream-alignment` lens is strategy-aware (`essence-reimplement` judges intent/root-cause alignment, not diff-fidelity); see the full branch definition in `.claude/skills/upstream-merge/SKILL.md`. |
   | `merge-pr` | `merge-pr.mjs <N> --auto --refute-verdict approve --refute-reason "..."`. Severity routing for `feature`/`critical-stability` happens at fix-ok→pending-human-review (skip merge). |

3. On any failure, run `classifyFailure({stage, ...})` from
   `transient-classifier.mjs`. If `transient` and retryCount < 1, call
   `recordRetry(path, N, reason)` then transition to `retrying → fixing`.
   If `real`, transition to `quarantined`, post a comment on the issue
   with the failure log path, label `status:needs-human`.

   For `stage:"rebase"` the classifier needs `touchedFilesDisjoint` — compute it as
   *(our `targetFiles`) ∩ (files changed by the new origin/main commits) = ∅*. A
   transient rebase retry MUST **re-fetch `origin/main` and rebase the lane onto the
   new tip** — never replay the cached patch into the same conflicting region (a
   blind replay re-hits the identical conflict). If the touched files overlap the new
   commits the classifier returns `real`; quarantine for a manual rebase.

4. **Abort-streak detection.** On every `quarantined` event (including
   `quarantine-timeout`), compute a structured signature and record it:
   ```sh
   SIG=$(node .claude/skills/upstream-swarm/scripts/abort-streak.mjs signature \
     '{"stage":"<stage>","failTail":"<first lines of the gate log>"}')
   ```
   then call `recordQuarantineSignature(ledger, SIG, { threshold })` (threshold =
   `config.json.abortThreshold`, default 5). When it returns `{abort:true}` —
   `threshold` consecutive quarantines share the **same** root-cause signature —
   STOP: record a swarm-abort report, start no new fixes, exit non-zero. A
   *different* signature resets the streak. Recovery: resolve the root cause, then
   `node abort-streak.mjs reset <ledger>` (or `--reset-abort-counter`) and `--resume`.

## Phase C — Report + cleanup

1. Generate the rollup:
   ```sh
   node .claude/skills/upstream-swarm/scripts/write-report.mjs \
     $DIR/$DATE-run-state.json $DIR/$DATE-swarm-report.md
   ```

2. Worktree hygiene: remove every `.worktrees/upstream-fix-issue-*` and
   `.worktrees/upstream-merge-pr-*` directory on terminal-state. The
   The baseline worktree at `.worktrees/upstream-swarm-baseline` is removed on the
   gate's success path; on failure it is left for inspection but the next run (or
   `--resume`) force-removes it before re-creating, so a leaked baseline worktree
   no longer blocks a re-run. It is also tracked in the worktree registry, so
   `--clean-worktrees` prunes it by TTL.

3. Final exit: 0 if no issues quarantined; non-zero (with summary) if any
   are.

## Flags

- `--filter <expr>` — override default `--label type:cherry-pick-candidate`.
- `--fix-concurrency N` (default 3). Scheduler back-pressure: how many
  `start-fix` actions can be live at once. **This is the lever that
  serializes fix lanes** — pass `--fix-concurrency 1` for a supervised
  batch where you want one fix subagent to complete before the next
  starts. The scheduler reads this from the caps object; the orchestrator
  must include it when calling `scheduler.mjs`.
- `--pr-window N` (default 10). Cap on the number of issues simultaneously
  occupying any "open PR" state (`awaiting-ci`, `ci-green`, `local-gate-pending`,
  `refute-pending`, `approved`, `pending-human-review`, …). Prevents the
  swarm from drowning the merge queue.
- `--refute-concurrency N` (default 5). Cap on parallel refute panels
  (each panel itself fans out to 4 lens subagents).
- `--max-wave-size N` (default 3). Feeds **only** `wave-plan.mjs`'s
  file-disjoint partitioning — it caps how many issues go in one wave's
  fix bundle. It does **NOT** bind the scheduler. Lowering it to 1 will
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
# Caps passed to scheduler.mjs on every tick (3rd arg = Date.now()):
'{"fixConcurrency":1,"prWindow":10,"refuteConcurrency":5,"maxWaveSize":1,"issueTimeoutMs":1800000,"basePollMs":60000,"maxPollMs":480000,"pollBackoffAfter":1}'
```

`fixConcurrency:1` is the load-bearing knob. `maxWaveSize:1` is harmless
but doesn't substitute for it. The other caps stay at default so PRs in
`awaiting-ci` / `refute-pending` / `approved` continue to make progress.
The scheduler also receives the current wall-clock time as a 3rd argument
(`Date.now()`) — the CLI injects this so `issueTimeoutMs`/`basePollMs`/
`maxPollMs`/`pollBackoffAfter` can be applied correctly on each tick.

## References

- Design spec: `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-05-upstream-swarm.md`
- Companions: `.claude/skills/upstream-fix/SKILL.md`,
  `.claude/skills/upstream-merge/SKILL.md`,
  `.claude/skills/upstream-cherry-pick/SKILL.md`.
