# OTTO `excavate` — Codebase Reverse-Engineering (Raw-Tier MVP) Design

**Date:** 2026-05-24
**Status:** Approved — ready for implementation plan
**Provider target:** `claude-code` (this is the validated runtime; OTTO-native providers are out of scope for the MVP).

## Purpose

Ship `/otto excavate <path>` — a built-in OTTO command that reverse-engineers a
source code repository into **raw-tier behavioral specifications with provenance
citations**, adapted from the "greenfield" methodology. The PoC proved this
output is achievable under OTTO+claude-code via general-purpose subagents that
carry their role + methodology in-prompt; this design productizes that recipe.

Feature/command name: **`excavate`** (invoked as `/otto excavate`).

## Validated constraints (from the PoC — these shape everything)

1. Under the `claude-code` provider, the delegation tool is the model's native
   `Agent` tool. **Custom named agents are NOT dispatchable** (fixed built-in set:
   `claude, Explore, general-purpose, Plan, statusline-setup`). Workers must be
   `general-purpose` with role + methodology injected into their prompt.
2. TS cannot invoke the model's `Agent` tool, so **orchestration must be
   model-driven** (a playbook the agent executes), not TS-driven.
3. Bare slash-commands and prompt templates do **not** expand in headless
   `--mode json -p`. Delivery is therefore a **TS command** that injects the
   playbook as an agent turn via `pi.sendUserMessage` (`types.ts:1768`).
4. Workers reliably obtain methodology by **`Read`-ing bundled SKILL.md files**
   (proven in the PoC); `skills:` frontmatter auto-load does not apply to
   general-purpose workers.

## MVP scope — core slice (source-only)

Pipeline stages the playbook drives:
1. **Workspace init** — agent runs bash: create the `./analysis-workspace/` tree,
   `git init`, write `workspace.json`. Commit.
2. **L1 source analysis** — dispatch worker(s): read the repo, decompose into
   modules, write source notes + `raw/synthesis/module-map.md`.
3. **L2 synthesis** — parallel workers (≤4): feature inventory + architecture
   model → `raw/synthesis/`.
4. **L3 deep documentation** — parallel workers (≤4): per-module behavioral specs
   → `raw/specs/modules/`; user journeys → `raw/specs/journeys/`; contracts
   (CLI/env/config) → `raw/specs/contracts/`. Every behavioral claim carries a
   `<!-- cite: <relative-file>:Lx-Ly -->` citation.
5. **Light verification** — one worker checks provenance coverage + cross-spec
   consistency → `raw/specs/verification-report.md`. No remediation loop.
6. **Summary** — agent prints an analysis summary.

**Explicitly out of scope (phase 2):** the sanitized/clean-room tier (Layers 5–7),
test-vectors (L4), source-to-spec completeness (Gate 1b), the formal Gate 1/Gate 2
remediation loops, incremental resume, the OTTO-native provider path, and the
non-source intelligence sources (runtime, binary, web, community, git-history,
tests, visual, contracts-parsing).

## Architecture (3 units; no resource-loader change)

The existing `resource-loader.ts` already syncs `src/resources/extensions/` →
agent `extensions/` (`:626`) and `src/resources/skills/` → `~/.agents/skills`
(`:628`). Delivering via a TS extension + bundled skills needs **no loader
change** (no prompts-sync required).

### Unit 1 — TS command extension: `src/resources/extensions/excavate/`
- `index.ts`: `pi.registerCommand("excavate", …)`. Handler:
  1. Parse/validate `args` → target path (required, must exist) and optional
     `--workspace` (default `./analysis-workspace`). On invalid input: notify via
     `ctx.ui` and return without triggering a turn.
  2. Resolve the absolute paths of the 5 bundled skills (see Unit 3) — under the
     synced skills dir `~/.agents/skills/excavate-*` (with the bundled-resource
     dir as fallback if not yet synced).
  3. Build the orchestrator **playbook string** from the template, substituting
     the target path, the workspace path, and the resolved skill paths.
  4. `pi.sendUserMessage(playbook, { deliverAs: "followUp" })` to run it as the
     next agent turn (`sendUserMessage` accepts `deliverAs: "steer" | "followUp"`
     per `types.ts:1768-1771`; the exact option is confirmed during implementation).
- `playbook.ts`: exports the playbook template + a `buildPlaybook({target, workspace, skillPaths})` function (pure string construction — unit-testable).
- `paths.ts`: skill-path resolution (pure, unit-testable).
- `extension-manifest.json`: standard extension manifest.

