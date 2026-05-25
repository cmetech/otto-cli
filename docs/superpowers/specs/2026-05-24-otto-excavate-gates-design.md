# OTTO `excavate` Phase 2 — Formal Gates + Remediation Design

**Date:** 2026-05-24
**Status:** Approved — ready for implementation plan
**Builds on:** the `/excavate` raw-tier MVP (`2026-05-24-otto-excavate-design.md`) and
the Layer 4 sub-project (`2026-05-24-otto-excavate-l4-design.md`).
**Provider target:** `claude-code` (unchanged).

## Purpose

Replace excavate's single **report-only** verification stage with two **formal
quality gates that remediate**. Today Stage 5 runs one verifier that writes
findings and proceeds regardless — a failing spec still ships. This sub-project
makes the gates blocking: each gate, on failure, dispatches targeted remediation
workers and re-checks, up to a fixed number of rounds, then hard-STOPs the
pipeline if findings remain. This is the greenfield "specs you'd trust enough to
implement from" stance, adapted to OTTO's playbook-driven orchestration.

This is a phase-2 sub-project; the others (sanitized tier, source-to-spec
completeness, incremental resume, more intelligence sources) are separate
spec→plan cycles.

## Locked decisions (from brainstorming)

1. **Two gates, greenfield-faithful.** Gate 1 (Spec Gate) runs after the deep-docs
   stage, *before* L4 — so contradictory or uncited specs never reach test-vector
   generation. Gate 2 (AC Gate) runs after L4.
2. **Hard STOP on exhaustion.** If a gate still FAILs after the last remediation
   round, the pipeline stops: later stages do not run, and the summary reports
   BLOCKED with the unresolved findings. A blocked Gate 1 means L4 and Gate 2
   never run.
3. **3 remediation rounds per gate** (greenfield-faithful), expressed as fixed
   prose in the playbook ("up to 3 rounds").
4. **Targeted remediation (Approach A).** The gate report maps each failing
   criterion to the specific offending spec file(s). Remediation dispatches
   workers only for those files (batch ≤4), each fixing its named findings — not a
   full-stage rewrite. Keeps token cost bounded so re-looping 3× is affordable.
5. **Separate gate reports:** `raw/specs/gate-1-report.md` and
   `raw/specs/gate-2-report.md` (the old single `verification-report.md` is
   retired).

## Key finding (scopes the work small)

The bundled `excavate-validation` skill **already carries the gate criteria** (a
"Spec Gate" checklist and an "Acceptance-Criteria Gate" checklist) and a
remediation flowchart whose terminal state is "Attempts exhausted → STOP:
Blocked". So this sub-project is mostly a **playbook restructure** plus a **light
enrichment** of that one skill to name the gates and pin the remediation protocol.
No new TS modules, no changes to `args.ts`/`paths.ts`/`EXCAVATE_SKILLS`, no new
bundled skill — the same shape as the L4 sub-project.

## Scope — files touched (3)

1. `src/resources/extensions/excavate/playbook.ts` — restructure the verify stage
   into two gates with remediation loops; renumber stages.
2. `src/resources/extensions/excavate/tests/playbook.test.ts` — new assertions for
   both gates, the remediation loop, the round cap, the hard-STOP/BLOCKED posture,
   and the gate-report paths. Existing assertions still pass.
3. `src/resources/skills/excavate-validation/SKILL.md` — light enrichment: name the
   gates Gate 1 / Gate 2, add a Remediation Loop subsection and a Gate Report
   Format subsection. Preserve all existing AC and test-vector content.

### Stage layout (`buildPlaybook`)

| Stage | MVP+L4 (current) | After this change |
|-------|------------------|-------------------|
| 0 | Workspace init | unchanged |
| 1 | Source analysis | unchanged |
| 2 | Synthesis | unchanged |
| 3 | Deep documentation | unchanged |
| **4** | *(was test-vectors)* | **Gate 1 — Spec Gate + remediation loop** (NEW) |
| **5** | *(was report-only verify)* | **Test vectors & acceptance criteria** (was Stage 4 content) |
| **6** | *(was summary)* | **Gate 2 — AC Gate + remediation loop** (replaces report-only verify) |
| **7** | — | **Summary** (was Stage 6; gains gate-status lines) |

### Stage 4 — Gate 1 (Spec Gate)

Dispatch ROLE `verifier` → Read `${skillPaths["excavate-validation"]}`. Read
`raw/specs/{modules,journeys,contracts}/`. Check:

- Zero contradictions between specs.
- Constants/crypto values verified against source, not assumed.
- Every behavioral claim has a `<!-- cite: -->` provenance citation (hard gate —
  zero uncited claims).
- Assumed claims are a small minority; most claims have direct evidence.
- All modules in `raw/synthesis/module-map.md` have a spec.

Write `raw/specs/gate-1-report.md`: a verdict line (`PASS` / `FAIL` / `BLOCKED`),
then per failing criterion a finding that **names the offending spec file(s)**.
Commit `[gate-1] spec gate report`.

**Remediation loop:** if the verdict is FAIL and the round count is < 3, dispatch
remediation workers (batch ≤4) — one per flagged file/area — ROLE
`spec-remediator` → Read `${skillPaths["excavate-spec-writing"]}` +
`${skillPaths["excavate-provenance"]}`. Each fixes only the findings named for its
file (add the missing citation, resolve the specific contradiction, document the
missing module, correct the unverified constant). Commit
`[gate-1 round N] remediation`. Re-dispatch the verifier and rewrite the report.
Repeat until PASS or 3 rounds elapse.

