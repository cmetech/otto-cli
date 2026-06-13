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
