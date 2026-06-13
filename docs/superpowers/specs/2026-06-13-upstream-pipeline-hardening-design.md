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
- **Phase 2 — Fork-divergence-aware fix analysis.** The highest-value theme:
  make the pipeline understand *intent*, assess *relevance to our hard fork*, and
  classify *how* to port (direct / adapted / essence / not-needed) — and represent
  that on the issue. Absorbs the cherry-pick correctness items (a richer required
  schema subsumes the old "fail-fast on missing guidance" and verdict validation).
- **Phase 3 — Other correctness fixes.** Remaining confirmed bugs, on the clean
  base.
- **Phase 4 — Scaling.** Prioritization, timeouts, adaptive polling, structured
  abort detection.
- **Phase 5 — Nice-to-haves.** Lower-leverage polish; the largest item
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

## Phase 2 — Fork-divergence-aware fix analysis

The central insight: **otto-cli is a hard fork, not a mirror.** A useful upstream
fix may not apply — the code path may be renamed, restructured, or behaviorally
customized away. The pipeline must understand *what upstream was trying to fix*,
decide *whether that problem exists in our fork*, and port the **essence** of the
fix when the patch itself cannot be applied. The current pipeline classifies this
only *mechanically* (`cherry-pick` = paths align, `manual-port` = paths don't),
which conflates "transcribe to a renamed file" with "we've diverged in behavior,
re-solve the root cause." This phase makes the analysis intent-first and
fork-divergence-aware, and represents the result on the issue so the implementer
acts in the right mode.

### 2.1 Required guidance schema (enforced)

Every port candidate's guidance file must contain these sections; the audit
fails-fast (subsuming the old "fail-fast on missing guidance" item) if any
required section is missing or malformed, unless `--skip-guidance-check`
(audit/dry-run only):

1. **Upstream intent / root cause** — what bug or behavior was upstream fixing?
   (Not "what the diff does" — *why* it exists.)
2. **Fork relevance** — is that problem present in *our* hard fork given our
   customizations? `yes` / `partial` / `no`, with reasoning. A `no` here is the
   positive justification for `not-needed` (replaces today's bare "doesn't apply").
3. **Fix strategy** — one of the four values in §2.2 (machine-readable first line,
   replacing the bare `verdict:` line; see §2.3).
4. **Divergence** — how otto-cli's code differs from upstream here.
5. **Concrete approach** — exact edits for `direct-merge`/`adapted-port`; a design
   sketch (the *essence to preserve* + how to realize it in our code) for
   `essence-reimplement`.

Validation replaces the old single-line verdict parse: the strategy line must be
present and well-formed, and the required sections must exist, or the run errors
with the offending file path.

### 2.2 Fix-strategy taxonomy

Replaces the mechanical 3-way verdict. Machine-readable on the guidance file's
first line: `strategy: <value>`.

- `direct-merge` — cherry-pick / `git am -3` applies clean.
- `adapted-port` — same fix, transcribed to our renamed/restructured paths
  (today's `manual-port`).
- `essence-reimplement` — we've diverged in *behavior*; the patch won't apply;
  re-solve the upstream root cause in our code. Requires an **"Essence to
  preserve"** statement.
- `not-needed` — the problem does not exist in our fork (today's `do-not-port`),
  justified by a `Fork relevance: no`.

Back-compat: the parser accepts the legacy `verdict:` line and maps
`cherry-pick → direct-merge`, `manual-port → adapted-port`,
`do-not-port → not-needed`; new guidance uses `strategy:`.

### 2.3 Label dimension & issue representation

Add a new label dimension **`fix-strategy:{direct-merge,adapted-port,essence-reimplement,not-needed}`**
*alongside* the existing `type:*` labels (added to `ensure-labels.mjs` + its
tests; taxonomy count updated in `init-scaffold.test.mjs`). The two dimensions
coexist:

- New audits set both `type:*` (kept for routing back-compat) and `fix-strategy:*`.
- The ~283 already-filed issues are **not** mass-relabeled; `fix-strategy:*` is
  backfilled lazily when an issue is picked up for porting (the implementer reads
  the guidance, sets the strategy label).

`build-issue-payload.mjs` surfaces the strategy prominently in the body (its own
heading, not just a table row), and renders an explicit **"Essence to preserve"**
callout block when `strategy: essence-reimplement`, so the issue itself signals
"re-solve," not "transcribe."

### 2.4 `upstream-fix` branches on strategy

The fix subagent reads `fix-strategy` and acts accordingly:

- `direct-merge` / `adapted-port` — apply / transcribe the upstream change; the
  reviewer checks fidelity to the upstream diff.
- `essence-reimplement` — implement to the documented intent; the **reviewer gate
  checks "does this address the upstream root cause?"** rather than "does it match
  the upstream diff?" (the diff is not the spec here — the intent is).

This makes the four-confidence-gate reviewer divergence-aware instead of
diff-matching, which is the core of porting to a hard fork correctly.

### 2.5 Robust dedup — DROPPED (debunked in Phase 0)

The candidate "fuzzy dedup" finding was debunked: `dedup-check.mjs:64-65` already
post-filters on the literal `sha=<short>` trailer (the d98504e fix), so a prose
mention cannot cause a false dedup. No work needed. (Residual P5 note: a 7-char
SHA-prefix collision is theoretically possible but astronomically unlikely.)

No porting resumes until Phase 2 lands — it is the gate that makes ported fixes
*correct for our fork*, not just *present*.

## Phase 3 — Other correctness fixes

Scope = Phase-0-confirmed correctness items not covered by Phase 2:

1. **Idempotent issue lifecycle** (`_common/issue-update.mjs`). The real defect is
   the **duplicate comment** on re-run: `gh issue close` and label edits are
   already CLI-idempotent, but the comment op posts a fresh "Applied in ..."
   comment every re-run. Add a skip-if-already-commented guard (query existing
   comments / issue state before posting); skip redundant ops; never exit non-zero
   on an already-applied action. Lets `upstream-fix` Phase D and `upstream-merge`
   re-run on resume without throwing or duplicating. Test: re-run against an
   already-closed issue succeeds as a no-op and posts no second comment.
2. **Fix `status:applied` resume gap** (`select-issues.mjs:71`). `--resume`
   re-selects an issue merged outside the skill (the `status:applied` label is
   never set because the skill's Phase D labelling is the only writer). Add a guard
   (e.g. cross-check merged PRs / a local applied-ledger) so resume does not re-fix
   already-merged issues. Test: an issue whose PR merged out-of-band is excluded on
   `--resume`.

Items NOT in this phase (verified in Phase 0): the rebase classifier (debunked)
and the merge re-gate-on-resume item (debunked — the local gate is write-only
report state that resume already re-runs, so a transient flake does not
permanently block a good PR). If Phase 0 finds the
rebase-conflict→transient→retry *policy* questionable (a pure conflict rarely
self-heals on retry), reclassify it as a Phase 4 scaling/policy decision, not a
bug.

## Phase 4 — Scaling

1. **Severity-ordered swarm scheduling.** Today the scheduler is FIFO by issue
   number; there is no way to ship the 4 critical issues first. Order the work
   queue by severity (critical → feature → nice-to-have), then by number within a
   tier, while preserving file-disjoint wave constraints.
2. **Per-issue timeout / circuit-breaker.** A stuck fix lane blocks the whole
   swarm. Add a per-issue wall-clock budget; on breach, quarantine the issue and
   free the lane. Expose `--issue-timeout`.
3. **Adaptive PR polling.** `poll-pr-checks.mjs` is already non-blocking and makes
   a single `gh pr checks` call per invocation — that is not the gap. The real gap
   is `scheduler.mjs:46-48`, which re-emits one un-batched `poll-ci` action per
   `awaiting-ci` issue every tick with no backoff (each its own `gh` subprocess).
   Batch those polls by status and apply exponential backoff (double the interval
   after K consecutive no-change polls, capped). Reduces GitHub API pressure at the
   10-open-PR ceiling.
4. **Structured abort-streak detection.** Abort-streak is currently **prose-only in
   SKILL.md (no script implements it)** — `grep abortStreak` hits SKILL.md only, so
   the actual abort behavior is undefined. Phase 4 must **implement** abort-streak
   detection as a real script (not merely refine prose): replace the described raw
   `failTail` string comparison with a structured signature (stage + error class +
   first failing line) and count consecutive *identical signatures*, not
   consecutive quarantines. Add `--reset-abort-counter` so recovery does not
   require hand-editing the ledger.
5. **Rebase-retry policy** (reclassified from Phase 0). `transient-classifier.mjs`
   mechanics are correct (rebase is transient only when
   `mainShaChanged && conflictMarkers`). The open question is *policy*: decide
   whether a rebase-conflict should retry at all — a blind replay of the same diff
   rarely self-heals — and ensure the retry path **re-rebases** onto the new main
   tip rather than replaying the cached patch into the same conflicting region.

## Phase 5 — Nice-to-haves

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
5. **Allowlist-drift validation** (`upstream-merge`, `evaluate-checks.mjs:53-59`).
   The required-checks allowlist is a static `config.json`; nothing queries the
   live GitHub branch-protection set, so the allowlist silently drifts as CI checks
   are added/removed. Warn when an allowlisted check disappears from CI or a newly
   required check appears.
6. **Retry/escalate for blocked PRs** (`upstream-merge`). A `blocked` PR is
   terminal: there is no `--retry <pr>` / `--unblock`, and `--resume` skips only
   `merged`. Add a targeted retry/escalate path so a blocked PR can be re-gated
   without re-running the whole selection or hand-editing the ledger.
7. **Smarter wave bundling** (`wave-plan.mjs`) — *deferrable / optional.* Replace
   greedy file-disjoint packing with file-affinity clustering so related fixes
   bundle into a wave and test together. Largest effort, lowest urgency; may be
   dropped.
8. **Swarm refute-gate read-back** (defense-in-depth). The swarm merge action
   currently passes a hardcoded `--refute-verdict approve` because the state
   machine gates `merge-pr` on the `approved` state. Read the literal `approve`
   back from `ledger.issues[n].refute.tally.panelVerdict` instead of relying solely
   on the state machine + CLI arg, so an out-of-band `merge-pr` cannot supply
   `approve` without a recorded verdict.

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
- **The 147 existing `do-not-port` issues were classified mechanically** (paths
  don't align / reverted upstream), *before* the intent-first model. Some may
  actually be `essence-reimplement` — the upstream patch was inapplicable, but the
  underlying bug still affects our fork. Phase 2 does **not** mandate a mass
  re-audit, but it should add a lightweight `--revalidate-do-not-port` pass (or
  document the recipe) so these can be re-examined against the new `Fork
  relevance` criterion when capacity allows. Flag in the spec, decide scope at
  Phase 2 planning.
- **Essence-reimplement weakens the regression-test gate's anchor.** For
  `direct-merge`/`adapted-port`, the upstream test ports over as the regression
  gate. For `essence-reimplement` there may be no upstream test that maps —
  the implementer must *author* a regression test that pins the root cause in our
  code. Phase 2 must make this explicit in the fix-subagent contract, or
  essence ports can land without a real failing-then-passing gate.
