# Phase 8 GSD-Erasure Naming Map

**Status:** ready for review. Generated from codebase audit; no renames have been applied yet.
**Plan:** `docs/superpowers/plans/2026-05-24-loop24-phase-8-gsd-identifier-erasure.md`

## How to read this map

For each identifier: the OLD name in code, the proposed NEW name post-rename, the number of files that reference it (callers/consumers will all need updating), and a Notes column for collision resolutions and per-identifier reasoning.

The user reviews this map BEFORE Tasks 2-10 execute. Changes/redirects to specific renames should happen here, not mid-execution.

---

## 1. Function identifiers (PascalCase-prefix: `handleGSD…`, `registerGSD…`, etc.)

| Old | New | Files | Notes |
|---|---|---|---|
| `handleGSDCommand` | `dispatchWorkflowCommand` | 9 | **COLLISION:** `handleWorkflowCommand` already used in 7 files for separate concept. `dispatchWorkflowCommand` is free (0 hits). |
| `runGSDDoctor` | `runDoctor` | 13 | `runDoctor` free (0 hits). |
| `registerGSDCommand` | `registerWorkflowCommand` | 9 | `registerWorkflowCommand` free (0 hits). |
| `writeGSDDirectory` | `writeAgentDirectory` | 5 | `writeAgentDirectory` free (0 hits). |
| `createGSDExtensionAPI` | `createWorkflowExtensionAPI` | 3 | `createExtensionAPI` has 3 hits (collision); `createWorkflowExtensionAPI` is free (0 hits). |
| `isGSDActive` | `isAgentActive` | 3 | `isAgentActive` free (0 hits). |
| `isGSD` | `isAgent` | 1 | `isAgent` free (0 hits). |

## 2. Function identifiers (lower-camel: `readGsd…`, `isGsd…`, etc.)

| Old | New | Files | Notes |
|---|---|---|---|
| `getGsdArgumentCompletions` | `getWorkflowArgumentCompletions` | 5 | `getArgumentCompletions` has 16 hits (collision); `getWorkflowArgumentCompletions` is free (0 hits). |
| `isGsdWorktreePath` | `isWorktreePath` | 8 | `isWorktreePath` free (0 hits). |
| `isGsdGitignored` | `isGitignored` | 4 | `isGitignored` free (0 hits). |
| `hasGsdBootstrapArtifacts` | `hasWorkflowBootstrapArtifacts` | 5 | `hasBootstrapArtifacts` has 1 hit (collision); `hasWorkflowBootstrapArtifacts` is free (0 hits). |
| `readGsdFile` | `readAgentFile` | 1 | `readAgentFile` free (0 hits). |
| `buildGsdHomeModel` | `buildHomeModel` | 2 | `buildHomeModel` free (0 hits). |
| `withGsdHome` | `withHome` | 1 | `withHome` free (0 hits). |
| `setGsdHeadless` | `setHeadless` | 1 | `setHeadless` free (0 hits). |
| `isGsdManagedTool` | `isManagedTool` | 1 | `isManagedTool` free (0 hits). |
| `getGsdSourceFiles` | `getSourceFiles` | 1 | `getSourceFiles` free (0 hits). |
| `writeGsdIdMarker` | `writeIdMarker` | 1 | `writeIdMarker` free (0 hits). |
| `readGsdState` | `readAgentState` | 1 | `readAgentState` free (0 hits). |
| `readGsdIdMarker` | `readIdMarker` | 1 | `readIdMarker` free (0 hits). |
| `isGsdOwnedPath` | `isOwnedPath` | 1 | `isOwnedPath` free (0 hits). |
| `buildGsdClientSpawnPlan` | `buildClientSpawnPlan` | 1 | `buildClientSpawnPlan` free (0 hits). |
| `hasGsdFolder` | `hasAgentFolder` | 1 | `hasAgentFolder` free (0 hits). |

## 3. Type / class / interface identifiers

