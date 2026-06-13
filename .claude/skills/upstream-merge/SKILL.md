---
name: upstream-merge
description: >
  Confirm and merge upstream-fix PRs on cmetech/otto-cli. Discovers candidate
  PRs (filter, explicit numbers, or current branch), confirms each against a
  required-checks allowlist on GitHub AND a local trial-merge full-suite run,
  then squash-merges behind a human gate (default) or unattended under --auto.
  Third stage of the upstream-port pipeline (cherry-pick → fix → merge). Use
  when asked to "merge the upstream PRs", "confirm and merge PR <n>", or
  "/upstream-merge". High-stakes — it moves code onto main.
---

# Upstream-Merge

Third stage of the upstream-port pipeline. `upstream-fix` opens reviewable PRs;
this skill *confirms their CI and merges them to `main`*. It is high-stakes — the
only skill that lands code on `main` — so it gates every merge on **two
independent signals** and a **human gate by default**.

> **Self-modification note:** this skill edits only otto-cli state, PRs, and
> `.planning/` artifacts during a run — never its own skill files.

## When to use

- "Merge the upstream PRs." / "Confirm and merge PR 64."
- `/upstream-merge` (current branch's PR), `/upstream-merge 64,70`, `/upstream-merge --filter`.

## Locked invariants (never violate)

- Never force-push; never commit to `main` directly; merge only via `gh pr merge`.
- Never `--no-verify`, `--admin`, or any hook/required-check bypass.
- Never merge a PR with a **red or missing required-allowlist check**.
- Never merge without **both** signals green (required checks + local full suite).
- Human gate is the default; only `--auto` removes it; the two-signal confirmation still gates every merge.
- Issue cap: if discovery returns **> 10** PRs, STOP and confirm before processing.

## Context budget

The controller's context grows with the *number of PRs*, not check/log content.
Never read a check log, gate log, or diff into the controller — scripts write
those to disk and return compact summaries. The loop adds only selection
descriptors, one verdict line per PR, one merge-result line per merged PR.
Progress lives in the ledger; `--resume` reconstructs everything.

## Phase A — Select (deterministic)

1. Resolve the invocation → mode: explicit `--issues 64,70`, `--filter [glob]`
   (default head `integration/upstream-fix-*`), or no-arg `--current`.
   ```sh
   DATE=$(date +%F); DIR=.planning/upstream-merges
   node .claude/skills/upstream-merge/scripts/select-prs.mjs <mode-args> --out $DIR/$DATE-selected-prs.json
   ```
   Read only the printed `{ count, path }`.
2. **Issue cap.** If `count` > 10, STOP and ask the user to confirm.
3. **`--dry-run`?** Continue through Phase B for visibility, then STOP before any merge.
4. Initialise the ledger (skip on `--resume`):
   ```sh
   node -e "import('./.claude/skills/upstream-merge/scripts/merge-ledger.mjs').then(m=>m.initMergeLedger('$DIR/$DATE-run-state.json',{date:'$DATE',prs:require('./$DIR/$DATE-selected-prs.json')}))"
   ```

## Phase B — Confirm (per PR, sequential)

For each queued PR, in order:

1. **Mergeability.** `gh pr view <n> --repo cmetech/otto-cli --json isDraft,mergeable,mergeStateStatus`.
   Draft / `CONFLICTING` / not `MERGEABLE` ⇒ record `blocked` (reason), skip.
2. **GitHub checks.** Poll until checks settle (no `pending`), then evaluate the allowlist:
   ```sh
   node .claude/skills/_common/scripts/evaluate-checks.mjs <n> --repo cmetech/otto-cli
   ```
   `gh pr checks` exits non-zero when not all green; capture stdout regardless
   (e.g. `... || true` around a stdout capture) — the JSON verdict is what matters.
   `pass:true` ⇒ continue. Any `blocking` ⇒ record `blocked` (name the check), skip.
   Non-empty `pending` ⇒ wait and re-poll (bounded budget; on timeout record `blocked`).
   Collect `informationalReds` for the report.
3. **Local gate.** Trial-merge into current `main`, install deps in the worktree,
   run the full suite:
   ```sh
   node .claude/skills/upstream-merge/scripts/trial-merge.mjs <n> <headRef>
   ( cd <worktree> && npm ci )   # the cost of the two-signal choice; deps must exist in the worktree
   node .claude/skills/_common/scripts/run-gates.mjs full \
     --cwd <worktree> --log $DIR/$DATE-gate-logs/pr-<n>-full.log
   ```
   `pass:true` required; else record `blocked` (reason "local full suite red"),
   keep the worktree + note its path, skip.

Fold one compact verdict line per PR into the ledger via `recordVerdict`. If a
failure needs inspection, dispatch a subagent or read the on-disk log with a
**bounded** line range — never `cat` a whole log.

## Phase B.5 — Refute panel (only under `--auto`)

When invoked without `--auto`, the human IS the refute step — skip Phase B.5.
Under `--auto`, after Phase B confirms both signals green, dispatch the
multi-lens refute panel before any merge:

1. Build the shared input bundle once per PR:
   ```sh
   node -e "import('./.claude/skills/upstream-merge/scripts/refute-panel.mjs').then(async m => {
     const b = m.buildInputBundle({ prNumber: PR, issueNumber: ISSUE, upstreamSha: SHA });
     console.log(JSON.stringify(b));
   })"
   ```
2. Dispatch 4 lens subagents in parallel via `agent()` (Workflow tool) or
   the equivalent fan-out primitive. Each lens uses `agentType: "general-purpose"`
   and a schema-forced output (see `refute-panel.mjs` for the schema).
3. Apply `tallyVerdicts` to get the panel verdict.
4. If REFUTE: post the consolidated comment via `gh pr comment`, label the
   issue `status:needs-human`, do NOT merge. Record `refuteVerdict` and
   `refuteReason` in the ledger.
5. If APPROVE: proceed to Phase C with `--refute-verdict approve`.

Lens prompts live in `refute-panel.mjs`. Each lens is given the bundle and
asked one question (upstream-alignment / scope-discipline / test-quality /
blast-radius). Schema:

**`upstream-alignment` strategy branch.** When `bundle.fixStrategy` is
`essence-reimplement`, judge **alignment to the upstream INTENT / root cause**,
NOT diff-fidelity — otto-cli has diverged in behavior, so the PR will (correctly)
not mirror the upstream diff. Refute only if the PR fails to resolve the documented
root cause. For `direct-merge` / `adapted-port`, judge fidelity to the upstream
change as before.

```json
{
  "verdict": "approve" | "refute" | "abstain",
  "confidence": 0.0-1.0,
  "reason": "<= 200 chars",
  "blocking": boolean
}
```

## Phase C — Merge (per PR with a passing verdict)

1. **Human gate (default).** Present the verdict via `AskUserQuestion` (required
   checks ✓, informational reds, local suite ✓, mergeability) → approve / skip.
   Under `--auto`, skip the prompt.
2. **Merge.**
   ```sh
   node .claude/skills/upstream-merge/scripts/merge-pr.mjs <n> --repo cmetech/otto-cli \
     ${AUTO:+--auto --refute-verdict $REFUTE_VERDICT}
   ```
   Record `mergeSha` + status `merged` via `recordMerge`.
3. **Post-merge.** Verify the PR's linked issues are closed (`upstream-fix`
   closes them at PR-creation, normally a no-op). If any remain open:
   ```sh
   node .claude/skills/_common/scripts/issue-update.mjs <issue> --repo cmetech/otto-cli \
     --comment "Merged in <mergeSha>." --close
   ```
   This is idempotent — re-running skips the duplicate "Merged in …" comment and
   will not re-close an already-closed issue.

## Phase D — Report + cleanup

1. Write a rollup to `$DIR/$DATE-merge-report.md`: merged / skipped / blocked
   counts, each with its one-line reason and informational-red checks observed.
2. Worktree hygiene: `git worktree remove <worktree>` on success; leave + note
   path on any local-gate failure.

## Flags

- `--auto` / `--yes` — skip the human merge gate.
- `--auto-refute` — implies `--auto` AND runs Phase B.5 refute panel
  before each merge. The swarm orchestrator always passes this; humans
  invoking `upstream-merge` directly normally do not.
- `--dry-run` — select + confirm, merge nothing.
- `--resume` — idempotent re-run from the ledger; already-`merged` PRs skipped.
- `--filter <glob>` — override the default head-branch filter.

## References

- Design spec: `docs/superpowers/specs/2026-05-31-upstream-merge-skill-design.md`
- Companions: `.claude/skills/upstream-fix/SKILL.md`, `.claude/skills/upstream-cherry-pick/SKILL.md`
