# Larger unattended wave — runbook / handoff (2026-06-16)

Prereqs already in place (don't re-derive): the supervised first live run is done; 3 blocking
driver bugs + all 5 follow-ups are fixed and **pushed** to origin/main. Memory:
`project_pipeline_reliability_autonomy.md`. Driver: `.claude/skills/upstream-swarm/workflows/swarm-driver.mjs`.
Controller: `.claude/skills/upstream-swarm/scripts/swarm-control.mjs`.

## Operating decisions for THIS wave
- **Mode: curated batch + `--skip-select`** (NOT the driver's full `select`, which would pull the
  whole ~114-issue filtered backlog). Operator hand-picks the set; it's watched; the ledger persists.
- **Size: ~8–12 issues**, all `severity:nice-to-have-fix` (auto-merge tier), open + `status:triaged`,
  small, **file-disjoint across the set** (lanes run in parallel at fixConcurrency 3), and with **no
  open prerequisite**. Avoid anything whose guidance says "depends on …", "ported together with …",
  or "missing prerequisite". #61 is already done (PR #403, quarantined — skip it).
- **Caps (note `issueTimeoutMs` — arms the hung-lane breaker):**
  `{"fixConcurrency":3,"prWindow":10,"refuteConcurrency":5,"issueTimeoutMs":2700000}`  (45 min/lane)

## Steps
1. **Preflight.** `node .claude/skills/upstream-swarm/scripts/preflight-clean-main.mjs` must say
   `clean:true` (main == origin). If ahead, STOP and ask the operator before pushing. Confirm the
   suite is green (or trust the driver's baseline gate to catch it).
2. **Curate the set.** From `gh issue list --repo cmetech/otto-cli --state open --label status:triaged
   --label severity:nice-to-have-fix`, shortlist pi-dev candidates, then resolve target files with
   `node .claude/skills/_common/scripts/select-issues.mjs --label status:triaged --out /tmp/sel.json`
   and pick ones with resolvable, mutually-disjoint `targetFiles` and `needsTriage=false`.
   **PROPOSE the list to the operator and get explicit OK before launching.**
3. **Seed the ledger** (one call, the chosen numbers):
   `node .claude/skills/upstream-swarm/scripts/swarm-control.mjs select --filter '{"issues":["N1","N2",...]}'
   --out .planning/upstream-swarms/<DATE>-wave-selected.json
   --ledger-out .planning/upstream-swarms/<DATE>-wave-run-state.json --date <DATE> --max-wave-size 3`
   Verify it seeded exactly the chosen issues (state `selected`, sha + targetFiles set).
4. **Launch the driver** (Workflow tool, `scriptPath` = the driver) with args:
   `{ ledger:<seeded>, caps:"<the caps JSON string above>", dir:".planning/upstream-swarms",
      date:"<DATE>", unattended:true, dryRun:false, skipSelect:true, maxTicks:50 }`
   Watch with `/workflows`; narrate each tick; be ready to `TaskStop` (the breaker is armed via
   issueTimeoutMs now, but still watch).
5. **Drain the CI tail.** The loop drains-on-empty between backoff-gated CI polls, so ONE invocation
   won't block on PRs' CI. When it returns with lanes still in `awaiting-ci`, wait for those PRs'
   required checks to go green (poll `swarm-control poll --pr <n>` — `triage` is informational), then
   **re-invoke the SAME driver with `skipSelect:true, skipPreflight:true`** (ledger persists) to push
   them through ci-green→gate→refute→merge. Repeat until every issue is `merged` or `quarantined`.
6. **Validate + report.** Confirm each merged PR (`gh pr view`), review quarantines (refute reasons in
   the ledger / a comment), then update memory with the batch result + any new findings.

## Known-good behaviors to expect (don't mistake for bugs)
- A benign ~180s cold-start stall on the first ctl agent (auto-retried).
- `triage` CI check fails on every PR (missing VISION.md / empty ANTHROPIC_API_KEY) — it's NOT a
  required check; the poll treats it as informational. Ignore it.
- The refute panel CAN legitimately quarantine a fix (e.g. #61's blast-radius catch) — that's the
  gate working. Quarantined ≠ failure.
- `main` is unprotected, so `gh pr merge --squash` isn't blocked by the failing triage check.

## Do NOT
- Run the driver without `skipSelect` for a first larger wave (it selects the whole backlog).
- Force-merge a refuted/quarantined PR.
- Overlap a manual `swarm-control gate` with a live driver lane (worktree/registry contention).
