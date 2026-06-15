verdict: do-not-port

# caf3b51 — fix: guard gsd drift recovery

## Target file(s)
- none (no otto equivalent)

## Divergence
Wide-surface change to `src/resources/extensions/gsd/{auto-dispatch,auto-post-unit,auto-recovery,doctor*,state-reconciliation/*,tools/workflow-tool-executors}.ts` plus the gsd test directory. The new file `state-reconciliation/drift/artifact-db.ts` (~470 lines) is the centerpiece — it stands up a SQLite-backed drift artifact registry consumed by the gsd doctor and post-unit hooks. Otto-cli ships none of: gsd `auto-*`, gsd `doctor`, gsd `state-reconciliation`, or the workflow-tool-executors that drive them.

## Concrete edits
1. None. The host subsystem this code attaches to does not exist in otto-cli.

## Verdict
Skip. This is a gsd-internal hardening of a feature otto-cli has consciously not adopted. Porting would mean importing the entire drift/doctor stack — outside the scope of any cherry-pick batch.
