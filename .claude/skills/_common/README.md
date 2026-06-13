# _common — shared primitives for the upstream-port skills

Scripts here are imported by upstream-cherry-pick / -fix / -merge / -swarm so the
skills depend on `_common`, never on each other (no skill↔skill import cycles).

- `base-ledger.mjs` — readLedger / writeLedger / SCHEMA_VERSION / validateTransition
- `worktree.mjs` — provisionWorktreeNodeModules + registry (registerWorktree / readRegistry / pruneWorktrees)
- `clean-worktrees.mjs` — CLI to prune stale worktrees (defaults to pruning both the fix and swarm registries)
- `evaluate-checks.mjs` — GitHub required-checks evaluation
- `select-issues.mjs` — issue selection + guidance-target parsing
- `issue-update.mjs` — gh issue label/comment/close
- `run-gates.mjs` — regression / build / targeted / full gate runner

Import path from a skill script: `../../_common/scripts/<module>.mjs`.

Skill-specific ledger modules (`upstream-fix/scripts/ledger.mjs`,
`upstream-merge/scripts/merge-ledger.mjs`, `upstream-swarm/scripts/swarm-ledger.mjs`)
keep their own `init*`/`record*` helpers and re-export `readLedger`/`writeLedger`
from `base-ledger.mjs`, so their internal consumers need no change.
