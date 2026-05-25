import type { SkillPaths } from "./paths.js";

export interface PlaybookInput {
  target: string;
  workspace: string;
  skillPaths: SkillPaths;
}

/**
 * Build the orchestrator playbook the agent executes. The agent runs the stages
 * itself, dispatching general-purpose Agent workers (each told to Read a bundled
 * skill for methodology) and writing provenance-cited specs into the workspace.
 */
export function buildPlaybook({ target, workspace, skillPaths }: PlaybookInput): string {
  return `You are running OTTO excavate: reverse-engineer the codebase at \`${target}\` into raw-tier behavioral specifications with provenance. Work methodically through the stages below and then STOP. Do the analysis by dispatching workers — keep your own context for coordination.

## Dispatch rules
- Dispatch each worker with the Agent tool, subagent_type "general-purpose".
- Each worker prompt MUST include: its ROLE, an instruction to "Read the skill file at <path> in full and follow its methodology", what to READ (inputs), what to WRITE (exact output path), and the Definition of Done.
- When workers in a stage are independent, dispatch them in ONE message in parallel, but cap each batch at 4 workers. Wait for the batch, commit, then the next batch.
- Every behavioral claim a worker writes MUST carry a provenance citation: \`<!-- cite: <relative-source-file>:Lx-Ly -->\`.
- If a worker returns no output, log it and continue — the verification stage will catch gaps. If a parallel batch fails, retry those workers sequentially.

## Stage 0 — Workspace init (run directly with bash)
\`\`\`bash
WS="${workspace}"
mkdir -p "$WS"/raw/source "$WS"/raw/synthesis "$WS"/raw/specs/modules "$WS"/raw/specs/journeys "$WS"/raw/specs/contracts "$WS"/raw/specs/test-vectors "$WS"/raw/specs/validation/acceptance-criteria "$WS"/provenance
cd "$WS" && git init -q && printf '%s\\n' '.gitignore' > .gitignore 2>/dev/null || true
\`\`\`
Write \`$WS/workspace.json\` with { target: "${target}", created_at: <now>, tier: "raw", stages: [] }. Commit: \`[init] workspace for ${target}\`.

## Stage 1 — Source analysis
Dispatch ROLE source-mapper → Read \`${skillPaths["excavate-source-analysis"]}\`. Read every source file under \`${target}\` (do not skim). Decompose into modules; write per-area source notes to \`${workspace}/raw/source/\` and a module list to \`${workspace}/raw/synthesis/module-map.md\` (one \`### <module>\` heading per module). DoD: module-map.md has ≥1 module and source notes exist. Commit.

## Stage 2 — Synthesis (parallel, ≤4)
Dispatch in parallel:
- ROLE feature-discoverer → Read \`${skillPaths["excavate-synthesis"]}\`. From the source notes + module map, write a feature inventory to \`${workspace}/raw/synthesis/features.md\`.
- ROLE architecture-analyst → Read \`${skillPaths["excavate-synthesis"]}\`. Write an architecture model to \`${workspace}/raw/synthesis/architecture.md\`.
Commit after the batch.

## Stage 3 — Deep documentation (parallel, ≤4 per batch)
Read \`${workspace}/raw/synthesis/module-map.md\` for the module list. For EVERY module dispatch ROLE module-deep-dive → Read \`${skillPaths["excavate-spec-writing"]}\` (spec template + behavioral language) and \`${skillPaths["excavate-provenance"]}\` (citation format). Read the module's source exhaustively; write a behavioral spec to \`${workspace}/raw/specs/modules/<module-slug>.md\` with \`<!-- cite: file:Lx-Ly -->\` on every claim. Batch ≤4, commit per batch.
Then dispatch (parallel):
- ROLE journey-analyzer → Read \`${skillPaths["excavate-spec-writing"]}\`. Write end-to-end user journeys to \`${workspace}/raw/specs/journeys/\`.
- ROLE contract-extractor → Read \`${skillPaths["excavate-spec-writing"]}\`. Extract CLI flags, env vars, config keys to \`${workspace}/raw/specs/contracts/\`.
Commit after the batch.

## Stage 4 — Gate 1: Spec Gate (blocking, up to 3 remediation rounds)
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read \`${workspace}/raw/specs/modules/\`, \`${workspace}/raw/specs/journeys/\`, \`${workspace}/raw/specs/contracts/\`, and \`${workspace}/raw/synthesis/module-map.md\`. Check: (a) zero contradictions between specs; (b) constants/crypto values verified against source, not assumed; (c) every behavioral claim has a \`<!-- cite: -->\` provenance citation — hard gate, zero uncited claims; (d) assumed claims are a small minority; (e) every module in module-map.md has a spec. Write \`${workspace}/raw/specs/gate-1-report.md\`: first line a verdict (\`PASS\` / \`FAIL\` / \`BLOCKED\`), then for each failing criterion a finding that NAMES the offending spec file(s) and what must change, then a quantitative summary line. Commit \`[gate-1] spec gate report\`.
REMEDIATION LOOP: if the verdict is FAIL and fewer than 3 remediation rounds have run, dispatch remediation workers in a batch (≤4 — one per flagged file/area) ROLE spec-remediator → Read \`${skillPaths["excavate-spec-writing"]}\` and \`${skillPaths["excavate-provenance"]}\`. Each fixes ONLY the findings named for its file (add the missing citation, resolve the named contradiction, write the missing module's spec, correct the unverified constant) — do not rewrite passing specs. Commit \`[gate-1 round N] remediation\`. Then re-dispatch the verifier and rewrite gate-1-report.md. Repeat until the verdict is PASS or 3 rounds have run. If still FAIL after the 3rd round, set the report verdict to BLOCKED, run Stage 7 in its BLOCKED form, and STOP — do NOT run Stage 5 or Stage 6.

## Stage 5 — Test vectors & acceptance criteria (parallel, ≤4)
Dispatch in parallel:
- ROLE test-vector-generator → Read \`${skillPaths["excavate-validation"]}\`. From the module specs in \`${workspace}/raw/specs/modules/\` and contracts in \`${workspace}/raw/specs/contracts/\`, write concrete test vectors to \`${workspace}/raw/specs/test-vectors/\`: CLI invocation → expected output (and exit code), function input → output pairs, and error-condition cases. Each vector carries a \`<!-- cite: file:Lx-Ly -->\` citation. Vectors MUST be concrete input/output, never abstract descriptions.
- ROLE acceptance-criteria-writer → Read \`${skillPaths["excavate-validation"]}\`. From the module specs in \`${workspace}/raw/specs/modules/\`, write Given/When/Then acceptance criteria to \`${workspace}/raw/specs/validation/acceptance-criteria/\`: each criterion has an \`AC-{DOMAIN}-{NNN}\` ID, a priority (P0–P2), and a verification method.
Commit after the batch: \`[stage-5] test vectors + acceptance criteria\`.

## Stage 6 — Gate 2: AC Gate (blocking, up to 3 remediation rounds)
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read \`${workspace}/raw/specs/test-vectors/\` and \`${workspace}/raw/specs/validation/\`, cross-checking against \`${workspace}/raw/specs/modules/\`. Check: (a) no implementation leakage — apply the reimplementor test; (b) no P0 completeness gaps; (c) acceptance criteria have valid \`AC-{DOMAIN}-{NNN}\` IDs and link to their specs; (d) every P0 acceptance criterion has ≥1 test vector; (e) test vectors contain concrete input/output, not abstract descriptions; (f) every module has at least one acceptance criterion. Write \`${workspace}/raw/specs/gate-2-report.md\` with the same verdict / per-finding / summary format as Gate 1. Commit \`[gate-2] ac gate report\`.
REMEDIATION LOOP: same protocol as Gate 1, but remediation workers are ROLE ac-remediator → Read \`${skillPaths["excavate-validation"]}\`. Each fixes ONLY its flagged acceptance criteria / test vectors (add the missing test vector, fix the malformed AC-{DOMAIN}-{NNN} ID, abstract the leaked identifier, add the missing module's acceptance criteria). Commit \`[gate-2 round N] remediation\`, re-dispatch the verifier, up to 3 rounds. If still FAIL after the 3rd round, set gate-2-report.md to BLOCKED, run Stage 7 in its BLOCKED form, and STOP.

## Stage 7 — Summary
Print: target, workspace, modules documented, total spec files, test-vector count, acceptance-criterion count, Gate 1 verdict + rounds used, Gate 2 verdict + rounds used. If either gate is BLOCKED, lead with \`BLOCKED\`, list the unresolved findings, and note which later stages were skipped. Otherwise tell the user the specs are at \`${workspace}/raw/specs/\` (grep-able \`<!-- cite: -->\` provenance) and the gate reports at \`${workspace}/raw/specs/gate-1-report.md\` and \`${workspace}/raw/specs/gate-2-report.md\`. STOP.`;
}
