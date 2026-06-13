# Upstream Hardening — Findings Verification (2026-06-13)

Verifies the candidate findings from the 2026-06-13 skill review against the
actual code. Status legend: `confirmed` (real, cite file:line) / `debunked`
(not a bug) / `reclassified` (real but belongs in a different phase).

Confirmed-by-direct-read already (pre-Phase-0):
- Cross-skill import cycle: CONFIRMED — trial-merge.mjs:18, poll-pr-checks.mjs:34,
  upstream-swarm/scripts/select-issues.mjs:12.
- Ledger duplication: CONFIRMED — identical readLedger/writeLedger in
  upstream-fix/scripts/ledger.mjs:10-18, upstream-merge/scripts/merge-ledger.mjs:9-17,
  upstream-swarm/scripts/swarm-ledger.mjs:38-46.
- "Inverted rebase classifier": DEBUNKED — transient-classifier.mjs only marks a
  rebase transient when `mainShaChanged && conflictMarkers`; a clean re-apply
  falls through to `real`. Correct as written.

## cherry-pick
## fix
## merge
## swarm

## Confirmed backlog (output)
| Finding | Status | Evidence | Target phase |
|---|---|---|---|