**On exhaustion** (still FAIL after round 3): set the report verdict to BLOCKED,
print the BLOCKED summary (Stage 7's blocked form), and STOP. Do not run Stage 5+.

### Stage 5 — Test vectors & acceptance criteria

Identical content to the current Stage 4 (`test-vector-generator` and
`acceptance-criteria-writer` in one ≤4 batch, commit
`[stage-5] test vectors + acceptance criteria`). Only the stage number changes.

### Stage 6 — Gate 2 (AC Gate)

Dispatch ROLE `verifier` → Read `${skillPaths["excavate-validation"]}`. Read
`raw/specs/{test-vectors,validation}/` and cross-check against
`raw/specs/modules/`. Check:

- No implementation leakage in specs/ACs (the reimplementor test).
- No P0 completeness gaps.
- ACs have valid `AC-{DOMAIN}-{NNN}` IDs and link to their specs.
- Every P0 AC has ≥1 test vector.
- Test vectors are concrete input/output (not abstract descriptions).
- All modules have ACs.

Write `raw/specs/gate-2-report.md` with the same verdict/finding format. Commit
`[gate-2] ac gate report`.

**Remediation loop:** same protocol as Gate 1, but remediation workers are ROLE
`ac-remediator` → Read `${skillPaths["excavate-validation"]}`, fixing flagged ACs
/ test vectors (add the missing vector, fix the malformed AC ID, abstract the
leaked identifier, add the missing module's ACs). Commit
`[gate-2 round N] remediation`, re-run the verifier, up to 3 rounds.

**On exhaustion:** verdict BLOCKED, BLOCKED summary, STOP.

### Stage 7 — Summary

Print: target, workspace, modules documented, total spec files, test-vector count,
acceptance-criterion count, **Gate 1 verdict + rounds used**, **Gate 2 verdict +
rounds used**. If either gate is BLOCKED, the summary leads with `BLOCKED` and
lists the unresolved findings (and notes which later stages were skipped). Tell the
user where the gate reports and specs live. STOP.

### Skill enrichment (`excavate-validation`)

The skill already has the gate checklists and the remediation flowchart. Add,
without altering the AC or test-vector sections:

- **Gate naming:** label the existing "Spec Gate" as **Gate 1 (Spec Gate)** and
  "Acceptance-Criteria Gate" as **Gate 2 (AC Gate)** so the skill vocabulary
  matches the playbook.
- **Remediation Loop subsection:** the remediator fixes *only* the findings named
  for its file; the orchestrator re-runs the gate after each round; up to 3 rounds;
  on exhaustion the gate verdict is BLOCKED and the pipeline stops. (This mirrors
  the existing flowchart in prose so a worker reading the skill knows the
  protocol.)
- **Gate Report Format subsection:** verdict line is one of `PASS` / `FAIL` /
  `BLOCKED`; each failing criterion is a finding that names the offending file(s)
  and what must change. Quantitative summary line (criteria checked, findings,
  coverage %).

Keep it OTTO-neutral (no greenfield/Claude/earendil references); re-run the
leakage check after editing.

## Data flow

Unchanged delivery: the TS command builds the playbook and calls
`pi.sendUserMessage`. The agent runs the new gate stages itself, dispatching
verifier and remediation workers and writing the two gate reports into
`raw/specs/`.

## Error handling

- A worker that yields no output during remediation → log a warning; the next gate
  re-run catches the still-open finding (and counts a round).
- The hard-STOP path *is* the error-handling posture for unfixable findings: the
  run ends BLOCKED with the findings recorded, rather than shipping bad specs.
- Existing posture for non-gate stages (worker no-output → log + continue) is
  unchanged.

## Testing

- **Unit (`playbook.test.ts`, real assertions):** the built playbook (a) names both
  gates and places Gate 1 before the test-vector stage and Gate 2 after it; (b)
  contains the remediation-loop language including the 3-round cap and the
  hard-STOP/BLOCKED wording; (c) references `raw/specs/gate-1-report.md` and
  `raw/specs/gate-2-report.md`; (d) mentions the `spec-remediator` and
  `ac-remediator` roles; (e) lists the Gate 1 and Gate 2 criteria keywords (e.g.
  "contradiction", "implementation leakage", "P0"). Existing L4 and MVP assertions
  still pass.
- **Empirical acceptance (documented as manual):** re-run `/excavate` on a tiny
  target; confirm `gate-1-report.md` and `gate-2-report.md` appear with PASS/FAIL
  verdicts, and that injecting a defect (e.g. an uncited claim) triggers at least
  one `[gate-1 round 1] remediation` commit before PASS. LLM-orchestrated behavior
  is not unit-testable — stated, not faked.

## Out of scope

- **Gate 1b — source-to-spec completeness** (grep source for tools/flags/env vars,
  diff vs specs). Separate phase-2 sub-project.
- **Layer 6/7 gates** (second-pass review, fidelity validation) — those belong to
  the sanitized/clean-room tier sub-project.
- **Incremental resume**, additional intelligence sources, the OTTO-native provider
  path.

## Dependency note

This extends the L4 playbook. The interactive `/excavate` invocation is
high-confidence but not yet confirmed end-to-end (headless `-p` no-ops
slash-commands; the headless-invocation fix is a separate open item). The gates
ride the same delivery mechanism, so they inherit that status — an interactive or
RPC-mode smoke-test remains the way to validate empirically.
