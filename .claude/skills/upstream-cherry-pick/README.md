# upstream-cherry-pick

Audit OTTO's upstream forks and build a managed GitHub issue backlog of
cherry-pick candidates.

## Quick start

````markdown
```sh
# First-time setup (creates config, state file, labels on cmetech/otto-cli)
/upstream-cherry-pick --init

# Audit all configured upstreams
/upstream-cherry-pick

# Audit one
/upstream-cherry-pick pi-dev

# Dry-run (classify + score; skip gh issue creation)
/upstream-cherry-pick --dry-run

# Skip linked-PR/issue context fetching for a faster scan
/upstream-cherry-pick --no-issue-context

# Force re-fetch of cached PR/issue JSON
/upstream-cherry-pick --refresh-cache
```
````

## Reference

Full design spec: `docs/superpowers/specs/2026-05-29-upstream-cherry-pick-skill-design.md`.
