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

**`--single-issue` mode override.** When `--single-issue <N>` is set,
select-issues filters to exactly that number; plan-lanes returns one lane
with one issue; worktree-setup uses `singleIssueBranch(N, sha)` from
`single-issue-mode.mjs`; integration uses `singleIssueIntegrationBranch`
(same branch); PR title uses `singleIssuePrTitle`.

1. **Resolve the filter** from the invocation (e.g. `--severity critical-stability`,
   `--issues 62,63`, `--all`). Set `DATE=$(date +%F)` and
   `DIR=.planning/upstream-fixes`.
2. **Select issues:**
   ```sh
   node .claude/skills/_common/scripts/select-issues.mjs <filter> \
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
- `--single-issue <N>` — short-circuit planning to exactly one issue. The
  fix runs on its own per-issue branch `fix/upstream-issue-<N>-<sha>`,
  opens exactly one PR titled
  `fix(upstream): <subject> (closes #N)`, and skips the bundled-integration
  step entirely. Used by the `upstream-swarm` orchestrator. Composable
  with `--auto-merge` to hand the PR straight to `upstream-merge --auto`.

## References

- Design spec: `docs/superpowers/specs/2026-05-30-upstream-fix-skill-design.md`
- Companion: `.claude/skills/upstream-cherry-pick/SKILL.md`
