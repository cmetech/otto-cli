# upstream-fix

Implement filed `upstream-cherry-pick` issues. Companion to that skill: it
*files* issues; this one *fixes* them.

## Quick start

```sh
# Preview: select + plan lanes, do no work
/upstream-fix --severity critical-stability --dry-run

# Real run
/upstream-fix --severity critical-stability

# Resume after interruption/compaction (idempotent)
/upstream-fix --resume
```

Full design: `docs/superpowers/specs/2026-05-30-upstream-fix-skill-design.md`.