### Unit 2 — Orchestrator playbook (content of `playbook.ts`)
A structured prompt instructing the agent to run the 6 stages above. Contains the
**worker role table**: for each role (source-mapper, feature-discoverer,
architecture-analyst, module-deep-dive, journey-analyzer, contract-extractor,
verifier) a dispatch spec of `Agent(subagent_type:"general-purpose")` with a
prompt = role + "Read `<resolved skill path>` for methodology" + inputs + output
location + definition-of-done + the provenance citation requirement. Includes the
"batch parallel dispatch, cap 4, then commit" rule and the failure-handling rules
(no output → log + continue; batch failure → retry sequentially).

### Unit 3 — Bundled methodology skills: `src/resources/skills/excavate-*/SKILL.md`
Five skills, OTTO-rebranded (Claude/greenfield/earendil/GPL references scrubbed,
prose neutral/OTTO-voiced), adapted from greenfield's:
- `excavate-source-analysis` (← greenfield-source-analysis): how to read + decompose source.
- `excavate-synthesis` (← greenfield-multi-source-synthesis): feature/architecture/module-map synthesis.
- `excavate-spec-writing` (← greenfield-behavioral-spec-writing): per-module spec template, journey + contract formats, behavioral language.
- `excavate-provenance` (← greenfield-provenance-methodology): the `<!-- cite: -->` citation format + confidence rules.
- `excavate-validation` (← greenfield-validation-methodology): the light verification criteria.

Content adapted for OTTO reality: behavioral output, general-purpose workers, the
`Read`-the-skill mechanism, OTTO tool names. Tool/dispatch references that assumed
Claude's named-agent model are rewritten.

## Output artifacts (the deliverable)

A git-versioned `./analysis-workspace/`:
```
analysis-workspace/
├── .git/ .gitignore workspace.json
├── raw/
│   ├── source/                 # source notes
│   ├── synthesis/              # features, architecture, module-map.md
│   └── specs/
│       ├── modules/            # per-module behavioral specs (provenance-cited)  ← core deliverable
│       ├── journeys/           # end-to-end user journeys
│       ├── contracts/          # CLI flags, env vars, config keys
│       └── verification-report.md
└── provenance/                 # audit-log.md (best-effort; see risk below)
```
Every behavioral claim carries `<!-- cite: file:Lx-Ly -->`. Default location
`./analysis-workspace` (relative to cwd), overridable via `--workspace`.

## Error handling
- Invalid/missing target path → handler notifies + returns; no agent turn.
- Worker produces no output → playbook: log a warning, continue; verification
  flags the gap.
- Parallel dispatch unreliable under OTTO+claude-code → cap batches at 4; on a
  batch failure, retry those workers sequentially. (An early implementation task
  confirms parallel `Agent` dispatch works headless before relying on it.)
- `./analysis-workspace/.git` already exists → MVP prints a warning and appends
  to the existing workspace (full incremental resume is phase 2).

## Testing
- **Unit (TS, real assertions):** arg parsing/validation (valid path, missing
  path, `--workspace` override); skill-path resolution (synced dir + fallback);
  `buildPlaybook` substitutes target/workspace/skill-paths correctly and lists
  all worker roles.
- **Acceptance (empirical, documented as manual):** run `/otto excavate` against
  the PoC sample target (`~/greenfield-poc/target` or an equivalent tiny repo);
  confirm the workspace tree is created and `raw/specs/modules/` contains
  provenance-cited behavioral specs covering the target's modules. LLM-orchestrated
  behavior cannot be unit-tested — this is stated, not faked.

## Risks / open items
- **Parallel dispatch** under OTTO+claude-code headless is unverified (PoC ran a
  single dispatch). First implementation task validates it; sequential fallback
  exists.
- **Provenance session capture:** greenfield harvested subagent JSONL transcripts
  for `provenance/sessions/`; OTTO's in-process subagents don't reliably write
  separate transcripts. MVP keeps spec-level `<!-- cite: -->` citations (which
  work) and treats session-replay capture as best-effort/deferred.
- **Licensing/attribution:** greenfield is a separately-licensed plugin. The user
  has confirmed the license permits bundling its methodology into OTTO and will
  handle attribution/legal separately — recorded here, not a blocker.

## Decision after MVP
If `/otto excavate` reliably produces useful provenance-cited specs, phase 2 adds:
the sanitized tier, test-vectors + acceptance criteria, the formal gates with
remediation, incremental resume, and additional intelligence sources.
