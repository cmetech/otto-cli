verdict: do-not-port

# db76d8b — fix(bug-2): Worker-lock self-collision / lock leak across orchestrator iterations

## Target file(s)
- none (no otto equivalent)

## Divergence
Modifies `src/resources/extensions/gsd/auto.ts` and `src/resources/extensions/gsd/db/milestone-leases.ts` to allow same-process re-entry of milestone leases and to release held leases on pause cleanup. Otto-cli has no gsd auto entry point, no `db/milestone-leases` SQLite table, and no milestone-leasing orchestrator.

## Concrete edits
1. None.

## Verdict
Skip. Gsd-only locking primitives. The bug class (re-entrant worker lock collisions) does not exist in otto because otto does not run the gsd auto-orchestrator.
