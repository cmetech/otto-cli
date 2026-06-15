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
select-issues filters to exactly that number (pass `--issues <N>`; there is
no `--single-issue` flag on select-issues itself); plan-lanes returns one
lane with one issue; integration uses `singleIssueIntegrationBranch` (same
branch); PR title uses `singleIssuePrTitle`.

**Collision-safety (parallel lanes).** When the swarm runs many
`--single-issue` lanes at once, plan-lanes gives every lane `id=1`, so any
artifact or worktree keyed on lane id or bare `$DATE` collides across lanes.
Therefore in `--single-issue` mode you MUST namespace **per issue**, not per
date:
- **Worktree/branch:** call worktree-setup in single-issue mode —
  `node .../worktree-setup.mjs --issue <N> --sha <sha> main` — which names the
  worktree `.worktrees/upstream-fix-issue-<N>` and the branch
  `singleIssueBranch(<N>, <sha>)` (`fix/upstream-issue-<N>-<sha>`). Do NOT pass
  a positional lane id in this mode.
- **Artifacts:** suffix every dated artifact path with `-issue-<N>` —
  `$DIR/$DATE-issue-<N>-selected-issues.json`, `…-issue-<N>-lanes.json`,
  `…-issue-<N>-run-state.json`, and the gate-logs subdir
  `$DIR/$DATE-issue-<N>-gate-logs/`. This is what keeps two same-day lanes from
  clobbering each other's selection/ledger state (see #384).

**Gate completion (no premature exit).** A `--single-issue` lane MUST run every
gate — regression (fails-before/passes-after), build, targeted, **full suite**,
and the **independent reviewer** — to completion *in-process* before opening the
PR and emitting its result. NEVER background a gate (e.g. spawn a detached suite
run) and then exit/report while it is still running: the lane can terminate with
gates incomplete, leaving an un-pushed commit and a misleading "done" signal
(observed 2026-06-15 — a lane reported "monitors armed, waiting" then died
before reviewer + PR-open). The final report's `OUTCOME` and the run-state's
`finalSuite`/`reviewer` fields must reflect gates that **actually finished**, not
gates still in flight. PR-open is the last step, after all gates are green.

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

   On `--resume`, add `--exclude-applied`: select-issues then asks GitHub whether
   each candidate open issue has a **linked merged PR** and drops those — so a fix
   that already landed (including merged out-of-band, where `status:applied` was
   never set by the skill) is not re-selected. The printed `excludedApplied` count
   reports how many were dropped.
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
   `status:applied` are skipped by the scheduler, and selection additionally
   drops any open issue with a linked merged PR (`--exclude-applied`), covering
   fixes merged outside the skill.

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

0b. STRATEGY. Determine the fix-strategy for this issue:
    - If the issue carries a `fix-strategy:*` label, use it.
    - Else read the guidance file's first line (`strategy: <value>`), or a
      grandfathered `verdict:` line.
    - Else (pre-Phase-2 issue, no strategy): CLASSIFY INLINE — from the upstream
      diff + the actual otto-cli source, pick exactly one of `direct-merge`,
      `adapted-port`, `essence-reimplement`, `not-needed`, and set the label:
        gh issue edit <num> --repo cmetech/otto-cli --add-label fix-strategy:<value>
      For `essence-reimplement`, write a one-line **Essence to preserve** note in
      your issue comment (the root cause + the property that must hold in our code).
    The strategy decides how the REGRESSION TEST and the reviewer gate are judged.

1. REGRESSION TEST. Write a node:test `*.test.ts` co-located with the source you
   will change. Confirm it FAILS against current behaviour:
     node .claude/skills/_common/scripts/run-gates.mjs regression \
       --cwd <worktree> --log <DIR>/<DATE>-gate-logs/lane-<n>-<num>-reg-before.log \
       --test-file <relpath-to-test>
   It MUST fail now. Apply the fix. Re-run the same gate; it MUST pass.
   (If a runtime regression test is genuinely impossible — e.g. pure
   packaging/metadata — record a justification in your return line; such issues
   need explicit reviewer approval later.)
   For `essence-reimplement` there is usually **no upstream test that maps** — you
   MUST AUTHOR a regression test that pins the **root cause in our code** (the
   Essence to preserve), not a transcription of an upstream test. It MUST fail
   before your fix and pass after. This is the anchor that keeps an essence port
   from landing without a real failing-then-passing gate.

2. BUILD GATE:
     node .claude/skills/_common/scripts/run-gates.mjs build \
       --cwd <worktree> --log <...>-build.log --files <targetFiles csv>
   Must return pass:true.

3. TARGETED SUITE GATE:
     node .claude/skills/_common/scripts/run-gates.mjs targeted \
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
   - Determine the issue's `fix-strategy:*` (label or guidance).
   - Judge by strategy:
     - `direct-merge` / `adapted-port`: does the diff faithfully apply/transcribe
       the upstream change to the correct otto-cli files, without regressions or
       scope creep? (Catch "passes tests but wrong/incomplete".)
     - `essence-reimplement`: **does this address the upstream ROOT CAUSE** in our
       diverged code? The upstream diff is a reference for *intent*, NOT a target
       to match — do not reject for failing to mirror the diff; reject if the root
       cause is not actually resolved or the regression test does not pin it.

   RETURN exactly one line:
     approve <one-line rationale>
     reject  <one-line concrete reason>
   ```
   Fold the verdict into the ledger. On `approve`, set `reviewer`/`reviewerReason`.
   On `reject`, call `recordReviewerRejection(path, <num>, <reason>)`: the FIRST
   reject is auto-recoverable — it returns `{retry:true}`, sets the issue back to
   `fixing`, and you **re-dispatch the fix subagent once** with the reviewer's
   reason quoted (re-run the regression/build/targeted gates, then re-review). A
   SECOND reject returns `{retry:false}` and is terminal (`rejected`) — exclude
   that commit from integration. `reviewerRejectionCount` is tracked in the ledger.

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
   node .claude/skills/_common/scripts/run-gates.mjs full \
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
     node .claude/skills/_common/scripts/issue-update.mjs <num> --repo cmetech/otto-cli \
       --add-label status:applied --remove-label status:triaged --remove-label status:in-progress \
       --comment "Applied in <commitSha> (PR <prUrl>)." --close
     ```
     Set ledger issue status `applied`.
   `issue-update.mjs` is idempotent: a re-run skips the duplicate "Applied in …"
   comment and does not re-close an already-closed issue (it reports
   `comment-skipped` / `close-skipped`), so resuming Phase D never throws or
   double-comments.
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
- `--resume` — idempotent re-run from the ledger; skips `status:applied` and
  (via `--exclude-applied` selection) any issue with a linked merged PR.
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
