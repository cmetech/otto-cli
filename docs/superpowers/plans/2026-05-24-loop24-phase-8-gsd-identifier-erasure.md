# LOOP24 Phase 8 — GSD identifier + content-file erasure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

> **NEVER `git add -A` in this repo.** Always stage explicit file paths from the task's scope. `docs/branding/` is the user's active working area — keep hands off.

**Goal:** Erase remaining GSD identifiers, filenames, content-file references, and env var names from the codebase. Replace with descriptive names that reflect actual purpose. Internal env vars get `LOOP24_X` canonical names with `OTTO_X` fallback during transition. **Deferred to separate phases:** npm workspace scope (`@gsd/pi-coding-agent` etc.) and customType protocol strings (`"gsd-add-tests"` etc., which would break session-file forward compatibility without migration logic).

**Architecture:** Sequential renames, each task atomic and reversible. Task 1 produces a naming map that pre-resolves all collisions; remaining tasks execute the renames in order of lowest blast radius first. **Success criteria for every task: `npm run build` clean AND regression suite pass.** No task moves to the next without both.

**Tech Stack:** TypeScript, bash for file rename operations, the existing regression suite.

**⚠️ piConfig / brand-colors auto-sync (Cleanups A + B) is in effect.** Don't touch `package.json` piConfig directly without going through `npm run sync-piconfig`; don't add inline hex literals.

**⚠️ Test scope when verifying:**

After each task that touches code, run:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts \
  src/resources/extensions/workflow/tests/help-menu-coverage.test.ts \
  src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/langflow-import-flow.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  src/resources/extensions/loop24/tests/python-runtime.test.ts \
  src/resources/extensions/loop24/tests/tools-loader.test.ts \
  src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts \
  src/resources/extensions/loop24/tests/build-flow-system-context.test.ts \
  src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts \
  src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts \
  2>&1 | tail -8
```

That's the standing regression set (65 tests). All must pass. If a rename breaks something outside the set, fix it before moving on — the set is the floor, not the ceiling.

For renames that touch the workflow extension, ALSO run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/workflow/tests/db.test.ts \
  src/resources/extensions/workflow/tests/derive-state-db.test.ts \
  src/resources/extensions/workflow/tests/single-writer-invariant.test.ts \
  2>&1 | tail -6
```

(Filenames update post-Task 2; use the new names then.)

**Pre-flight collision facts (from controller audit before plan was written):**

- **File renames are collision-free.** All five `gsd-*.ts` files in scope can drop the `gsd-` prefix without conflicts.
- **Three identifier collisions** with naive drop-prefix names:
  - `handleWorkflowCommand` already used in 24 files (separate concept from `handleGSDCommand`)
  - `WorkflowState` already used in 5 files
  - `writeWorkflowState` already used in 3 files
  - The naming map (Task 1) must resolve these with context-specific names like `dispatchWorkflowCommand`, `WorkflowDbState`, `persistWorkflowDbState`, etc.

---

## Scope

In scope (this phase):
- File renames: 5 TS files (`gsd-*.ts`) + their tests, 1 directory (`gsd-parser/`), 1 content file (`GSD-WORKFLOW.md`), 1 skill dir (`create-gsd-extension/`)
- Identifier renames: function names (`registerGSDCommand` → `registerWorkflowCommand`, etc.), type names (`GSDState` → context-aware), error codes (`MISSING_OTTO_MARKER`)
- Internal env var renames: 11 vars with LOOP24_X canonical + OTTO_X fallback compat shim
- Content sweep inside the 15 remaining content files from Cleanup C residue

