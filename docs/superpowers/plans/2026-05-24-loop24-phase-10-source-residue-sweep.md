# LOOP24 Phase 10 — Source code + documentation GSD residue sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

> **NEVER `git add -A` in this repo.** Always stage explicit file paths. `docs/branding/` is the user's active working area — keep hands off.

**Goal:** Clean up the remaining GSD residue in **source code and documentation only**. The `.gsd/` runtime directory and customType session protocol strings are deliberately **NOT touched** to preserve compatibility with existing user sessions on disk.

## Scope refactor (user decision 2026-05-24)

The original Phase 10 plan (from the Phase 8 deferred-cleanups list) bundled three things:
1. customType protocol strings (`"gsd-add-tests"` etc.)
2. `.gsd/` runtime directory references
3. The identifiers/env vars Task 6/7/8 missed

**User decision:** items #1 and #2 are persisted-data formats that affect existing sessions. Keep them indefinitely. Phase 10 narrows to source code + documentation cleanup that does NOT touch session state on disk.

## In scope

1. **Identifier sweep** — ~269 distinct GSD-prefixed function/local-variable names that Task 6's verb-prefix grep missed
2. **Env var sweep** — 22 additional `GSD_*` env vars missed by Task 8's naming map (apply same LOOP24_X canonical + GSD_X fallback compat shim)
3. **Comment + JSDoc sweep** — ~464 brand mentions in source-file comments across ~2,839 files

## Out of scope (PRESERVED — session compatibility)

- **`.gsd/` runtime directory references** (~1,664 hits) — code that reads/writes paths under `.gsd/`. Keeping the dir name preserves existing user sessions on disk.
- **customType session protocol strings** (`"gsd-add-tests"`, `"gsd-dispatch"`, `"gsd-spike"`, `"gsd-build-flow"`, `"gsd-skill-extension"`, etc., ~1,386 hits) — these are persisted in session message files; renaming without migration logic would break loading old sessions.
- **`process.env.GSD_X` compat-shim fallback** (~939 hits) — intentional from Task 8.
- **`@opengsd/engine-*` native binary dependencies** — intentional upstream binary reuse.
- **LICENSE attribution**, **README "Fork attribution"** — MIT-required.
- **LOOP24-PATCHES.md** — fork-history doc.
- **Commit history** — destructive to rewrite.
- **`docs/branding/`** — user-owned working area.

## Tasks

### Task 1: Identifier sweep (Gsd-prefixed functions and variables)

Top 25 missed identifiers from Phase 8 audit:

```
resolveGsdRoot (80×), resolveGsdRootFile (73×), originalGsdHome (72×),
tempGsdHome (72×), ensureGsdSymlink (56×), previousGsdHome (48×),
syncGsdStateToWorktree (42×, already deprecated), resolveGsdPathContract (41×),
savedGsdHome (40×), executeGsdExec (39×), relGsdRootFile (37×),
providedGsdHome (27×), batchParseGsdFiles (22×), inlineGsdRootFile (19×),
executeGsdGraph (19×), buildMinimalAutoGsdToolSet (17×), origGsdHome (16×),
hasGitTrackedGsdFiles (15×), agentGsdDir (13×), scopeGsdWorkflowToolsForDispatch (12×),
rememberGsdRoot (12×), externalGsdRoot (12×), targetGsdPath (11×),
registerGsdExtension (11×), setupGsdDir (10×)
```

Plus the long tail (~244 more distinct names).

**Approach:**
1. Build the full inventory: `grep -rohE "\b[a-z][a-zA-Z]*Gsd[A-Z][A-Za-z0-9]*|\bGSD[A-Z][A-Za-z0-9]*" src/ packages/ | sort | uniq -c | sort -rn`
2. Decide rename per identifier:
   - Functions named `*GsdRoot`, `*GsdHome`, `*GsdPath` etc. — these still RETURN `.gsd/X` paths (preserved), but the function NAME can drop `Gsd`. Use `*ProjectStateRoot`, `*StateDir`, or context-appropriate replacement.
   - Local variables named `originalGsdHome`, `tempGsdHome` etc. — these hold `.gsd/X` directory values; rename to `originalStateDir`, `tempStateDir`, or drop the Gsd prefix.
   - Functions with no semantic tie to the directory (e.g., `batchParseGsdFiles`, `executeGsdExec`) — drop the prefix entirely.
