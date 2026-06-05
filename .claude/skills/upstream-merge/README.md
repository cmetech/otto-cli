# upstream-merge

Third stage of the upstream-port pipeline:

```
upstream-cherry-pick  →  upstream-fix  →  upstream-merge
   (triage → issues)     (port → PR)      (confirm → merge)
```

Confirms an `upstream-fix` PR against two independent signals and squash-merges
it to `main`:

1. **GitHub required-checks allowlist** (`config.json` → `requiredChecks`) — listed
   checks must be green; all other checks are informational (reported, never blocking).
2. **Local trial-merge full suite** — merges the PR head into current `main` in a
   throwaway worktree and runs `run-gates.mjs full`.

Merges are **human-gated by default**; `--auto` opts into unattended batch merging.

## Usage

```sh
/upstream-merge              # current branch's PR
/upstream-merge 64,70        # explicit PR numbers
/upstream-merge --filter     # discover open PRs to main (head integration/upstream-fix-*)
```

Flags: `--auto`, `--dry-run`, `--resume`, `--filter <glob>`.

## Scripts

| Script | Responsibility |
| --- | --- |
| `select-prs.mjs` | Resolve invocation → queued PR list |
| `evaluate-checks.mjs` | Evaluate `gh pr checks` against the allowlist |
| `trial-merge.mjs` | Worktree trial-merge of a PR head into current `main` |
| `merge-pr.mjs` | `gh pr merge --squash --delete-branch` + merge sha |
| `merge-ledger.mjs` | On-disk run-state ledger |

Reuses `upstream-fix`'s `run-gates.mjs` (`full` gate) and `issue-update.mjs`.

Run the unit tests: `node --test .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs`

See `docs/superpowers/specs/2026-05-31-upstream-merge-skill-design.md`.
