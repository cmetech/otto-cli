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

1. **Baseline gate.** Run the full local gate against `origin/main`:
   ```sh
   DATE=$(date +%F); DIR=.planning/upstream-swarms
   node .claude/skills/upstream-swarm/scripts/baseline-gate.mjs \
     --workdir .worktrees/upstream-swarm-baseline \
     --log $DIR/$DATE-baseline-gate.log
   ```
   Read only the printed `{pass, failTail, logPath}`. If `pass:false`, STOP —
   write a baseline-rot report and exit non-zero. Resuming requires the
   baseline rot to be addressed.

2. **Select + partition.** Pull all open `status:triaged` cherry-pick
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

3. **Plan waves.** Greedy file-disjoint partitioning capped at `--max-wave-size`:
   ```sh
   node .claude/skills/upstream-swarm/scripts/wave-plan.mjs \
     $DIR/$DATE-selected.json --max-wave-size 3 \
     --out $DIR/$DATE-waves.json
   ```

4. **Initialize the ledger** (skip on `--resume`):
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
   | `start-fix` | Dispatch a subagent to run `upstream-fix --single-issue <N>`; on done record `fix-ok`/`fix-failed`. |
   | `poll-ci` | `gh pr checks <prNumber> --json name,bucket`; on all required green → `ci-green`; on red → classify, retry or quarantine. |
   | `run-local-gate` | `trial-merge` + `run-gates.mjs full` in a worktree at origin/main. On pass → `local-gate-pending` (becomes refute-pending via state). |
   | `run-refute` | `buildInputBundle` then dispatch 4 lens subagents in parallel (Workflow `parallel(LENS_NAMES.map(lens => () => agent(prompt(lens, bundle), {schema: VERDICT_SCHEMA})))`); apply `tallyVerdicts`; record. |
   | `merge-pr` | `merge-pr.mjs <N> --auto --refute-verdict approve --refute-reason "..."`. Severity routing for `feature`/`critical-stability` happens at fix-ok→pending-human-review (skip merge). |

3. On any failure, run `classifyFailure({stage, ...})` from
   `transient-classifier.mjs`. If `transient` and retryCount < 1, call
   `recordRetry(path, N, reason)` then transition to `retrying → fixing`.
   If `real`, transition to `quarantined`, post a comment on the issue
   with the failure log path, label `status:needs-human`.

4. Track an `abortStreak` counter. If 5 consecutive `quarantined` events
   share the same root-cause signature (e.g. same failTail prefix),
   STOP — record a swarm-abort report, do not start any new fixes,
   exit non-zero. Resume requires `--resume` and a human-resolved root
   cause.

## Phase C — Report + cleanup

1. Generate the rollup:
   ```sh
   node .claude/skills/upstream-swarm/scripts/write-report.mjs \
     $DIR/$DATE-run-state.json $DIR/$DATE-swarm-report.md
   ```

2. Worktree hygiene: remove every `.worktrees/upstream-fix-issue-*` and
   `.worktrees/upstream-merge-pr-*` directory on terminal-state. The
   baseline worktree at `.worktrees/upstream-swarm-baseline` is removed
   only on the baseline gate's success path; leave it on failure for
   inspection.

3. Final exit: 0 if no issues quarantined; non-zero (with summary) if any
   are.

## Flags

- `--filter <expr>` — override default `--label type:cherry-pick-candidate`.
- `--fix-concurrency N` (default 3).
- `--pr-window N` (default 10).
- `--refute-concurrency N` (default 5).
- `--max-wave-size N` (default 3).
- `--dry-run` — Phase A only; opens no PRs.
- `--skip-baseline-gate` — explicit opt-out (RARE; documented).
- `--resume` — re-enter Phase B from the existing ledger.

## References

- Design spec: `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-05-upstream-swarm.md`
- Companions: `.claude/skills/upstream-fix/SKILL.md`,
  `.claude/skills/upstream-merge/SKILL.md`,
  `.claude/skills/upstream-cherry-pick/SKILL.md`.