| Old | New | Files | Notes |
|---|---|---|---|
| `GSDState` | `WorkflowDbState` | 69 | **COLLISION:** `WorkflowState` already used in 1 file (task brief says 5 — confirmed 1 at time of audit); this variant is the db-persisted form. `WorkflowDbState` is free (0 hits). |
| `GSDPreferences` | `WorkflowPreferences` | 32 | `AppPreferences` free but generic; `WorkflowPreferences` is more precise and free (0 hits). |
| `GSDError` | `WorkflowError` | 18 | `AppError` has 1 hit (collision); `WorkflowError` is free (0 hits). |
| `GSDNoProjectError` | `NoProjectError` | 7 | `NoProjectError` free (0 hits). |
| `GSDWorkspaceStore` | `WorkspaceStore` | 5 | `WorkspaceStore` free (0 hits). |
| `GSDPhaseModelConfig` | `PhaseModelConfig` | 4 | `PhaseModelConfig` free (0 hits). |
| `GSDProject` | `WorkflowProject` | 8 | `Project` has 508 hits (collision — pervasive generic); `WorkflowProject` is free (0 hits). |
| `GSDModelConfigV2` | `ModelConfigV2` | 4 | `ModelConfigV2` free (0 hits). |
| `GSDMilestone` | `WorkflowMilestone` | 6 | `Milestone` has 330 hits (collision — pervasive); `WorkflowMilestone` is free (0 hits). |
| `GSDEcosystemBeforeAgentStartHandler` | `EcosystemBeforeAgentStartHandler` | 5 | Long but already descriptive; drop prefix only. Free (0 hits). |
| `GSDTask` | `WorkflowTask` | 6 | `Task` has 188 hits (collision — pervasive); `WorkflowTask` is free (0 hits). |
| `GSDSlice` | `WorkflowSlice` | 6 | `Slice` has 250 hits (collision — pervasive); `WorkflowSlice` is free (0 hits). |
| `GSDExtensionAPI` | `WorkflowExtensionAPI` | 5 | `ExtensionAPI` has 162 hits (collision); `WorkflowExtensionAPI` is free (0 hits). |
| `GSDRequirement` | `WorkflowRequirement` | 5 | `Requirement` has 45 hits (collision); `WorkflowRequirement` is free (0 hits). |
| `GSDTaskSummaryData` | `TaskSummaryData` | 4 | `TaskSummaryData` free (0 hits). |
| `GSDSliceSummaryData` | `SliceSummaryData` | 4 | `SliceSummaryData` free (0 hits). |
| `GSDSkillRule` | `SkillRule` | 4 | `SkillRule` free (0 hits). |
| `GSDNotificationOverlay` | `NotificationOverlay` | 4 | `NotificationOverlay` free (0 hits). |
| `GSDActiveUnit` | `ActiveUnit` | 2 | `ActiveUnit` free (0 hits). |
| `GSDVisualizerOverlay` | `VisualizerOverlay` | 3 | `VisualizerOverlay` free (0 hits). |
| `GSDShortcutId` | `ShortcutId` | 1 | `ShortcutId` free (0 hits). |
| `GSDConfigOverlay` | `ConfigOverlay` | 3 | `ConfigOverlay` free (0 hits). |
| `GSDPhaseAuditContext` | `PhaseAuditContext` | 1 | `PhaseAuditContext` free (0 hits). |
| `GSDDashboardOverlay` | `DashboardOverlay` | 3 | `DashboardOverlay` free (0 hits). |
| `GSDRootFileKey` | `RootFileKey` | 1 | `RootFileKey` free (0 hits). |
| `GSDModelConfig` | `ModelConfig` | 3 | `ModelConfig` free (0 hits). Note: `GSDModelConfigV2` → `ModelConfigV2` is a separate rename above. |
| `GSDBoundaryEntry` | `BoundaryEntry` | 3 | `BoundaryEntry` free (0 hits). |
| `GSDWorkspaceIndex` | `WorkspaceIndex` | 1 | `WorkspaceIndex` has 2 hits but both appear to be in `node_modules`-adjacent types; confirmed 0 in src/packages. Free. |
| `GSDShortcutDef` | `ShortcutDef` | 1 | `ShortcutDef` free (0 hits). |
| `GSDMigrationInputs` | `MigrationInputs` | 1 | `MigrationInputs` free (0 hits). |