3. Apply word-boundary perl sweep per name. Build + regression after each batch.
4. Resolve collisions by adding contextual qualifiers (`Project`, `Workflow`, `Agent`).

**Key constraint:** since `.gsd/` directory stays, function names that reference it should clearly indicate what they return without using the literal `Gsd` token. E.g., `gsdRoot()` returning `<project>/.gsd` could become `projectStateRoot()`.

### Task 2: Env var compat shim (22 newly-discovered vars)

Apply the same Task 8 compat-shim pattern to:
```
GSD_HEADLESS, GSD_WEB_HOST, GSD_WEB_PORT, GSD_WEB_AUTH_TOKEN,
GSD_WEB_PROJECT_CWD, GSD_WEB_PROJECT_SESSIONS_DIR, GSD_WEB_PACKAGE_ROOT,
GSD_WEB_HOST_KIND, GSD_WEB_ALLOWED_ORIGINS, GSD_WEB_BRIDGE_TUI,
GSD_WORKFLOW_MCP_ARGS, GSD_WORKFLOW_MCP_COMMAND, GSD_WORKFLOW_MCP_CWD,
GSD_WORKFLOW_MCP_ENV, GSD_WORKFLOW_MCP_NAME, GSD_CLI_PATH, GSD_DEV_CLI_PATH,
GSD_PROJECT_ID, GSD_AGENT_DIR, GSD_CLAUDE_DEBUG, GSD_DISABLE_LSPMUX,
GSD_DISABLE_WORKTREE_WRITE_GUARD, GSD_ENABLE_NATIVE_TUI_HIGHLIGHT,
GSD_FAKE_LLM_TRANSCRIPT, GSD_FETCH_ALLOWED_URLS, GSD_LEGACY_TELEMETRY_FILE,
GSD_NATIVE_DISABLE, GSD_RTK_PATH, GSD_SKILL_MANIFEST_STRICT, GSD_STATE_DIR,
GSD_UOK_FORCE_LEGACY, GSD_UOK_LEGACY_FALLBACK, GSD_WORKER_MODEL
```

For each:
- Reader: `process.env.GSD_X` → `(process.env.LOOP24_X ?? process.env.GSD_X)`
- Setter: `process.env.GSD_X = expr` → chained assignment writing both
- Env spreads: include both keys
- hasOwnProperty: check both
- `delete process.env.GSD_X` → delete both keys

### Task 3: Source comment + JSDoc brand sweep

~464 brand mentions in code comments across 2,839 files. Apply the same context-aware substitution rules from Task 9:
- `GSD Workflow` → `Workflow`
- `GSD State` → `Workflow State`
- `GSD-managed` → `workflow-managed`
- `GSD extension` → `Workflow extension`
- `GSD plugin` → `Workflow extension`
- Generic `GSD` (brand) → `workflow` / `the agent` / context-appropriate

**Exclusions:**
- Comments mentioning the `.gsd/` directory **by literal path** — these describe operational paths and stay accurate
- Comments referencing the upstream `gsd-pi` package — fork attribution
- Comments in LICENSE/README/LOOP24-PATCHES.md — fork attribution

### Task 4: Final residue + LOOP24-PATCHES.md + tag

- Run final residue audit and update `Known Deferred Cleanups` items #8, #9, #10 to reflect Phase 10 completion
- Add Phase 10 section to LOOP24-PATCHES.md
- Tag `phase-10-source-residue-sweep`

## Success criteria

- `npm run build` clean (exit 0) at every task boundary
- Standing regression: 74/74 pass
- No `git add -A`; explicit paths only
- `docs/branding/` untouched
- After Phase 10: remaining GSD residue is **only** in:
  - `.gsd/` directory references (intentional)
  - customType session strings (intentional)
  - `process.env.GSD_X` compat-shim fallback side (intentional)
  - `@opengsd/engine-*` native binaries (intentional)
  - LICENSE / README / LOOP24-PATCHES.md (intentional)

## Expected diff scale

- Task 1: ~250 file edits, ~600 line changes (identifier sweep across the long tail)
- Task 2: ~80 file edits, ~250 line changes (22 env var compat shim)
- Task 3: ~2,800 file edits, ~600 line changes (comments are widespread but each is 1-2 lines)

Approximately **3,100 files touched** in total. Most are 1-2 line edits (comment changes).
