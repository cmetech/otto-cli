# OTTO `excavate` Phase 2 — Layer 4: Test Vectors + Acceptance Criteria

**Date:** 2026-05-24
**Status:** Approved — ready for implementation plan
**Builds on:** the `/otto excavate` raw-tier MVP (`2026-05-24-otto-excavate-design.md`).
**Provider target:** `claude-code` (unchanged).

## Purpose

Make excavate's specs **verifiable**. The MVP produces descriptive behavioral
specs (modules, journeys, contracts). This adds Layer 4: **concrete test vectors**
(input/output pairs) and **formal acceptance criteria** (Given/When/Then), so an
implementer can check a rebuild against measurable artifacts.

This is the first of the phase-2 sub-projects; the others (sanitized tier, formal
gates, incremental resume, more sources) are separate spec→plan cycles.

## Key finding (scopes the work small)

The bundled `excavate-validation` skill **already carries the L4 methodology**:
the AC format (`AC-{DOMAIN}-{NNN}`, Given/When/Then, verification methods) and
test-vector criteria ("test vectors have concrete input/output pairs", "P0
behaviors need test vectors"). So this sub-project is mostly a **new playbook
stage** plus a **light enrichment** of that one skill. No new TS modules, no
changes to `args.ts`/`paths.ts`/`EXCAVATE_SKILLS`, no new bundled skill.

## Decision: always-on (no flag)

L4 runs on every excavation, after L3, before verification — matching greenfield's
"test vectors are not optional" stance and keeping the CLI surface unchanged (no
new `--with-tests` flag). The run is already multi-worker, so the marginal cost is
modest.

## Scope — files touched (3)

1. `src/resources/extensions/excavate/playbook.ts` — add the L4 stage + two
   workspace dirs; the verify stage gains coverage checks; the summary gains
   counts.
2. `src/resources/extensions/excavate/tests/playbook.test.ts` — new assertions
   for the L4 stage, dirs, and roles.
3. `src/resources/skills/excavate-validation/SKILL.md` — enrich the test-vector
   section with concrete I/O examples (CLI invocation→expected output, function
   input→output, error-condition cases). Preserve all existing AC content.

### Playbook changes (`buildPlaybook`)
- **Stage 0 (init):** also `mkdir -p` `raw/specs/test-vectors` and
  `raw/specs/validation/acceptance-criteria` (alongside the existing dirs).
- **New Stage 4 — Test vectors & acceptance criteria (parallel, ≤4):**
  - ROLE `test-vector-generator` → Read `${skillPaths["excavate-validation"]}`.
    From `raw/specs/modules/` + `raw/specs/contracts/`, write concrete test
    vectors to `raw/specs/test-vectors/`: CLI invocation → expected output,
    function input → output pairs, and error-condition cases. Each vector carries
    a `<!-- cite: <file>:Lx-Ly -->` provenance citation.
  - ROLE `acceptance-criteria-writer` → Read `${skillPaths["excavate-validation"]}`.
    From `raw/specs/modules/`, write Given/When/Then acceptance criteria to
    `raw/specs/validation/acceptance-criteria/`: `AC-{DOMAIN}-{NNN}` IDs, priority
    P0–P2, and a verification method per criterion.
  - Dispatch both in one batch (≤4), then commit `[stage-4] test vectors + acceptance criteria`.
- **Stage 5 — Verification (was Stage 4):** in addition to provenance coverage +
  cross-spec consistency, also check: every P0 module has ≥1 test vector and ≥1
  AC; test vectors contain concrete input/output (not abstract descriptions); ACs
  have valid `AC-{DOMAIN}-{NNN}` IDs, Given/When/Then structure, and a verification
  method. Report gaps in `verification-report.md` (still report-only, no
  remediation loop — that's a separate phase-2 sub-project).
- **Stage 6 — Summary (was Stage 5):** also print the test-vector count and AC
  count.

### Skill enrichment (`excavate-validation`)
Add a short, concrete "Test Vector Examples" subsection with 2–3 worked examples
(a CLI invocation with expected stdout/exit code; a function input→output pair; an
error/edge case input→expected error). Keep it OTTO-neutral (no greenfield/Claude
references — re-run the leakage check after editing). Do not alter the AC section.

## Data flow
Unchanged delivery: the TS command builds the playbook and calls
`pi.sendUserMessage`. The agent now runs the extra stage after deep-docs; output
lands in the two new `raw/specs/` subdirectories.

## Error handling
A worker that yields no output → log a warning and continue; Stage 5 verification
flags the coverage gap (same posture as the MVP). No remediation loop.

## Testing
- **Unit (`playbook.test.ts`, real assertions):** the built playbook references
  `raw/specs/test-vectors` and `raw/specs/validation/acceptance-criteria`, names
  both roles (`test-vector-generator`, `acceptance-criteria-writer`), and mentions
  `AC-` and test-vector input/output. Existing playbook assertions still pass.
- **Empirical acceptance (documented as manual):** re-run `/excavate` on a tiny
  target; confirm `raw/specs/test-vectors/` holds concrete input/output vectors
  and `raw/specs/validation/acceptance-criteria/` holds Given/When/Then ACs with
  `AC-` IDs. LLM-orchestrated behavior is not unit-testable — stated, not faked.

## Out of scope
- Reference **test-spec implementations** (greenfield's separate "test specs" —
  runnable reference tests). Only vectors + acceptance criteria here.
- The other phase-2 sub-projects: sanitized/clean-room tier, formal Gate 1/Gate 2
  remediation loops, source-completeness (Gate 1b), incremental resume, additional
  intelligence sources.

## Dependency note
This extends the MVP playbook. The MVP's interactive `/excavate` invocation is
high-confidence but not yet confirmed end-to-end (headless `-p` no-ops
slash-commands; TUI path unverified). L4 rides the same delivery mechanism, so it
inherits that status — worth an interactive smoke-test of the MVP before/with
implementing this.