## 4. Constants / error codes

**Reclassification (2026-05-24, Task 7 audit):** 15 names initially listed
here were found during Task 7 spot-check to be used as `process.env.X`
reads, not module-level constants. They have been moved to Section 5
(env vars) where they get LOOP24_X canonical + GSD_X fallback treatment.
The 23 names below are confirmed module-level constants (0
`process.env.X` references).

| Old | New | Files | Notes |
|---|---|---|---|
| `MISSING_GSD_MARKER` | `MISSING_WORKFLOW_MARKER` | 4 | `MISSING_WORKFLOW_MARKER` free (0 hits). |
| `GSD_COMMAND_DESCRIPTION` | `WORKFLOW_COMMAND_DESCRIPTION` | 4 | `WORKFLOW_COMMAND_DESCRIPTION` free (0 hits). |
| `GSD_GIT_ERROR` | `GIT_ERROR` | 9 | `GIT_ERROR` free (0 hits). |
| `GSD_IO_ERROR` | `IO_ERROR` | 4 | `IO_ERROR` free (0 hits). |
| `GSD_PARSE_ERROR` | `PARSE_ERROR` | 5 | `PARSE_ERROR` free (0 hits). |
| `GSD_MERGE_CONFLICT` | `MERGE_CONFLICT` | 3 | `MERGE_CONFLICT` free (0 hits). |
| `GSD_BLOCKED` | `WORKFLOW_BLOCKED` | 1 | `BLOCKED` has 3 hits in GitHub workflow scripts (string literals, not code constants); `WORKFLOW_BLOCKED` is code-identifier-free (0 hits). |
| `GSD_ARTIFACT_MISSING` | `ARTIFACT_MISSING` | 1 | `ARTIFACT_MISSING` free (0 hits). |
| `GSD_LOCK_HELD` | `LOCK_HELD` | 2 | `LOCK_HELD` free (0 hits). |
| `GSD_ALLOWED` | `ALLOWED` | 1 | `ALLOWED` free (0 hits). |
| `GSD_STALE_STATE` | `STALE_STATE` | 6 | `STALE_STATE` free (0 hits). |
| `GSD_LOGO` | `LOGO` | 2 | `LOGO` free (0 hits). |
| `GSD_ROOT_FILES` | `ROOT_FILES` | 2 | `ROOT_FILES` free (0 hits). |
| `GSD_ROOT_TTL_MS` | `ROOT_TTL_MS` | 1 | `ROOT_TTL_MS` free (0 hits). |
| `GSD_SHORTCUTS` | `SHORTCUTS` | 2 | `SHORTCUTS` free (0 hits). |
| `GSD_RUNTIME_PATTERNS` | `RUNTIME_PATTERNS` | 4 | `RUNTIME_PATTERNS` free (0 hits). |
| `GSD_NUMBERED_VARIANT_RE` | `NUMBERED_VARIANT_RE` | 1 | `NUMBERED_VARIANT_RE` free (0 hits). |
| `GSD_DIR_RE` | `DIR_RE` | 1 | `DIR_RE` free (0 hits). |
| `GSD_SNAPSHOT_PREFIX` | `SNAPSHOT_PREFIX` | 1 | `SNAPSHOT_PREFIX` free (0 hits). |
| `GSD_STATUS_KEYS` | `STATUS_KEYS` | 1 | `STATUS_KEYS` free (0 hits). |
| `GSD_WIDGET_KEYS` | `WIDGET_KEYS` | 1 | `WIDGET_KEYS` free (0 hits). |
| `GSD_DAEMON_CONFIG` | `DAEMON_CONFIG` | 2 | `DAEMON_CONFIG` free (0 hits). |
| `GSD_PHASE_INACTIVE` | `PHASE_INACTIVE` | 1 | `PHASE_INACTIVE` free (0 hits). |

