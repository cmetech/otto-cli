# Design: `upstream-merge` skill

**Status:** Approved (design), pending implementation plan
**Date:** 2026-05-31
**Author:** Corey Ellis + Claude
**Companion to:** `upstream-cherry-pick` (`2026-05-29-upstream-cherry-pick-skill-design.md`)
and `upstream-fix` (`2026-05-30-upstream-fix-skill-design.md`)

## 1. Purpose

The upstream-port pipeline has three stages. `upstream-cherry-pick` *files*
implementation-ready issues for upstream commits worth porting. `upstream-fix`
*implements* those issues and opens **one reviewable PR** to `main` — and stops
there. `upstream-merge` is the third stage: it **confirms a PR's CI and merges
it to `main`**.

It exists because the pipeline produces PRs faster than they can be hand-merged.
The skill discovers candidate PRs, confirms each against two independent signals
(GitHub Actions checks + a local trial-merge full-suite run), and merges the ones
that pass — behind a human gate by default, unattended under `--auto`.

This is a high-stakes skill: it is the one that moves code onto `main`. Its
design priorities, in order: **merge safety** (two signals, locked invariants,
human gate by default), **policy auditability** (an explicit required-checks
allowlist, not opaque heuristics), and **flat controller context** (an on-disk
ledger is the source of truth; logs and diffs never enter the controller).

### Non-goals

- It does not implement fixes or open PRs (that is `upstream-fix`).
- It does not file or triage issues (that is `upstream-cherry-pick`).
- It does not force-push, push to `main` directly, skip hooks, or commit secrets.
- It does not configure GitHub branch protection (policy lives in the skill's
  allowlist, not in GitHub required-status-checks).
- It does not fix red CI jobs; failures outside the allowlist are reported, not repaired.

## 2. Locked decisions (from design discussion)

| Decision | Choice |
| --- | --- |
| Skill shape | New standalone skill, with an **optional hand-off** from `upstream-fix` (which may invoke it at the end, passing its PR number) |
| Merge autonomy | **Human gate by default**; `--auto`/`--yes` opts into unattended batch merging |
| CI policy | **Required-checks allowlist** — listed checks must be green; all other checks are informational (reported, never blocking) |
| PR selection | **Filter-discovered batch + explicit override** — default filter discovers open PRs to `main` with head `integration/upstream-fix-*`; override with explicit numbers or no-arg (current branch's PR) |
| Confirmation signal | **Both** — required GitHub checks green **AND** a local full-suite pass on a trial-merge into current `main` |
| Merge method | `--squash` with `--delete-branch` |

## 3. Orchestration model (who does what)

Same hard constraint as `upstream-fix`: **a `.mjs` script cannot spawn Claude
subagents** — only the agent running `SKILL.md` can. Responsibilities split into
two layers:

- **Deterministic `.mjs` helper scripts** (pure Node, unit-testable, no LLM):
  PR selection/discovery, GitHub-checks evaluation against the allowlist,
  trial-merge worktree setup, gate execution, the merge call, issue/label
  updates, run-state ledger I/O, report generation.
- **Agent-driven orchestration (`SKILL.md`)**: drive the per-PR confirm→gate→merge
  sequence, present the human merge gate (`AskUserQuestion`), make
  merge/skip/block decisions, and dispatch a confirmation subagent if a local
  gate log needs inspection (so logs stay out of controller context).

### Context budget (the rule that makes batch runs possible)

The controller's context must grow with the *number of PRs*, not the *content of
checks/logs*. Therefore:

- **Never** read a check log, a gate log, or a diff into the controller. Scripts
  write those to disk and return compact summaries (`{pass, failTail}` style).
- The loop adds only: a few selection descriptors, one verdict line per PR, one
  merge-result line per merged PR. O(1) per iteration.
- Progress lives in the ledger, so auto-compaction or a restart is safe;
  `--resume` reconstructs everything and skips already-merged PRs.

## 4. Invocation

- `/upstream-merge` — no arg: confirm + merge the **current branch's** open PR.
- `/upstream-merge 64,70` — explicit PR numbers (comma-separated).
- `/upstream-merge --filter` — discover open PRs to `main` matching the default
  filter (head `integration/upstream-fix-*`), queue them.
- Flags:
  - `--auto` / `--yes` — skip the human merge gate; merge every PR that passes confirmation.
  - `--dry-run` — select PRs, run confirmation, print verdicts, **merge nothing**.
  - `--resume` — idempotent re-run from the ledger; already-merged PRs are skipped.
  - `--filter <glob>` — override the default head-branch filter.

### Issue cap

If discovery returns more than **10** PRs, STOP and ask the user to confirm
before processing that many merges (guards a stray `--filter`). Mirrors
`upstream-fix`'s lane cap.

## 5. Required-checks allowlist (the CI policy)

A config list (in the skill, e.g. `config.json` or a top-of-`SKILL.md` table)
names the checks that **must** be green. Seeded from PR #64's reality:

```
build
test-unit
test-packages
fast-gates
cargo audit
npm audit (.)
```

Policy evaluation per PR:

- A required check that is **green** → contributes to pass.
- A required check that is **red** or **missing** → **blocks** the PR.
- A required check that is **pending/running** → triggers a **wait** (poll until settled).
- Any check **not** on the allowlist → **informational**: its state (incl. red)
  is collected for the report but never blocks.

Currently-informational checks `e2e`, `docker-e2e`, `integration-tests`,
`windows-portability`, `test-coverage` are red for environmental reasons tracked
in **issue #65**. As #65 is resolved per job, the corresponding check is promoted
onto the allowlist. The allowlist is the single auditable place where "what
counts as green" is defined.

## 6. Phases

### Phase A — Select (deterministic, up front)

1. Resolve invocation → set of PR numbers:
   - explicit numbers → use as-is;
   - no arg → resolve the current branch's open PR (`gh pr view --json number`);
   - `--filter` → `gh pr list --base main --state open --json number,headRefName,isDraft`
     filtered by head glob (default `integration/upstream-fix-*`), drafts excluded.
2. `DATE=$(date +%F)`, `DIR=.planning/upstream-merges`.
3. Apply the **issue cap** (>10 ⇒ confirm).
4. `--dry-run`? Still run Phase B confirmation for visibility, then STOP before
   any merge.
5. Initialise the ledger (`$DIR/$DATE-run-state.json`) with one record per PR
   (number, headRef, status `queued`). On `--resume`, skip init.

### Phase B — Confirm (per PR, sequential)

For each queued PR, in order:

1. **Mergeability.** `gh pr view <n> --json isDraft,mergeable,mergeStateStatus`.
   Draft / `CONFLICTING` / not `MERGEABLE` ⇒ record `blocked` with reason, skip.
2. **GitHub checks.** Poll `gh pr checks <n>` until all checks settle (no
   `pending`). Evaluate the required allowlist:
   - all required green ⇒ checks-pass;
   - any required red/missing ⇒ record `blocked` (reason names the check), skip;
   - collect informational reds for the report.
   A bounded wait budget guards against a wedged/never-starting check; on timeout,
   record `blocked` (reason: "required check did not settle"), skip.
3. **Local gate.** In a throwaway worktree, **trial-merge the PR head into the
   latest local `main`** (fetch first), then run
   `run-gates.mjs full --cwd <worktree> --log $DIR/$DATE-gate-logs/pr-<n>-full.log`
   (chains `npm test` → `verify:pr` through the log firewall). `pass:true`
   required; otherwise record `blocked` (reason: "local full suite red"),
   keep the worktree + note its path, skip.

The trial-merge-into-current-`main` is deliberate: as earlier PRs in the batch
merge, `main` advances, so each later PR is re-confirmed against the updated tip
(merge-train correctness — a PR that conflicts with freshly-merged `main` is
caught here, not after a bad merge).

Fold one compact verdict line per PR into the ledger. Logs/diffs never enter the
controller; if a failure needs inspection, dispatch a confirmation subagent or
read the on-disk log with a bounded line range.

### Phase C — Merge (per PR)

For each PR with a passing confirmation verdict:

1. **Human gate (default).** Present the verdict via `AskUserQuestion`: required
   checks ✓, informational reds seen, local full-suite ✓, mergeability. Options:
   approve / skip. Under `--auto`, skip the prompt and proceed.
2. **Merge.** `gh pr merge <n> --squash --delete-branch`.
   **Locked invariants:** never force-push, never commit to `main` directly,
   never `--no-verify`/`--admin` bypass, never stage secrets.
3. **Post-merge.** Record merge commit SHA + status `merged` in the ledger.
   Verify the PR's linked issues are closed (`upstream-fix` closes them at
   PR-creation, so normally a no-op); if any remain open, comment the merge SHA
   and close via `issue-update.mjs`.

