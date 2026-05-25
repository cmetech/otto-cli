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
mkdir -p "$WS"/raw/source "$WS"/raw/synthesis "$WS"/raw/specs/modules "$WS"/raw/specs/journeys "$WS"/raw/specs/contracts "$WS"/provenance
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

## Stage 4 — Light verification
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read all specs in \`${workspace}/raw/specs/\`; check provenance coverage (every claim cited) and cross-spec consistency. Write \`${workspace}/raw/specs/verification-report.md\` with a PASS/FAIL line and any gaps. (No remediation loop — report only.) Commit.

## Stage 5 — Summary
Print: target, workspace, modules documented, total spec files, verification PASS/FAIL. Tell the user the specs are at \`${workspace}/raw/specs/\` with grep-able \`<!-- cite: -->\` provenance. STOP.`;
}
