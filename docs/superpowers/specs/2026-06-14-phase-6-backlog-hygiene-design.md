# Upstream Pipeline — Phase 6 (Backlog Hygiene: Supersession Sweep + Alignment Fit-Check) Design

**Date:** 2026-06-14
**Status:** Approved (design); implementation plan to follow via `writing-plans`
**Owner:** Corey Ellis
**Anchor:** `docs/OTTO-ALIGNMENT.md` (the ethos/scope rubric this phase reads)
**Related:** `2026-06-13-upstream-pipeline-hardening-design.md` (Phases 0–5),
`project_otto_personas_coworker_direction` (memory)

## Problem

The hardened upstream-port pipeline (Phases 0–5) ports issues *correctly*, but the
backlog (136+ open, ~500 untriaged) accumulates two kinds of waste it can't
currently detect:

1. **Stale issues** — the upstream change was reverted, rewritten by a later
   commit, or the upstream ticket was closed as duplicate/won't-do; or a newer
   issue subsumes an older one. Porting these is wasted effort. Today dedup is
   **SHA-identity only** (`dedup-check.mjs`) — it never asks "is this still
   needed given everything that landed since?"
2. **Off-course features** — a new upstream feature may not serve OTTO's
   direction (an AI co-worker for non-technical users, not just a coding
   assistant). Nothing evaluates strategic fit; every feature looks portable.

## Goal

Add a **backlog-hygiene** capability to `/upstream-cherry-pick` that (a) detects
stale issues from upstream history, and (b) judges new-feature fit against
`OTTO-ALIGNMENT.md` — both **tag-and-explain, never auto-close** (a human always
makes the final call). Also teach the pipeline **which upstream repo is which**.

**Non-goals:** auto-closing issues; supersession Classes B (fork-state re-check)
and C (within-backlog clustering) — explicitly deferred; building the personas
system itself (this only *classifies* against it).

## Decisions (locked in brainstorming)

- **Alignment anchor** = a durable `docs/OTTO-ALIGNMENT.md` (written), cited by the
  fit-check.
- **Alignment verdict** = 3-way `alignment:{core, adjacent, out-of-scope}`,
  **feature-gated** (bug/stability/security/perf/correctness/dep fixes skip it).
- **Action posture** = auto-apply labels + evidence comments, **never auto-close**.
- **Supersession scope** = **Class A only** (deterministic upstream-history); B/C
  deferred.
- **Repo roles** = `lineage` (audited for fixes) vs `inspiration` (reference-only).
- **Home** = extend the existing `upstream-cherry-pick` skill (Option A), not a new
  skill.

## §1. Repo roles (config)

The upstream-sync config (`.planning/upstream-sync-config.json`, seeded by
`init-scaffold.mjs`, read by `parse-config.mjs`) gains a **`role`** per upstream:

- `role: "lineage"` — `pi` (`../pi`), `gsd-pi` (`../gsd-pi`). Forked lineage; the
  maintenance stream. **Audited** for fix-commits; feature candidates also run the
  §3 fit-check.