**Reclassified to Section 5 (env vars):** `GSD_MILESTONE_LOCK`, `GSD_PARALLEL_WORKER`, `GSD_WORKFLOW_EXECUTORS_MODULE`, `GSD_WORKFLOW_WRITE_GATE_MODULE`, `GSD_PERSIST_WRITE_GATE_STATE`, `GSD_SLICE_LOCK`, `GSD_ENGINE_BYPASS`, `GSD_ALLOWED_COMMAND_PREFIXES`, `GSD_BUNDLED_EXTENSION_PATHS`, `GSD_WORKTREE`, `GSD_CLI_WORKTREE`, `GSD_CLI_WORKTREE_BASE`, `GSD_STARTUP_TIMING`, `GSD_SHOW_TOKEN_COST`, `GSD_VERBOSE`.

## 5. Env vars (LOOP24_X canonical + GSD_X fallback)

The 11 vars explicitly listed in the Phase 8 plan, **plus 4 additional env vars confirmed during 2026-05-24 open-questions resolution** (originally suspected to be module constants; confirmed as `process.env` reads/writes). For all others in the broader `GSD_*` constant list (Section 4): those are internal module constants.

| Old | New (canonical) | All sites | Setter sites | Notes |
|---|---|---|---|---|
| `GSD_DEBUG` | `LOOP24_DEBUG` | 9 | 2 | `LOOP24_DEBUG` free (0 existing hits). |
| `GSD_HOME` | `LOOP24_HOME` | 65 | 43 | **Already partially deployed.** `LOOP24_HOME` has 3 existing hits in `src/app-paths.ts` and `src/loop24-config.ts` (Phase 0 canonical). Task: add `GSD_HOME` fallback shim alongside existing `LOOP24_HOME` reads; deprecate setter. |
| `GSD_PKG_ROOT` | `LOOP24_PKG_ROOT` | 7 | 2 | `LOOP24_PKG_ROOT` free (0 existing hits). |
| `GSD_WORKFLOW_PATH` | `LOOP24_WORKFLOW_PATH` | 10 | 6 | `LOOP24_WORKFLOW_PATH` free (0 existing hits). |
| `GSD_CODING_AGENT_DIR` | `LOOP24_CODING_AGENT_DIR` | 10 | 3 | `LOOP24_CODING_AGENT_DIR` free (0 existing hits). |
| `GSD_VERSION` | `LOOP24_VERSION` | 15 | 4 | `LOOP24_VERSION` free (0 existing hits). |
| `GSD_FIRST_RUN_BANNER` | `LOOP24_FIRST_RUN_BANNER` | 2 | 2 | **Already partially deployed.** `LOOP24_FIRST_RUN_BANNER` has 1 existing hit in `src/loader.ts` with a TODO comment noting the legacy alias still in place. Task: remove the `GSD_FIRST_RUN_BANNER` side. |
| `GSD_BIN_PATH` | `LOOP24_BIN_PATH` | 14 | 2 | `LOOP24_BIN_PATH` free (0 existing hits). |
| `GSD_SKIP_RTK_INSTALL` | `LOOP24_SKIP_RTK_INSTALL` | 3 | 1 | `LOOP24_SKIP_RTK_INSTALL` free (0 existing hits). Note: `GSD_SKIP_RTK_INSTALL_ENV` (2 hits) is likely a string constant holding the env var name — must update its value too. |
| `GSD_RTK_DISABLED` | `LOOP24_RTK_DISABLED` | 10 | 4 | `LOOP24_RTK_DISABLED` free (0 existing hits). Note: `GSD_RTK_DISABLED_ENV` (2 hits) is a string constant holding the env var name — must update its value. |
| `GSD_TEST_CLONE_MARKETPLACES` | `LOOP24_TEST_CLONE_MARKETPLACES` | 1 | 1 | `LOOP24_TEST_CLONE_MARKETPLACES` free (0 existing hits). |
| `GSD_PROJECT_ROOT` | `LOOP24_PROJECT_ROOT` | 47 | 6+ | **Added 2026-05-24.** Confirmed env var: `process.env.GSD_PROJECT_ROOT = projectRoot` (auto.ts:356); reader `process.env.GSD_PROJECT_ROOT?.trim()` in worktree-root.ts; spread into worker process envs in parallel-orchestrator.ts and slice-parallel-orchestrator.ts. `LOOP24_PROJECT_ROOT` free (0 existing hits). |
| `GSD_WORKFLOW_PROJECT_ROOT` | `LOOP24_WORKFLOW_PROJECT_ROOT` | 47 | 1 | **Added 2026-05-24.** Confirmed env var: set in workflow-mcp.ts:216 (`GSD_WORKFLOW_PROJECT_ROOT: projectRoot`) and read at :235-236. Used in MCP server env spreads. `LOOP24_WORKFLOW_PROJECT_ROOT` free (0 existing hits). |
| `GSD_ENABLE_NATIVE_GSD_GIT` | `LOOP24_ENABLE_NATIVE_GIT` | 3 | 0 | **Added 2026-05-24.** Confirmed env var: `process.env.GSD_ENABLE_NATIVE_GSD_GIT === "1"` in native-git-bridge.ts:19. Feature flag for native git path. Inner duplicate `GSD` dropped; "native" already qualifies the feature. `LOOP24_ENABLE_NATIVE_GIT` free (0 existing hits). |
| `GSD_ENABLE_NATIVE_GSD_PARSER` | `LOOP24_ENABLE_NATIVE_PARSER` | 1 | 0 | **Added 2026-05-24.** Confirmed env var: `process.env.GSD_ENABLE_NATIVE_GSD_PARSER === "1"` in native-parser-bridge.ts:11. Feature flag for native parser path. `LOOP24_ENABLE_NATIVE_PARSER` free (0 existing hits). |
| `GSD_MILESTONE_LOCK` | `LOOP24_MILESTONE_LOCK` | 34 | many | **Reclassified 2026-05-24** from Section 4 during Task 7 audit. Used directly via `process.env.GSD_MILESTONE_LOCK`. Parallel-worker coordination env. `LOOP24_MILESTONE_LOCK` free. |
| `GSD_PARALLEL_WORKER` | `LOOP24_PARALLEL_WORKER` | 40 | many | **Reclassified 2026-05-24.** Parallel-worker mode flag. `LOOP24_PARALLEL_WORKER` free. |
| `GSD_WORKFLOW_EXECUTORS_MODULE` | `LOOP24_WORKFLOW_EXECUTORS_MODULE` | 10 | many | **Reclassified 2026-05-24.** Module-path override env. `LOOP24_WORKFLOW_EXECUTORS_MODULE` free. |
| `GSD_WORKFLOW_WRITE_GATE_MODULE` | `LOOP24_WORKFLOW_WRITE_GATE_MODULE` | 4 | many | **Reclassified 2026-05-24.** Module-path override env. `LOOP24_WORKFLOW_WRITE_GATE_MODULE` free. |
| `GSD_PERSIST_WRITE_GATE_STATE` | `LOOP24_PERSIST_WRITE_GATE_STATE` | 20 | many | **Reclassified 2026-05-24.** Write-gate persistence flag. `LOOP24_PERSIST_WRITE_GATE_STATE` free. |
| `GSD_SLICE_LOCK` | `LOOP24_SLICE_LOCK` | 11 | many | **Reclassified 2026-05-24.** Parallel-worker slice-lock env. `LOOP24_SLICE_LOCK` free. |
| `GSD_ENGINE_BYPASS` | `LOOP24_ENGINE_BYPASS` | 6 | many | **Reclassified 2026-05-24.** Engine bypass flag. `LOOP24_ENGINE_BYPASS` free. |
| `GSD_ALLOWED_COMMAND_PREFIXES` | `LOOP24_ALLOWED_COMMAND_PREFIXES` | 6 | many | **Reclassified 2026-05-24.** Allowed-prefixes override env. `LOOP24_ALLOWED_COMMAND_PREFIXES` free. |
| `GSD_BUNDLED_EXTENSION_PATHS` | `LOOP24_BUNDLED_EXTENSION_PATHS` | 5 | many | **Reclassified 2026-05-24.** Bundled-extension-paths override env. `LOOP24_BUNDLED_EXTENSION_PATHS` free. |
| `GSD_WORKTREE` | `LOOP24_WORKTREE` | 5 | many | **Reclassified 2026-05-24.** Worktree-mode env. `LOOP24_WORKTREE` free. |
| `GSD_CLI_WORKTREE` | `LOOP24_CLI_WORKTREE` | 5 | many | **Reclassified 2026-05-24.** CLI worktree path env. `LOOP24_CLI_WORKTREE` free. |
| `GSD_CLI_WORKTREE_BASE` | `LOOP24_CLI_WORKTREE_BASE` | 5 | many | **Reclassified 2026-05-24.** CLI worktree base path env. `LOOP24_CLI_WORKTREE_BASE` free. |
| `GSD_STARTUP_TIMING` | `LOOP24_STARTUP_TIMING` | 2 | 0 | **Reclassified 2026-05-24.** Startup timing diagnostic flag (also has `PI_TIMING` alias). `LOOP24_STARTUP_TIMING` free. |
| `GSD_SHOW_TOKEN_COST` | `LOOP24_SHOW_TOKEN_COST` | 2 | many | **Reclassified 2026-05-24.** Token cost UI toggle. `LOOP24_SHOW_TOKEN_COST` free. |
| `GSD_VERBOSE` | `LOOP24_VERBOSE` | 1 | 0 | **Reclassified 2026-05-24.** Verbose logging flag. `LOOP24_VERBOSE` free. |

