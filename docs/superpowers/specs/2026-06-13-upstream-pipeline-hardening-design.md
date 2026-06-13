# Upstream-Port Pipeline Hardening — Design

**Date:** 2026-06-13
**Status:** Approved (design); per-phase implementation plans to follow
**Owner:** Corey Ellis
**Related:** `2026-05-30-upstream-fix-skill-design.md`, `2026-06-05-upstream-swarm-design.md`

## Problem

The upstream-port pipeline — four Claude Code skills that port fixes from OTTO's
upstream forks (`gsd-pi` at `../gsd-pi`, `pi` at `../pi`) into `otto-cli` — is
built and dogfooded, but it was built for a trickle and is now facing a firehose.

As of 2026-06-13:

| Metric | Count |
|---|---|
| gsd-pi issues ported / closed | 4 |
| gsd-pi issues open & actionable (`type:port-required` + `type:cherry-pick-candidate`) | 136 (85 + 51) |
| of those: critical-stability / critical-security / feature | 4 / 1 / 17 |
| `type:do-not-port` (triaged out) | 147 |
| new gsd-pi commits since the last audit (2026-06-05), not yet triaged | ~500 |

A review of the four skills (excerpt-level, by an `Explore` agent) surfaced ~20
candidate weaknesses spanning correctness bugs, scaling hazards, and
nice-to-haves. **Decision: harden the skills before resuming any porting** —
pushing 136+ issues through buggy tooling multiplies risk.

The four skills:

1. `upstream-cherry-pick/` — audits upstream commits, files enriched GitHub issues
2. `upstream-fix/` — implements filed issues on file-disjoint worktree lanes, 4 confidence gates, one PR
3. `upstream-merge/` — confirms + squash-merges fix PRs (required-checks allowlist + local trial-merge + refute panel)
4. `upstream-swarm/` — autonomous orchestrator over fix+merge, 1 PR/issue, tiered auto-merge

## Goal

Bring all four skills to a hardened state — decoupled shared code, no latent
correctness bugs, and the scaling affordances (prioritization, timeouts, adaptive
polling, auto-cleanup) needed to run a sustained porting campaign against a
fast-moving upstream — **before** the next porting batch.

Non-goals: porting any issues; refreshing the audit on the ~500 new commits;
porting the pipeline to `@otto/pi-upstream-swarm` (tracked separately).

## Approach: Phased Hybrid

Sequencing chosen for de-risking order — verify first, decouple second, then fix
and scale on a clean base so every change lands once.

- **Phase 0 — Verify.** Confirm every candidate finding against the actual code
  before writing fixes.
- **Phase 1 — `_common/` foundation.** Extract shared code; break the
  skill↔skill cycles. Behavior-preserving refactor.
- **Phase 2 — Correctness fixes.** Confirmed bugs, on the clean base.
- **Phase 3 — Scaling.** Prioritization, timeouts, adaptive polling, structured
  abort detection.
- **Phase 4 — Nice-to-haves.** Lower-leverage polish; the largest item
  (smarter wave bundling) is explicitly deferrable.

**Document structure:** this single design spec, then **one implementation plan
per phase** (via `writing-plans`), each shipped as its own PR. This matches the
established build workflow: lean per-task execution, `/clear` between tasks, read
only the target task's plan section, `git add -f` for `.claude/` files (they are
gitignored at `.gitignore:43` but skill files are tracked via force-add).

**Self-modification block:** editing files under `.claude/skills/` triggers the
auto-mode self-modification block and requires explicit operator authorization
each session. Every phase touches `.claude/skills/`, so each implementation
session must obtain that authorization up front.

## Current Coupling (verified 2026-06-13)

Cross-skill imports (relative paths) — **confirmed** by direct read:

```
upstream-merge/scripts/trial-merge.mjs   → ../../upstream-swarm/scripts/worktree-node-modules.mjs
upstream-swarm/scripts/poll-pr-checks.mjs → ../../upstream-merge/scripts/evaluate-checks.mjs
upstream-swarm/scripts/select-issues.mjs  → ../../upstream-fix/scripts/select-issues.mjs
```

This is a `merge ↔ swarm` cycle plus a `swarm → fix` edge. Any refactor of one
skill's scripts silently breaks the others.

Ledger duplication — **confirmed**: `upstream-fix/scripts/ledger.mjs`,
`upstream-merge/scripts/merge-ledger.mjs`, and
`upstream-swarm/scripts/swarm-ledger.mjs` each contain byte-identical
`readLedger` / `writeLedger` (read JSON / write JSON). Only the `init*` /
`record*` logic differs per skill. (`upstream-cherry-pick` has an analogous
`state-read.mjs` / `state-write.mjs` pair.)