Out of scope (later phases):
- npm workspace scope `@gsd/*` → ? (Phase 9 — biggest by import-count)
- customType protocol strings `"gsd-add-tests"`, `"gsd-dispatch"`, etc. (Phase 10 — affects persisted session files)
- LICENSE attribution to Lex Christopherson (MIT requires; CANNOT remove)
- README "Fork attribution" block (MIT requires "reasonably prominent" surface)
- LOOP24-PATCHES.md fork-edit history (the file's purpose IS to document the fork)

---

## File rename targets

| Old path | New path |
|---|---|
| `src/resources/GSD-WORKFLOW.md` | `src/resources/WORKFLOW.md` |
| `src/resources/skills/create-gsd-extension/` | `src/resources/skills/create-extension/` |
| `src/resources/extensions/shared/gsd-phase-state.ts` | `src/resources/extensions/shared/phase-state.ts` |
| `src/resources/extensions/shared/tests/gsd-phase-state.test.ts` | `src/resources/extensions/shared/tests/phase-state.test.ts` |
| `src/resources/extensions/workflow/gsd-home.ts` | `src/resources/extensions/workflow/home.ts` |
| `src/resources/extensions/workflow/gsd-db.ts` | `src/resources/extensions/workflow/db.ts` |
| `src/resources/extensions/workflow/gsd-command-home.ts` | `src/resources/extensions/workflow/command-home.ts` |
| `src/resources/extensions/workflow/ecosystem/gsd-extension-api.ts` | `src/resources/extensions/workflow/ecosystem/extension-api.ts` |
| `src/resources/extensions/workflow/tests/gsd-db.test.ts` | `src/resources/extensions/workflow/tests/db.test.ts` |
| `src/resources/extensions/workflow/tests/gsdroot-worktree-detection.test.ts` | `src/resources/extensions/workflow/tests/root-worktree-detection.test.ts` |
| `packages/native/src/gsd-parser/` (directory) | `packages/native/src/parser/` |

---

## Env var rename targets (LOOP24_X canonical, OTTO_X fallback)

| Old | New (canonical) | Fallback reads old |
|---|---|---|
| `OTTO_DEBUG` | `LOOP24_DEBUG` | yes |
| `OTTO_HOME` | `LOOP24_HOME` (already canonical per Phase 0; just deprecate OTTO_HOME) | yes |
| `OTTO_PKG_ROOT` | `LOOP24_PKG_ROOT` | yes |
| `OTTO_WORKFLOW_PATH` | `LOOP24_WORKFLOW_PATH` (also renames the file it points at via Task 6) | yes |
| `OTTO_CODING_AGENT_DIR` | `LOOP24_AGENT_DIR` | yes |
| `OTTO_VERSION` | `LOOP24_VERSION` | yes |
| `OTTO_FIRST_RUN_BANNER` | `LOOP24_FIRST_RUN_BANNER` (already canonical; just deprecate OTTO_) | yes |
| `OTTO_BIN_PATH` | `LOOP24_BIN_PATH` | yes |
| `OTTO_SKIP_RTK_INSTALL` | `LOOP24_SKIP_RTK_INSTALL` | yes |
| `OTTO_RTK_DISABLED` | `LOOP24_RTK_DISABLED` | yes |
| `OTTO_TEST_CLONE_MARKETPLACES` | `LOOP24_TEST_CLONE_MARKETPLACES` | yes |

---

## Task 1: Build the naming map (no code change)

**Files:**
- Create: `docs/branding/PHASE8-NAMING-MAP.md` — **NOTE: `docs/branding/` is the user's working area. ASK the user where this should live OR put it in `docs/superpowers/notes/PHASE8-NAMING-MAP.md` instead. Default to the latter if unsure.**

Actually: put it in `docs/superpowers/notes/PHASE8-NAMING-MAP.md`. The `docs/branding/` directory is off-limits per repo policy.

The map enumerates every GSD identifier in the codebase, the proposed new name, and resolves collisions. The user reviews before any destructive changes happen.

- [ ] **Step 1: Inventory identifiers**

Run these greps and capture the unique-identifier counts:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client

# Function names matching registerGSD*, handleGSD*, etc.
grep -rohE "\\b(register|handle|get|set|read|write|create|init|load|save|build|run|dispatch|format|parse|validate|resolve|extract|format|sanitize|notify|emit|with|is|has)GSD[A-Za-z_]*" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort -u

# Type / interface / class names matching GSDXxx
grep -rohE "\\bGSD[A-Z][A-Za-z0-9_]*" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort -u

# Constant identifiers matching OTTO_XXX (not env vars — those are in the env section)
# Filter to all-caps identifiers used in code contexts (NOT inside process.env reads)
grep -rohE "\\bOTTO_[A-Z_]+" src/ packages/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" | sort -u
```

- [ ] **Step 2: For each identifier, propose a new name**

Naming policy (user-approved): drop the GSD prefix; use descriptive names that reflect actual purpose. Examples:

| Old | New | Reasoning |
|---|---|---|
| `registerGSDCommand` | `registerWorkflowCommand` | The command IS the workflow-extension top-level command |
| `handleGSDCommand` | **collision** — `handleWorkflowCommand` already exists for a different concept → use `dispatchWorkflowCommand` or `handleWorkflowDispatch` |
| `GSDState` | **collision** — `WorkflowState` already exists for a different concept → use `WorkflowDbState` (it's the db-persisted state) |
| `GSDConfig` | `WorkflowConfig` (verify no collision; current audit shows free) |
| `GSDNoProjectError` | `NoProjectError` or `WorkflowNoProjectError` (verify free) |
| `readGsdState`, `writeGsdState` | **collision** — `writeWorkflowState` exists → use `readWorkflowDbState`, `writeWorkflowDbState` |
| `getGsdArgumentCompletions` | `getWorkflowArgumentCompletions` (verify free) |
| `OTTO_COMMAND_DESCRIPTION` | `WORKFLOW_COMMAND_DESCRIPTION` |
| `MISSING_OTTO_MARKER` | `MISSING_WORKFLOW_MARKER` |

For each row in your inventory:
1. Propose the new name
2. Grep for collisions: `grep -rn "\bNEWNAME\b" src/ packages/`
3. If collision found, fall back to a more specific descriptive name (e.g., add a domain prefix like `Workflow`, `Db`, `Agent`)

- [ ] **Step 3: Write the map**

Create `docs/superpowers/notes/PHASE8-NAMING-MAP.md` with two sections:

```markdown
# Phase 8 GSD-erasure naming map

Date: <today>
Source: identifier inventory in commit <SHA at time of writing>

## Identifier renames

| Category | Old name | New name | Sites | Notes |
|---|---|---|---|---|
| function | registerGSDCommand | registerWorkflowCommand | 9 | free |
| function | handleGSDCommand | dispatchWorkflowCommand | 24 | collision with existing handleWorkflowCommand resolved |
| type | GSDState | WorkflowDbState | 69 | collision with existing WorkflowState resolved |
| ... | ... | ... | ... | ... |

## Env var renames (compat shim approach)

| Old | New | Setters (files that write) | Readers (files that read) |
|---|---|---|---|
| OTTO_DEBUG | LOOP24_DEBUG | (none — set externally) | <N> files |
| ... | ... | ... | ... |

## Out of scope

- npm workspace scope (`@gsd/*`) — Phase 9
- customType strings (`"gsd-add-tests"`, …) — Phase 10
- LICENSE + README fork-attribution — MIT required
- LOOP24-PATCHES.md — documents the fork
```

- [ ] **Step 4: Commit the map**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add docs/superpowers/notes/PHASE8-NAMING-MAP.md
git commit -m "docs(phase8): identifier + env var naming map for GSD erasure

Pre-rename audit. Inventories all GSD function names, type names,
error codes, and env vars in src/ + packages/. Proposes new names
with collision detection.

Three identifier collisions resolved:
  - handleGSDCommand → dispatchWorkflowCommand (collision: existing handleWorkflowCommand)
  - GSDState → WorkflowDbState (collision: existing WorkflowState)
  - writeGsdState → writeWorkflowDbState (collision: existing writeWorkflowState)

Out of scope (deferred phases):
  - npm workspace scope @gsd/* (Phase 9)
  - customType strings 'gsd-add-tests' etc (Phase 10 — needs session migration)
  - LICENSE + README fork-attribution (MIT requires)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Rename TS files in `src/resources/extensions/workflow/` and `shared/`

**Files affected (renames):**
- `src/resources/extensions/shared/gsd-phase-state.ts` → `phase-state.ts`
- `src/resources/extensions/shared/tests/gsd-phase-state.test.ts` → `phase-state.test.ts`
- `src/resources/extensions/workflow/gsd-home.ts` → `home.ts`
- `src/resources/extensions/workflow/gsd-db.ts` → `db.ts`
- `src/resources/extensions/workflow/gsd-command-home.ts` → `command-home.ts`
- `src/resources/extensions/workflow/ecosystem/gsd-extension-api.ts` → `extension-api.ts`
- `src/resources/extensions/workflow/tests/gsd-db.test.ts` → `db.test.ts`
- `src/resources/extensions/workflow/tests/gsdroot-worktree-detection.test.ts` → `root-worktree-detection.test.ts`

**Plus:** every file that imports from these — update the import path (`./gsd-db.js` → `./db.js`).

- [ ] **Step 1: Inventory import sites**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
for f in gsd-phase-state gsd-home gsd-db gsd-command-home gsd-extension-api; do
  echo "--- $f import sites ---"
  grep -rln "[\"']\\([^\"']*\\)/${f}\\.\\(js\\|ts\\)[\"']\\|[\"']\\.[/]${f}[\"']" src/ packages/ 2>/dev/null \
    | grep -v "/dist/" | grep -v "/node_modules/" | sort -u
done
```

(This is approximate. The implementer should grep more carefully per file — different importers may use `./gsd-db.js`, `../gsd-db.js`, `../../shared/gsd-phase-state.js`, etc.)

- [ ] **Step 2: Rename the files (git mv preserves history)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git mv src/resources/extensions/shared/gsd-phase-state.ts src/resources/extensions/shared/phase-state.ts
git mv src/resources/extensions/shared/tests/gsd-phase-state.test.ts src/resources/extensions/shared/tests/phase-state.test.ts
git mv src/resources/extensions/workflow/gsd-home.ts src/resources/extensions/workflow/home.ts
git mv src/resources/extensions/workflow/gsd-db.ts src/resources/extensions/workflow/db.ts
git mv src/resources/extensions/workflow/gsd-command-home.ts src/resources/extensions/workflow/command-home.ts
git mv src/resources/extensions/workflow/ecosystem/gsd-extension-api.ts src/resources/extensions/workflow/ecosystem/extension-api.ts
git mv src/resources/extensions/workflow/tests/gsd-db.test.ts src/resources/extensions/workflow/tests/db.test.ts
git mv src/resources/extensions/workflow/tests/gsdroot-worktree-detection.test.ts src/resources/extensions/workflow/tests/root-worktree-detection.test.ts
```

- [ ] **Step 3: Update every import**

For each renamed file, find every importer and rewrite the import specifier:

```bash
# Example for gsd-db → db
grep -rln "['\"]\\.[/]gsd-db['\"]\\|['\"]\\.[/]gsd-db\\.js['\"]" src/ packages/ 2>/dev/null | grep -v "/dist/" \
  | while read f; do
    # Use Edit tool to do surgical replacements per file
    echo "Touch $f"
  done
```

Use the `Edit` tool to do the actual replacements. Don't try to mass-sed — surgical edits preserve quoting style and let the build catch any missed sites.

Key patterns to look for:
- `from "./gsd-db.js"` → `from "./db.js"`
- `from "../gsd-db.js"` → `from "../db.js"`
- `from "../../shared/gsd-phase-state.js"` → `from "../../shared/phase-state.js"`
- Dynamic `await import("./gsd-db.js")` patterns too

Tests that reference the test files themselves:
- `package.json` `test:unit:compiled` script glob `"dist-test/src/resources/extensions/workflow/tests/*.test.js"` — already matches new names by glob, no change needed
- Any explicit test path references in scripts/ — check and update

- [ ] **Step 4: Build + regression**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
# Then the regression suite (paste the full block from the header of this plan)
```

If build fails with `Cannot find module './gsd-db.js'` or similar, you missed an import site. Find it from the error, fix it, rebuild.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
# Stage ONLY the renamed files + their importers — never git add -A
git add <explicit file paths>
git commit -m "refactor(phase8): drop gsd- prefix from workflow + shared TS filenames

5 TS files renamed (drops the gsd- prefix to leave descriptive names
that reflect actual purpose):
  - extensions/shared/gsd-phase-state.ts → phase-state.ts
  - extensions/workflow/gsd-home.ts → home.ts
  - extensions/workflow/gsd-db.ts → db.ts
  - extensions/workflow/gsd-command-home.ts → command-home.ts
  - extensions/workflow/ecosystem/gsd-extension-api.ts → extension-api.ts

Plus 3 test file renames + every importer updated.

Filename collisions: none (audited). Identifier renames inside the
files (GSDState, registerGSDCommand, etc.) deferred to Task 7+.

Build clean. Regression: 65/65 pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rename `packages/native/src/gsd-parser/` directory

**Files:**
- Rename: `packages/native/src/gsd-parser/` → `packages/native/src/parser/`
- Update: every import path that uses `gsd-parser`

- [ ] **Step 1: Inventory imports**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -rln "gsd-parser" src/ packages/ 2>/dev/null | grep -v "/dist/" | grep -v "/node_modules/"
```

- [ ] **Step 2: Rename + update imports**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git mv packages/native/src/gsd-parser packages/native/src/parser
```

Then update every import site found in Step 1 via the `Edit` tool.

- [ ] **Step 3: Build + regression** (full set from the plan header).

- [ ] **Step 4: Commit** with the explicit-paths staging pattern.

---

## Task 4: Rename `src/resources/GSD-WORKFLOW.md` + `OTTO_WORKFLOW_PATH` env var

**Files:**
- Rename: `src/resources/GSD-WORKFLOW.md` → `src/resources/WORKFLOW.md`
- Modify: `src/loader.ts` — set `LOOP24_WORKFLOW_PATH` (canonical) + keep `OTTO_WORKFLOW_PATH` (fallback) pointing at the new path
- Modify: every reader of `OTTO_WORKFLOW_PATH` — read `LOOP24_WORKFLOW_PATH` first, fall back to `OTTO_WORKFLOW_PATH`
- Modify: any code that constructs the literal filename `GSD-WORKFLOW.md`

- [ ] **Step 1: Find every reference**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -rn "GSD-WORKFLOW\\|OTTO_WORKFLOW_PATH" src/ packages/ scripts/ 2>/dev/null | grep -v "/dist/" | grep -v "/node_modules/"
```

Expected hits (from earlier audit):
- `src/loader.ts:173` — `process.env.OTTO_WORKFLOW_PATH = join(resourcesDir, 'GSD-WORKFLOW.md')`
- `src/resource-loader.ts:575`, `:629`, `:631` — fallback path + sync logic

- [ ] **Step 2: Rename the file**

```bash
git mv src/resources/GSD-WORKFLOW.md src/resources/WORKFLOW.md
```

- [ ] **Step 3: Update loader.ts**

```typescript
// Before:
process.env.OTTO_WORKFLOW_PATH = join(resourcesDir, 'GSD-WORKFLOW.md')

// After:
const workflowPath = join(resourcesDir, 'WORKFLOW.md')
process.env.LOOP24_WORKFLOW_PATH = workflowPath
process.env.OTTO_WORKFLOW_PATH = workflowPath  // fallback for any reader not yet migrated
```

- [ ] **Step 4: Update readers (resource-loader.ts and any others)**

Pattern for every reader:
```typescript
const workflowPath = process.env.LOOP24_WORKFLOW_PATH || process.env.OTTO_WORKFLOW_PATH
```

- [ ] **Step 5: Build + regression**

- [ ] **Step 6: Commit**

```
refactor(phase8): rename GSD-WORKFLOW.md → WORKFLOW.md + LOOP24_WORKFLOW_PATH env var

Renames the runtime workflow content file and introduces the
LOOP24_WORKFLOW_PATH env var as canonical. OTTO_WORKFLOW_PATH stays
set (loader writes both) so any reader not yet migrated continues
to work.

Build clean. Regression: 65/65 pass.
```

---

## Task 5: Rename `create-gsd-extension/` skill dir

**Files:**
- Rename: `src/resources/skills/create-gsd-extension/` → `src/resources/skills/create-extension/`
- Update: any code that loads this skill by literal path/name

- [ ] **Step 1: Find references**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -rln "create-gsd-extension" src/ packages/ scripts/ 2>/dev/null | grep -v "/dist/" | grep -v "/node_modules/"
```

The skill loader probably scans the dir, so the directory rename may be sufficient. But verify.

- [ ] **Step 2: Rename + verify**

```bash
git mv src/resources/skills/create-gsd-extension src/resources/skills/create-extension
```

Update any code references found in Step 1.

- [ ] **Step 3: Build + regression + commit**

---

## Task 6: Identifier rename batch — functions

Following the naming map produced in Task 1, do mechanical sweeps for each function-name rename.

**Approach for each name:**

1. Find every occurrence: `grep -rn "\bOLDNAME\b" src/ packages/ 2>/dev/null | grep -v "/dist/" | grep -v "/node_modules/"`
2. Edit each file with surgical replacements
3. Build catches any miss

**Names to rename (verify against the naming map):**

- `registerGSDCommand` → `registerWorkflowCommand` (~9 files)
- `handleGSDCommand` → `dispatchWorkflowCommand` (or per the naming map's collision resolution)
- `getGsdArgumentCompletions` → `getWorkflowArgumentCompletions`
- `readGsdState`, `writeGsdState` → resolved per map (likely `readWorkflowDbState` / `writeWorkflowDbState`)
- Any other `<verb>GSD<Noun>` patterns found in Task 1

**Step:** for each name, one Edit-tool pass, then build + regression. Don't batch multiple identifier renames into a single build without a regression in between — easier to bisect a failure.

- [ ] **Commit** after each name batch with a clear message naming what was renamed.

---

## Task 7: Identifier rename batch — types + classes + error codes

Same pattern as Task 6 but for non-function identifiers:

- `GSDState` → per naming map (likely `WorkflowDbState`)
- `GSDConfig` → `WorkflowConfig` (verify free)
- `GSDNoProjectError` → per naming map
- `OTTO_COMMAND_DESCRIPTION` → `WORKFLOW_COMMAND_DESCRIPTION`
- `MISSING_OTTO_MARKER` → `MISSING_WORKFLOW_MARKER`
- Any other `GSD<...>` types/constants found in Task 1

Build + regression after each name. Commit per name or small batch.

---

## Task 8: Env var rename batch with compat shim

For each of the 11 env vars in the "Env var rename targets" table at the top of this plan:

**Pattern (READERS):**

```typescript
// Before:
const val = process.env.OTTO_DEBUG

// After:
const val = process.env.LOOP24_DEBUG ?? process.env.OTTO_DEBUG
```

**Pattern (SETTERS):**

```typescript
// Before:
process.env.OTTO_DEBUG = '1'

// After:
process.env.LOOP24_DEBUG = '1'
process.env.OTTO_DEBUG = '1'  // fallback for any reader not migrated yet
```

**Note:** `LOOP24_HOME` and `LOOP24_FIRST_RUN_BANNER` are already canonical from Phase 0. For those two, just ensure every READER reads `LOOP24_X` first and falls back to `OTTO_X`. (Setters already write both.)

- [ ] **Step 1: For each var, find every reader + setter site**

```bash
for v in OTTO_DEBUG OTTO_HOME OTTO_PKG_ROOT OTTO_WORKFLOW_PATH OTTO_CODING_AGENT_DIR OTTO_VERSION OTTO_FIRST_RUN_BANNER OTTO_BIN_PATH OTTO_SKIP_RTK_INSTALL OTTO_RTK_DISABLED OTTO_TEST_CLONE_MARKETPLACES; do
  echo "--- $v ---"
  grep -rn "$v" src/ packages/ scripts/ 2>/dev/null | grep -v "/dist/" | grep -v "/node_modules/" | head -10
done
```

- [ ] **Step 2: Apply pattern to every site**

- [ ] **Step 3: Build + regression + commit per var (or small batch)**

---

## Task 9: Content-file sweep — remaining 15 hits from Cleanup C

The Cleanup C residue list (LOOP24-PATCHES.md):

- `src/resources/WORKFLOW.md` (renamed from GSD-WORKFLOW.md in Task 4 — content needs sweep)
- `src/resources/extensions/workflow/prompts/forensics.md`, `worktree-merge.md`
- `src/resources/extensions/workflow/tests/fixtures/pr-body/swarm-lane-with-blockers.md`, `swarm-lane-no-blockers.md`, `commands-ship-empty-optionals.md`
- `src/resources/extensions/workflow/docs/preferences-reference.md`
- `src/resources/skills/decompose-into-slices/SKILL.md`
- `src/resources/skills/create-extension/SKILL.md` (renamed from create-gsd-extension), `references/key-rules-gotchas.md`, `workflows/debug-extension.md`
- `src/resources/skills/forensics/SKILL.md`
- `packages/native/src/parser/index.ts`, `types.ts` (renamed from gsd-parser, but the JSDoc inside may still say "GSD file parser")

**For each:** read the content, strip GSD references per the brand-neutral policy from Cleanup C. Use generic descriptions where possible. The fixtures in `tests/fixtures/pr-body/` are TEST DATA — if tests assert on those strings, update both the fixture and the test assertion together.

**Risk:** Test fixtures. If a test does `assert.match(body, /GSD/)` on a fixture, the test must be updated to match the new fixture content.

- [ ] **Step 1: For each file, identify if it's referenced in test assertions**

```bash
for f in src/resources/extensions/workflow/tests/fixtures/pr-body/*.md; do
  base=$(basename "$f")
  grep -rln "$base\\|$(basename "$f" .md)" src/resources/extensions/workflow/tests/ 2>/dev/null | head -3
done
```

- [ ] **Step 2: Edit each file + update any test assertions**

- [ ] **Step 3: Build + regression + commit**

---

## Task 10: Final regression + LOOP24-PATCHES.md + tag

- [ ] **Step 1: Full regression**

Run the regression set from the plan header. Plus:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run typecheck:extensions 2>&1 | tail -3
```

- [ ] **Step 2: Verify no GSD residue in scope**

```bash
echo "=== Final residue (should be very low) ==="
grep -rnE "\\bGSD\\b|gsd-|@opengsd|gsd-pi" src/ packages/ scripts/ 2>/dev/null \
  | grep -v "/dist/" | grep -v "/node_modules/" \
  | grep -v "\\.test\\." | head -20
```

Expected remaining (per policy):
- `@gsd/pi-coding-agent` and similar workspace imports (deferred to Phase 9)
- customType strings `"gsd-add-tests"`, etc. (deferred to Phase 10)
- LICENSE attribution
- LOOP24-PATCHES.md history
- Commit messages

- [ ] **Step 3: Update LOOP24-PATCHES.md**

Add a new section between Phase 7 and Cleanup C documenting Phase 8: what files were renamed, what identifiers were renamed, env-var compat-shim approach, what's deferred.

- [ ] **Step 4: Tag**

```bash
git tag -a phase-8-gsd-identifier-erasure -m "Phase 8 complete: GSD file/identifier/content-file/env-var erasure. Filenames renamed with prefix dropped (gsd-db.ts → db.ts). Identifiers renamed to descriptive Workflow-prefixed names (registerGSDCommand → registerWorkflowCommand). Env vars get LOOP24_X canonical + OTTO_X fallback shim. GSD-WORKFLOW.md → WORKFLOW.md with corresponding env-var rename. 65/65 regression pass at each step. Deferred: @gsd/* npm scope (Phase 9), customType strings (Phase 10), LICENSE/README fork-attribution (MIT-required)."
```

---

## Success criteria (every task)

1. **`npm run build` clean** — zero TS errors
2. **Regression suite passes** — the 65-test set from the plan header
3. **No `git add -A`** — explicit paths only

If a task can't satisfy both 1 and 2, STOP and report. Do not proceed to the next task with a broken build.

---

## Definition of Done (the whole phase)

- All 8+ files renamed; all imports updated; build clean.
- Naming map exists and is consistent with what was actually renamed.
- 11 env vars have LOOP24_X canonical writers and read-fallback compat.
- 15 Cleanup-C-residue content files swept.
- Full regression: zero failures.
- `phase-8-gsd-identifier-erasure` git tag exists.
- LOOP24-PATCHES.md Phase 8 section written.
- Final residue grep: only acceptable categories remain (workspace npm scope, customType strings, LICENSE/README, history).

---

## Out of scope (explicit, will be picked up later)

- `@gsd/pi-coding-agent`, `@gsd/pi-ai`, `@gsd/pi-tui`, `@gsd/pi-agent-core`, `@gsd-build/*` workspace scope → Phase 9
- `"gsd-add-tests"`, `"gsd-dispatch"`, `"gsd-spike"`, `"gsd-build-flow"`, `"gsd-skill-extension"` customType strings → Phase 10
- LICENSE attribution to Lex Christopherson (MIT required)
- README "Fork attribution" block (MIT requires "reasonably prominent" placement)
- LOOP24-PATCHES.md — the file's purpose IS to document the fork
- Commit history — destructive to rewrite, breaks tags
- `docs/branding/` — user's active working area, hands off
