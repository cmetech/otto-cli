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
- Missing-guidance is silent — **CONFIRMED** — run-audit.mjs:304-320 reads guidance and, when absent, only does `runData.unanalyzed = (runData.unanalyzed ?? 0) + 1` (line 320) — never throws; build-issue-payload.mjs:201-214 (`renderImplementationGuidance`) emits the "⚠️ Not yet analyzed" banner and build-issue-payload.mjs:271 sets the `Analyzed | no` row, so a real run files the issue and exits 0 with only a stderr warning (run-audit.mjs:443-445). No fail-fast and no `--skip-guidance` opt-in gate exists. — target: Phase 2
- Verdict-line parse fragility — **CONFIRMED** — `parseVerdict` (run-audit.mjs:146-150) runs the regex `verdict:\s*` against the entire guidance text rather than the first line that SKILL.md:71-89 mandates, and when no match is found it returns null (run-audit.mjs:305); buildLabels (build-issue-payload.mjs:95-97) then silently substitutes the risk-based fallback (`HIGH → port-required`, else `cherry-pick-candidate`) with no error. A header/comment before line 1, or a `verdict:` token elsewhere in prose, is parsed or mis-parsed silently — the type:* label is wrong with no signal. — target: Phase 2
- Fuzzy dedup — **DEBUNKED** — dedup-check.mjs:64 post-filters the full-text search hits with the literal substring `(i.body ?? "").includes(\`sha=${shaShort}\`)`. A prose mention of a bare sha (e.g. "superseded by ce0e801") lacks the literal `sha=` trailer and is dropped (lines 60-67). A false dup would require the exact `sha=<short>` trailer string to appear in prose, which is already the intended dedup key — the documented concern is mitigated by the existing post-filter. — target: n/a
- PR-context cache no-expiry — **CONFIRMED** — fetch-pr-context.mjs:53-62 returns the cached `pr-<n>.json` / `issue-<n>.json` whenever the file `existsSync` and `!refreshCache`; there is no mtime/age/TTL comparison anywhere in the function. Cache is retained indefinitely until the caller passes `--refresh-cache` (run-audit.mjs:262, flag at run-audit.mjs:81). — target: Phase 5

## fix
- Non-idempotent issue close — **CONFIRMED** — issue-update.mjs:29-32 calls `gh issue close` unconditionally (and label edits at :15-22, comment at :24-27) with no skip-if-already-applied / status precheck anywhere; SKILL.md:222-231 (Phase D) invokes it once per applied issue with no resume guard. There is no read of current issue state or label set before mutating, so a re-run after a partial/aborted Phase D re-issues the same close/label/comment ops (gh tolerates some of these, but the comment op is not idempotent — a duplicate "Applied in ..." comment is posted every re-run). No guard exists. — target: Phase 3
- Worktree cleanup on failure — **CONFIRMED (already covered by Phase 1)** — SKILL.md:236-237 (Phase D, step 3) explicitly states "on success `git worktree remove`; on failure leave it and note its path in the report"; worktree-setup.mjs:31-33 creates `.worktrees/upstream-fix-lane-<id>` but no script (no worktree-merge.mjs, no record-result.mjs, no ledger.mjs path) ever prunes a failed lane's worktree. Confirmed real, but the worktree registry already planned for Phase 1 covers this — note as covered. — target: Phase 1 (already covered)
- Reviewer rejection is terminal — **CONFIRMED** — SKILL.md:187-188 folds a reject into ledger status `rejected` and "excludes that commit from integration"; Phase D step 1 (SKILL.md:230-231) then leaves rejected/unresolved issues open with `status:triaged` and no `--close`, and there is no retry/re-dispatch edge anywhere in SKILL.md or record-result.mjs/ledger.mjs (recordIssueResult/setIssueStatus at ledger.mjs:54-70 only set terminal status, no retry-count or requeue). A reject is terminal for the run. — target: Phase 5
- `status:applied` resume gap — **CONFIRMED** — select-issues.mjs:14,71 excludes issues only by the `status:applied` label (`EXCLUDE_STATUS`), and the gh query is `--state open` (select-issues.mjs:19). An issue merged OUTSIDE the skill never gets that label applied (Phase D's labelling at SKILL.md:225-227 is the only writer), so on `--resume` it is neither filtered out nor (if left open) state-filtered out — it is re-selected and re-fixed. The scheduler-based "skip applied" claim at SKILL.md:86-87 relies entirely on the ledger/label that an external merge never set. — target: Phase 3
- Ledger versioning absent — **CONFIRMED (already covered by Phase 1)** — ledger.mjs:21 writes `version: 1` in initLedger, but readLedger (ledger.mjs:10-13) is a bare `existsSync` + `JSON.parse` with no version read/validate/migrate; nothing in the file references `version` again. A base-ledger with SCHEMA_VERSION + read-time backfill is already planned for Phase 1 — mark as covered. — target: Phase 1 (already covered)

## merge
## swarm

## Confirmed backlog (output)
| Finding | Status | Evidence | Target phase |
|---|---|---|---|
| Cross-skill import cycle | confirmed | trial-merge.mjs:18, poll-pr-checks.mjs:34, select-issues.mjs:12 | (pre-Phase-0) |
| Ledger duplication | confirmed | ledger.mjs:10-18, merge-ledger.mjs:9-17, swarm-ledger.mjs:38-46 | (pre-Phase-0) |
| Inverted rebase classifier | debunked | transient-classifier.mjs (rebase→transient only when mainShaChanged && conflictMarkers) | n/a |
| Missing-guidance is silent | confirmed | run-audit.mjs:304-320; build-issue-payload.mjs:201-214,271 | Phase 2 |
| Verdict-line parse fragility | confirmed | run-audit.mjs:146-150,305; build-issue-payload.mjs:95-97 | Phase 2 |
| Fuzzy dedup | debunked | dedup-check.mjs:64 literal-trailer post-filter | n/a |
| PR-context cache no-expiry | confirmed | fetch-pr-context.mjs:53-62 (no TTL/mtime check) | Phase 5 |