A skipped or blocked PR stays open with its recorded reason.

### Phase D — Report + cleanup

1. `write-report.mjs`-style rollup → `$DIR/$DATE-merge-report.md`: merged /
   skipped / blocked counts, each with its one-line reason and the
   informational-red checks observed.
2. Worktree hygiene: remove trial-merge worktrees on success; leave + note path
   on any local-gate failure.

## 7. Scripts (new vs reused)

**Reused from `upstream-fix`:**

- `run-gates.mjs full` — local full-suite gate through the log firewall.
- `issue-update.mjs` — label/comment/close linked issues.
- ledger I/O pattern (`ledger.mjs`-style read/write) — own run-state file.
- `write-report.mjs`-style report generation.

**New (deterministic, unit-tested):**

- `select-prs.mjs` — resolve invocation → queued PR list (explicit / current-branch / filter).
- `evaluate-checks.mjs` — given `gh pr checks` JSON + allowlist → `{pass, blockingReds, informationalReds, pending}`.
- `trial-merge.mjs` — set up a worktree, fetch `main`, merge PR head, report `{ok, conflict}`.
- `merge-pr.mjs` — wrap `gh pr merge --squash --delete-branch`, return `{merged, sha}`.
- merge-run ledger helpers (init/read/update/resume).

## 8. Locked invariants (never violate)

- Never force-push; never commit to `main` directly; merge only via `gh pr merge`.
- Never `--no-verify`, `--admin`, or any hook/required-check bypass.
- Never merge a PR with a **red or missing required-allowlist check**.
- Never merge without **both** signals green (required checks + local full suite).
- Human gate is the default; only `--auto` removes it, and even then the two-signal
  confirmation still gates every merge.
- Never stage `.env`/secrets.

## 9. Open items deferred to the plan

- Exact poll/wait budget for unsettled checks.
- Whether the allowlist lives in `config.json` vs an in-`SKILL.md` table (lean config.json for testability).
- Resume semantics when a PR was merged out-of-band between runs (detect via `gh pr view` state, mark `merged`, skip).