**Section 5 total: 30 env vars** (15 original from plan + 15 added 2026-05-24).

---

## Collision summary

| Naive name | Hit count | Winning proposed name | Reason |
|---|---|---|---|
| `handleWorkflowCommand` | 7 | `dispatchWorkflowCommand` | Pre-existing function; different concept |
| `WorkflowState` | 1 | `WorkflowDbState` | Pre-existing type; db-persisted variant |
| `writeWorkflowState` | 1 | (no rename needed yet; see open questions) | Pre-existing function; different concept |
| `createExtensionAPI` | 3 | `createWorkflowExtensionAPI` | Pre-existing function |
| `getArgumentCompletions` | 16 | `getWorkflowArgumentCompletions` | Pre-existing function |
| `hasBootstrapArtifacts` | 1 | `hasWorkflowBootstrapArtifacts` | Pre-existing function |
| `AppError` | 1 | `WorkflowError` | Pre-existing type |
| `Project` | 508 | `WorkflowProject` | Pervasive generic type |
| `Milestone` | 330 | `WorkflowMilestone` | Pervasive generic type |
| `Task` | 188 | `WorkflowTask` | Pervasive generic type |
| `Slice` | 250 | `WorkflowSlice` | Pervasive generic type |
| `ExtensionAPI` | 162 | `WorkflowExtensionAPI` | Pervasive type |
| `Requirement` | 45 | `WorkflowRequirement` | Used across codebase |
| `BLOCKED` | 3 | `WORKFLOW_BLOCKED` | String literal in GitHub workflow scripts |
| `WORKTREE` | 2 | `WORKFLOW_WORKTREE` | String fragment in system-context.ts |