- `role: "inspiration"` — `hermes-agent` (`../hermes-agent`), `anton` (`../anton`),
  `mempalace` (`../mempalace`). Registered with local paths so subagents can read
  them during feature *design*, but **never audited** and **never cherry-picked**
  (Anton is AGPL-3.0 — reimplement, don't vendor).

`run-audit.mjs` and all sweeps **iterate `lineage` repos only**. Back-compat:
absent `role` defaults to `lineage` (existing config keeps working).

## §2. Stale-item supersession sweep (Class A — deterministic)

A new **sweep mode** on the cherry-pick orchestrator (flag `--sweep`, alias
`--revalidate-open`) that walks **open** actionable issues
(`type:port-required` + `type:cherry-pick-candidate`, excluding `status:applied`/
`status:superseded`) and, for each issue's SHA, runs three deterministic checks in
its lineage repo (new module `supersession-check.mjs`, git/gh dependency-injected,
pure core + thin I/O):

1. **Reverted** — a later commit reverts the SHA:
   `git -C <repo> log <sha>..HEAD --grep "This reverts commit <sha>"` (and the
   standard `Revert "<subject>"` form). → strong superseded signal.
2. **Rewritten** — the SHA's touched files were materially rewritten by a later
   commit on the same lines: `git -C <repo> log <sha>..HEAD --oneline -- <files>`
   plus a region check (`git log -L`/blame on the changed hunks). → candidate.
3. **Upstream-closed** — the upstream PR/issue is closed as duplicate/wontfix/
   not-planned (reuse `fetch-pr-context.mjs` + the `apply-context-upgrades.mjs`
   Rule-5 state-reason logic, run against the backlog now). → candidate.

On any hit: apply **`status:superseded`** via the idempotent `issue-update.mjs`,
post a comment citing the **evidence** (the reverting/superseding SHA, or the
closed upstream ref) and the rule that fired. **Never close.** Emit per-issue
results into the sweep report (§4).

`supersession-check.mjs` returns a structured verdict
`{ superseded: bool, rule: "reverted"|"rewritten"|"upstream-closed"|null, evidence }`
so the decision is pure/testable; the I/O (git log / gh view) is injected.

## §3. Alignment fit-check

A new label dimension **`alignment:{core, adjacent, out-of-scope}`** (added to
`ensure-labels.mjs` taxonomy + tests). **Feature-gated**: applies only to
candidates whose severity is `feature` (or that introduce a new capability);
bug/stability/security/perf/correctness/dependency candidates are **always-port,
alignment N/A**.

The verdict is **agent-judged against `OTTO-ALIGNMENT.md`** (like guidance
authoring — it is genuine reading, not a regex), recorded with a short comment
citing the §5 criterion of the alignment doc that drove it. Two entry points:

1. **File-time** (forward audit, lineage features): the guidance schema gains an
   optional **Alignment** section (parsed in `parse-guidance.mjs`); the agent sets
   `alignment:*`; `build-issue-payload.mjs` renders an **Alignment** heading and
   applies the label. `core` → normal flow; `adjacent`/`out-of-scope` → surfaced.
2. **Backlog re-check** (the §2 sweep also covers this): re-evaluate existing open
   **feature** issues against the *current* `OTTO-ALIGNMENT.md` and (re)apply
   `alignment:*` + comment. Advisory; **never auto-closes**.

Verdict semantics (from the alignment doc): `core` = advances the co-worker
direction (personas/soul/outcomes/non-technical-UX/local-data/integrations a
persona or app-package would expose) → port; `adjacent` = useful but off the
critical path → **defer**; `out-of-scope` = coding-assistant-only or ethos-
conflicting → surface for a human to close. When torn, prefer `adjacent`.

## §4. Output — triage report

Each sweep writes a plain-language report to
`.planning/upstream-audits/<date>-backlog-sweep.md` (a `write-report.mjs` variant):
the issues newly tagged `status:superseded` (with the superseding evidence) and the
feature issues tagged `adjacent`/`out-of-scope` (with the reason) — so a human, or
the swarm's selection, skips them. Plus counts. No issue is closed by the tool.

## Components & files

**New:**
- `.claude/skills/upstream-cherry-pick/scripts/supersession-check.mjs` (+ test) —
  Class-A detectors (pure core, DI git/gh).
- A sweep entry in `run-audit.mjs` (`--sweep`/`--revalidate-open`) orchestrating
  §2 + §3 backlog re-check + §4 report.
- `docs/OTTO-ALIGNMENT.md` — **already written** in this session.

**Modified:**
- `parse-config.mjs` / `init-scaffold.mjs` — `role` field per upstream (+ seed the
  3 inspiration repos; default `lineage`).
- `run-audit.mjs` — iterate `lineage` only; file-time feature alignment; sweep mode.
- `ensure-labels.mjs` (+ `init-scaffold.test`, `ensure-labels.test`) — add
  `status:superseded` + 3 `alignment:*` labels (taxonomy 23 → **27**).
- `parse-guidance.mjs` — optional Alignment section (feature candidates).
- `build-issue-payload.mjs` (+ test) — render Alignment heading + apply
  `alignment:*` label for features.
- `upstream-cherry-pick/SKILL.md` — document repo roles, the sweep, the fit-check,
  and the lineage/inspiration rule (cite `OTTO-ALIGNMENT.md`).

**Reused:** `issue-update.mjs` (idempotent label/comment — Phase 3), the
`--revalidate-do-not-port` pattern (Phase 2) as the sweep's sibling,
`fetch-pr-context.mjs` + `apply-context-upgrades.mjs` Rule-5 (upstream-closed).

## Testing

- TDD throughout; DI for git/gh (no network) — same pattern as Phases 2–5.
- `supersession-check.mjs`: pure-verdict tests for each rule (reverted/rewritten/
  upstream-closed) + no-hit; DI stubs for git log + gh view.
- alignment: label-taxonomy count, payload rendering, guidance Alignment-section
  parse, feature-gating (non-feature → no alignment label).
- Run the **canonical suite**: `node .claude/skills/_common/scripts/run-skill-tests.mjs`
  (recursive, incl. integration; baseline 409 green).

## Scope / deferred

- **Class B** (re-check fork-relevance vs current otto-cli HEAD) and **Class C**
  (within-backlog file-overlap clustering) — deferred; revisit after Class A proves
  out on the real backlog.
- The personas/soul system itself is **not** built here — Phase 6 only classifies
  candidates against the documented direction.

## Risks & open questions

- **Alignment is judgment.** The verdict is agent-reasoned against a living doc, so
  it will drift as the roadmap drifts — mitigated by "never auto-close" + human
  gate, and by updating `OTTO-ALIGNMENT.md` first when direction changes.
- **`rewritten` detector precision.** Region-level rewrite detection (rule 2) is
  the least precise Class-A signal; if it false-positives, downgrade it to an
  advisory-only flag (report it, don't apply `status:superseded`) and rely on
  `reverted` + `upstream-closed` as the auto-tagging rules. Decide during planning.
- **Inspiration-repo drift.** The 3 inspiration repos must exist as siblings for
  subagents to read during feature design; if absent, feature design falls back to
  the web references in `OTTO-ALIGNMENT.md`. The sweep never needs them (lineage
  only), so their absence does not break hygiene runs.