Script inventory: cherry-pick 18, fix 11, merge 6, swarm 10. Tests live in each
skill's `__tests__/` directory — **52 test files total**, the regression net that
must stay green through Phase 1.

## Phase 0 — Verify findings

Walk every candidate finding (catalog below) against the real code. For each:
confirm (cite `file:line`), debunk, or reclassify. Output: the findings catalog
updated in place with a `Status` of `confirmed` / `debunked` / `reclassified`,
and the confirmed set becomes the scope for Phases 2–4.

Rationale: the source review was excerpt-level. One finding ("inverted rebase
classifier") is **already debunked** — `transient-classifier.mjs` only marks a
rebase transient when `mainShaChanged && conflictMarkers`; a clean re-apply falls
through to `real`, which is correct. Expect 1–2 more phantoms. Verifying first is
cheap and prevents building fixes for non-bugs.

This phase writes no production code — only the verification notes and any new
characterization tests that capture current behavior for items entering Phase 1/2.

## Phase 1 — `_common/` foundation

Create `.claude/skills/_common/scripts/` (+ `_common/scripts/__tests__/`).
Convert the skill↔skill cycles into a one-directional `skills → _common`
dependency. Imports remain relative (`../../_common/scripts/x.mjs`) but acyclic.

| `_common` module | Absorbs | Removes |
|---|---|---|
| `base-ledger.mjs` — `readLedger` / `writeLedger` + `schemaVersion` field + `validateTransition(from, to, table)` | duplicated read/write in fix, merge, swarm | 3× duplication; adds versioning + enforced transitions |
| `worktree.mjs` — provision node_modules, setup lane worktree, merge worktree, **cleanup + registry** | `worktree-node-modules.mjs` (swarm), `worktree-setup.mjs` / `worktree-merge.mjs` (fix), inline logic in `trial-merge.mjs` | `merge → swarm` import; leaked-worktree hazard |
| `select-issues.mjs` | fix's `select-issues.mjs` (imported by swarm) | `swarm → fix` import |
| `evaluate-checks.mjs` | merge's `evaluate-checks.mjs` (imported by swarm) | `swarm → merge` import |
| `issue-update.mjs` | fix's (reached by merge, swarm) | implicit cross-skill coupling |
| `run-gates.mjs` | fix's (reached by merge, swarm) | implicit cross-skill coupling |

**Skill-specific logic stays put.** Each skill keeps its own `init*` / `record*`
ledger functions and its orchestration scripts; they now build on
`base-ledger.mjs`. `upstream-cherry-pick`'s `state-read`/`state-write` migrate to
`base-ledger` too (its state file is structurally a ledger).

**Migration discipline (per module):** move file → re-point all import sites →
run full `__tests__` suite → green before the next move. Move tests alongside
code. Add `validateTransition` enforcement to the swarm's `VALID_TRANSITIONS`
table (currently defined but not enforced at write time).

**Worktree registry** (lands here because it is a worktree utility): a JSON
registry tracking each worktree's creation time + owning lane/PR + state. On skill
startup, prune worktrees in a terminal state or older than a TTL (default 24h).
Expose `--clean-worktrees`. Fixes the leaked-`.worktrees/` accumulation across the
fix and swarm skills.

Acceptance: zero `../../upstream-*/scripts/` imports remain (only
`../../_common/scripts/`); full suite green; no behavior change observable from
the SKILL.md entry points.

## Phase 2 — Correctness fixes

Scope = Phase-0-confirmed correctness items. Initial confirmed/expected set:

1. **Idempotent issue lifecycle** (`_common/issue-update.mjs`). Query issue state
   before close/label/comment; skip redundant ops; never exit non-zero on an
   already-applied action. Lets `upstream-fix` Phase D and `upstream-merge`
   re-run on resume without throwing. Test: re-run against an already-closed issue
   succeeds as a no-op.
2. **Merge re-gates on resume** (`upstream-merge`). A blocked PR's local
   trial-merge result is cached in the ledger and never re-run on `--resume`, so a
   transient flake permanently blocks a good PR. Add a `localGateRunAt` timestamp;
   on resume, if older than a TTL, re-run the local gate before honoring the
   cached verdict. Test: stale-failed gate is re-run, passes, PR proceeds.
3. **cherry-pick fail-fast on missing guidance.** Today a missing guidance file
   files the issue with an `Analyzed | no` banner and the run still succeeds —
   invisible at batch scale. Add a preflight that lists selected shas without
   guidance and exits non-zero unless `--skip-guidance-check` (audit/dry-run).
   Test: a selected sha with no guidance file aborts a real (non-dry) run.
4. **cherry-pick verdict-line validation.** `parseVerdict` reads the guidance
   file's first line; a header/comment before it silently downgrades to a
   risk-based label. Validate the `verdict:` line is present and well-formed;
   error with the offending file path otherwise. Test: malformed verdict line
   produces a clear error, not a silent mislabel.
5. **Robust dedup** (`dedup-check.mjs`). The `sha=<short> in:body` full-text
   search tokenizes and false-matches prose mentions; the current post-filter on
   the literal `sha=<short>` trailer is fragile. Move to an exact-phrase search
   (`--search '"[sha=<short>]"'`) as the canonical match, keep the trailer
   post-filter as a guard. Test: an issue that merely mentions a sha in prose is
   not treated as the tracking issue.

Items NOT in this phase (verify in Phase 0, likely reclassified): the rebase
classifier (debunked). If Phase 0 finds the rebase-conflict→transient→retry
*policy* questionable (a pure conflict rarely self-heals on retry), reclassify it
as a Phase 3 scaling/policy decision, not a bug.

No porting resumes until Phase 2 lands.

## Phase 3 — Scaling

1. **Severity-ordered swarm scheduling.** Today the scheduler is FIFO by issue
   number; there is no way to ship the 4 critical issues first. Order the work
   queue by severity (critical → feature → nice-to-have), then by number within a
   tier, while preserving file-disjoint wave constraints.
2. **Per-issue timeout / circuit-breaker.** A stuck fix lane blocks the whole
   swarm. Add a per-issue wall-clock budget; on breach, quarantine the issue and
   free the lane. Expose `--issue-timeout`.
3. **Adaptive PR polling** (`poll-pr-checks.mjs`). Currently N sequential
   `gh pr checks` per tick. Batch by status and apply exponential backoff (double
   the interval after K consecutive no-change polls, capped). Reduces GitHub API
   pressure at the 10-open-PR ceiling.
4. **Structured abort-streak detection.** Replace the raw `failTail` string
   comparison with a structured signature (stage + error class + first failing
   line). Count consecutive *identical signatures*, not consecutive quarantines.
   Add `--reset-abort-counter` so recovery does not require hand-editing the
   ledger.

## Phase 4 — Nice-to-haves

1. **cherry-pick PR-context cache TTL.** `_cache/pr-*.json` never expires; add a
   `fetchedAt` + age warning and an optional `--cache-age-warning`.
2. **Preserve full refute verdict** (`upstream-merge`). The refute panel returns
   `{verdict, confidence, reason, blocking}` but the ledger keeps only
   `{refuteVerdict, refuteReason}`; persist all four lenses with confidence for
   forensics and reporting.
3. **Reviewer-rejection retry loop** (`upstream-fix`). A reviewer rejection is
   terminal today. Allow a bounded (1) retry: transition back to `fixing`,
   re-dispatch the fix subagent with the reviewer's comment quoted. Track
   `reviewerRejectionCount` in the ledger.
4. **Baseline-gate auto-cleanup** (`upstream-swarm`). A failed baseline gate
   leaves `.worktrees/upstream-swarm-baseline` behind with no documented cleanup;
   wire it into the Phase-1 worktree registry and offer cleanup on `--resume`.
5. **Smarter wave bundling** (`wave-plan.mjs`) — *deferrable / optional.* Replace
   greedy file-disjoint packing with file-affinity clustering so related fixes
   bundle into a wave and test together. Largest effort, lowest urgency; may be
   dropped.

## Testing & Guardrails

- **TDD throughout** — failing test first, then implementation, for every fix and
  every new `_common` module.
- The 52-file `__tests__` suite is the Phase-1 regression net; full suite green is
  the acceptance gate after every module move.
- `schemaVersion` and `validateTransition` become **enforced invariants** in
  `base-ledger.mjs` (validate on read; throw on illegal transition at write).
- Each phase ships as its own PR with the standard four-gate discipline the skills
  themselves enforce where applicable (regression test, build, targeted + full
  suite).
- `git add -f` for all new/changed `.claude/skills/` files; obtain
  self-modification authorization at the start of each implementation session.

## Risks & Open Questions

- **Phase 1 blast radius.** Moving six shared modules touches all four skills'
  import sites at once. Mitigation: one module per commit, full suite green
  between moves; the per-module table makes each step independently revertible.
- **`base-ledger` schema migration.** Adding `schemaVersion` to existing ledgers
  on disk (`.planning/upstream-*/*.json`) needs a read-time backfill default so
  in-flight ledgers do not break. Treat older/absent version as v0 → upgrade on
  next write.
- **Open:** should `_common` be a flat `scripts/` dir or namespaced
  (`_common/ledger/`, `_common/worktree/`)? Lean flat for now (6 modules);
  revisit if it grows.
- **Open:** does `upstream-cherry-pick`'s state file migration to `base-ledger`
  belong in Phase 1 (decoupling) or deferred (it has no cross-skill import)?
  Tentatively Phase 1 for consistency; reconfirm during planning.
