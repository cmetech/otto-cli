verdict: do-not-port

# cb0cb37 — fix(auto): complete-slice reopen handoff when DB is unavailable

## Target file(s)
- none (no otto equivalent)

## Divergence
Single-file change in `src/resources/extensions/gsd/auto-post-unit.ts`. The fix reshuffles how the post-unit hook produces a "reopen" handoff when the artifact DB is unreachable — purely gsd auto-mode plumbing. Otto-cli has no `auto-post-unit`, no DB-backed handoff, and no slice-completion pipeline.

## Concrete edits
1. None.

## Verdict
Skip. The host file does not exist in otto-cli and there is no analogous path. Cherry-picking would require materializing the gsd auto/post-unit subsystem first.
