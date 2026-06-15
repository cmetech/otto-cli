verdict: do-not-port

# cdb84a5 — fix(gsd): clear auto skill visibility after units

## Target file(s)
- none (no otto equivalent)

## Divergence
Modifies `src/resources/extensions/gsd/auto/run-unit.ts` to clear surfaced-skill visibility once a unit finishes. Otto-cli has no `gsd/auto/run-unit`, no auto-mode skill visibility toggling.

## Concrete edits
1. None.

## Verdict
Skip. Pure gsd auto-mode plumbing.