**Total collisions found:** 15 (3 were pre-flagged in plan; 12 discovered during audit)

---

## Out of scope (per user's policy decisions in Phase 8)

- **npm workspace scope** `@loop24/pi-coding-agent`, `@loop24/pi-ai`, `@loop24/pi-tui`, `@loop24/pi-agent-core`, `@loop24-build/contracts`, `@loop24-build/rpc-client`, `@loop24-build/mcp-server`, `@loop24-build/daemon` → Phase 9
- **customType strings** `"gsd-add-tests"`, `"gsd-dispatch"`, `"gsd-spike"`, `"gsd-build-flow"`, `"gsd-skill-extension"`, … → Phase 10 (needs session-file migration design)
- **LICENSE attribution** to Lex Christopherson — MIT requires retention
- **README "Fork attribution" block** — MIT requires reasonably prominent surface
- **LOOP24-PATCHES.md** — the file's purpose is to document the fork
- **Commit history** — destructive to rewrite, breaks tags

---

## Inventory commands used (for reproducibility)

```bash
# Ran from /Users/coreyellis/Projects/repos/local/loop24-client

# PascalCase-prefix function names
grep -rohE "\b(register|handle|get|set|read|write|create|init|load|save|build|run|dispatch|format|parse|validate|resolve|extract|sanitize|notify|emit|with|is|has)GSD[A-Za-z_]*" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort | uniq -c | sort -rn

# Type/interface/class names
grep -rohE "\bGSD[A-Z][A-Za-z0-9_]*" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort | uniq -c | sort -rn

# All-caps constants + env vars
grep -rohE "\bGSD_[A-Z_]+" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort | uniq -c | sort -rn

# Lower-camel gsd functions
grep -rohE "\b(read|write|get|set|create|delete|update|format|notify|build|with|is|has)Gsd[A-Z][A-Za-z0-9_]*" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort | uniq -c | sort -rn

# Per-identifier file counts: grep -rln "\bIDENTIFIER\b" src/ packages/ | grep -v "/dist/" | grep -v "/node_modules/" | wc -l
# Collision check: same command with proposed new name
```

