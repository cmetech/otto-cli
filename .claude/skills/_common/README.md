# _common — shared primitives for the upstream-port skills

Scripts here are imported by upstream-cherry-pick / -fix / -merge / -swarm so the
skills depend on `_common`, never on each other (no skill↔skill import cycles).

- `base-ledger.mjs` — readLedger / writeLedger / SCHEMA_VERSION / validateTransition
- `worktree.mjs` — provisionWorktreeNodeModules + registry (registerWorktree / readRegistry / pruneWorktrees)
- `clean-worktrees.mjs` — CLI to prune stale worktrees (defaults to pruning both the fix and swarm registries)
- `evaluate-checks.mjs` — GitHub required-checks evaluation + allowlist-drift (`checkAllowlistDrift` / `fetchBranchProtection`)
- `select-issues.mjs` — issue selection + guidance-target parsing
- `issue-update.mjs` — gh issue label/comment/close
- `run-gates.mjs` — regression / build / targeted / full gate runner
- `fix-strategy.mjs` — canonical fork-divergence fix-strategy taxonomy + guidance parser
- `run-skill-tests.mjs` — canonical test runner (see below)

Import path from a skill script: `../../_common/scripts/<module>.mjs`.

## Running the tests

Run the **entire** upstream-port skill suite — every `*.test.mjs` across the five
skills, **including `__tests__/integration/`** — with the canonical runner:

```sh
node .claude/skills/_common/scripts/run-skill-tests.mjs
```

Use this rather than a hand-written `__tests__/*.test.mjs` glob: that flat glob
does **not** recurse into `__tests__/integration/`, and that blind spot once let an
action-kind rename silently break the swarm integration tests. The runner walks
the test dirs recursively so a rename can't skip coverage.

Skill-specific ledger modules (`upstream-fix/scripts/ledger.mjs`,
`upstream-merge/scripts/merge-ledger.mjs`, `upstream-swarm/scripts/swarm-ledger.mjs`)
keep their own `init*`/`record*` helpers and re-export `readLedger`/`writeLedger`
from `base-ledger.mjs`, so their internal consumers need no change.