---

## Open questions — RESOLVED 2026-05-24

1. **`writeGsdState` — RESOLVED: does not exist.** Grep `writeGsdState\|writeGSDState` in src/ packages/ returns zero hits. The plan's pre-flight collision note was speculative. What does exist: `readGsdState` (1 file, already in map → `readAgentState`) and `writeGsdIdMarker` (1 file, already in map → `writeIdMarker`). The pre-existing `writeWorkflowState` (in commands-workflow-templates.ts) is a separate concept and stays as-is. **No additional rename needed.**

2. **`GSD_PROJECT_ROOT` / `GSD_WORKFLOW_PROJECT_ROOT` — RESOLVED: process env vars.** Both confirmed as env vars via direct `process.env.GSD_PROJECT_ROOT = …` writes (auto.ts:356) and reads (worktree-root.ts:64). Spread into spawned worker process envs in parallel-orchestrator.ts:609 and slice-parallel-orchestrator.ts:104. Added to Section 5 env-var table with `LOOP24_PROJECT_ROOT` and `LOOP24_WORKFLOW_PROJECT_ROOT` canonical names + `GSD_X` fallback shim. **Section 4 (constants) does NOT contain these; they were never miscategorized in the map body, only flagged here.**

3. **`GSD_ENABLE_NATIVE_GSD_GIT` / `GSD_ENABLE_NATIVE_GSD_PARSER` — RESOLVED: process env vars; `LOOP24_ENABLE_NATIVE_GIT/_PARSER`.** Both confirmed env vars (`process.env.GSD_ENABLE_NATIVE_GSD_GIT === "1"` in native-git-bridge.ts:19; same shape in native-parser-bridge.ts:11). Reclassified from Section 4 to Section 5. Earlier `ENABLE_NATIVE_AGENT_GIT` proposal rejected: (i) "agent" misleads — these toggle parser/git internals, not agent behavior; (ii) env vars take LOOP24_ canonical, not bare; (iii) inner duplicate `GSD` drops cleanly since "native" qualifies the feature. Final names: `LOOP24_ENABLE_NATIVE_GIT` and `LOOP24_ENABLE_NATIVE_PARSER`.

4. (merged into item 3)
