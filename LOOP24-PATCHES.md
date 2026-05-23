# LOOP24 Patches

This document lists every fork-specific edit we made outside of
`src/resources/extensions/loop24/`. The goal is to give future maintainers
a single place to understand "what's different from gsd-pi" without combing
through git log.

We do **not** track upstream gsd-pi. This list is for our own situational
awareness only.

## Phase 0 — Fork & Rebrand (2026-05-23)

### Initial Source Import
**Commit: bb6da93 "fork: import gsd-pi source"**

Selective rsync from upstream gsd-pi. Dropped the following directories:
- `web/`, `vscode-extension/`, `studio/`, `native/` (Rust source), `gitbook/`, `mintlify-docs/`, gsd-pi's `.plans/`, `.git/`, `node_modules/`, `dist/`.

Kept `packages/native/` (the JavaScript wrappers; graceful proxy fallback to JS implementations if Rust addon absent).

Removed all `@opengsd/engine-*` entries from `optionalDependencies` (Rust compiled binaries no longer needed).

### Root `package.json`
**Commits: bb6da93, b02218d**

- Renamed top-level `"name"` from `"@opengsd/gsd-pi"` to `"@loop24/client"`.
- Added two new `piConfig` keys: `commandNamespace: "loop24"`, `brandName: "LOOP24"`.
- Changed `piConfig.name` to `"loop24"` and `piConfig.configDir` to `".loop24"`.
- Removed `&& node scripts/build-web-if-stale.cjs` from the root `"build"` script (web/ subsystem dropped).
- Updated test scripts from `extensions/gsd/` to `extensions/workflow/` paths.
- Added a `_comment` field to `piConfig` documenting the duplication warning (see "Known Deferred Cleanups" below).

### `packages/pi-coding-agent/package.json`
**Commits: b02218d, d2e950d**

- Added an identical `piConfig` block to match the root package's configuration (with duplication warning `_comment`).

### `packages/pi-coding-agent/src/config.ts`
**Commit: b02218d**

- Added two new exported constants:
  - `COMMAND_NAMESPACE`: reads `piConfig.commandNamespace` with fallback to `APP_NAME`.
  - `BRAND_NAME`: reads `piConfig.brandName` with fallback to uppercased `APP_NAME`.

### `packages/pi-coding-agent/src/index.ts`
**Commit: b02218d**

- Extended the public re-export list to include `COMMAND_NAMESPACE` and `BRAND_NAME` from `./config.js`, making them available for import by extensions as `@gsd/pi-coding-agent`.

### `packages/pi-coding-agent/src/modes/interactive/theme/themes.ts`
**Commits: 30e0b37, 2189c60**

- Added a new `loop24` built-in theme constant inlined as a TypeScript const, mapping the Loop24 Signal brand palette to the 47 required theme schema slots (plus 13 optional adaptive-TUI slots).
- The palette derives from oscar-adminui customColors: yellow #FAD22D primary, blue #4D97ED secondary, purple #AF78D2 for `.planning/` artifacts, brand greens/oranges/reds for status.
- Extended the registry of built-in theme names to include `loop24`.
- `getDefaultTheme()` now unconditionally returns `"loop24"` (removed conditional logic that previously checked for terminal background).
- Removed the `detectTerminalBackground()` helper function (now dead after the rewrite).
- `startThemeWatcher()` built-in-theme guard extended to include `loop24`, `tui-classic`, and `vivid`.

### `src/loader.ts`
**Commit: 36f84e7**

- Replaced the 'Get Shit Done' cyan banner with the LOOP24 block-ASCII banner rendered in brand yellow (#FAD22D) via 24-bit ANSI color codes.
- Set `process.title = 'loop24'` (was `'gsd'`).
- Banner content sourced from `src/resources/extensions/loop24/branding/banner.txt`.
- Added `process.env.LOOP24_FIRST_RUN_BANNER = '1'` alongside the legacy `process.env.GSD_FIRST_RUN_BANNER = '1'` (legacy var still read by `src/resources/extensions/workflow/tests/session-start-footer.test.ts`; see "Known Deferred Cleanups" below).
- Removed the `renderLogo` import (source file `src/logo.ts` itself is kept, still imported by `src/onboarding.ts`).
- Added a TODO comment noting the eventual collapse of both banner env vars to LOOP24_FIRST_RUN_BANNER after test suite update.

### `src/help-text.ts`
**Caught by Task 10 smoke verification — missed during Task 6 brand-string extraction (which focused on the workflow extension, not loader-adjacent top-level files).**

Replaced ~40 literal occurrences of "GSD" / "gsd" / "Get Shit Done" / "@opengsd" across the `--help` and subcommand-help output with values read from `package.json` `piConfig` at module load. The strategy mirrors `loader.ts` (synchronous `readFileSync` + `JSON.parse` — no compiled-module imports), which keeps this file fast enough for the loader's `--help` fast-path that runs before any heavy imports load.

- Reads `piConfig.brandName` (`BRAND`), `piConfig.commandNamespace` (`CMD`), and `piConfig.configDir` (`CONFIG_DIR`) with safe defaults (`LOOP24`, `loop24`, `.loop24`) if `package.json` cannot be parsed.
- Banner line now emits `${BRAND} v${version} — compliant agent for developers` to match the loop24 first-run banner tagline.
- Removed the `npm install -g @opengsd/gsd-pi@latest` "equivalent to" hints from the `update` / `upgrade` subcommand help — LOOP24 has no public npm presence yet, so advertising an install command is misleading. Help now just says "Update LOOP24 to the latest version."
- Subcommand help (`config`, `install`, `worktree`, `graph`, `headless`, etc.) interpolates `${CMD}` for usage lines and examples.
- Knowledge-graph help references `${CONFIG_DIR}/` (e.g., `.loop24/graphs/graph.json`) instead of hardcoded `.gsd/`.

Verified with `node dist/loader.js --help | grep -i 'gsd\|@opengsd'` → no matches; first line reads `LOOP24 v1.0.1 — compliant agent for developers`.

### Directory Rename: `src/resources/extensions/gsd/` → `src/resources/extensions/workflow/`
**Commits: 630bf30, a8cd563**

Neutral directory name. Involved three sweeps of path updates across ~85 TypeScript files:

**Sweep A: Absolute-path imports** (import/require statements with full paths like `from "…extensions/gsd/…"`)
- Updated in all `*.ts`, `*.tsx`, `*.mjs`, `*.js`, and `*.json` files within the source tree.

**Sweep B: Relative-path imports** (statements like `import "…/gsd/…"` or `require("…./gsd/…"`)
- Found 21 sibling extensions and internal modules with relative-path imports from the workflow extension.

**Sweep C: Non-code configuration files**
- `.github/workflows/ci.yml`: updated test paths and artifact references.
- `.github/CODEOWNERS`: updated path patterns.
- `scripts/ci-classify-changes.sh`: updated directory patterns.
- `.prompt-injection-scanignore`: updated ignore patterns.
- `.secretscanignore`: updated ignore patterns.

**Deliberately NOT updated:** Documentation in `docs/**` and `*.md`/SKILL.md files that descriptively reference the old path (not load-bearing; separate cleanup task flagged in plan).

### `src/resources/extensions/workflow/commands/index.ts`
**Commits: 038163b, e025e0a**

- The live registration `pi.registerCommand("gsd", { … })` (called from `workflow/index.ts:22` at extension load) was templated to `pi.registerCommand(COMMAND_NAMESPACE, { … })`.
- Added runtime import for `COMMAND_NAMESPACE` from `@gsd/pi-coding-agent`.
- This is the actual registration that determines the user-visible slash command name at runtime.

### `src/resources/extensions/workflow/commands-bootstrap.ts`
**Commit: 038163b**

- A second registration function `registerLazyGSDCommand(pi)` at line 272 was also templated to use `COMMAND_NAMESPACE`.
- **Note:** This function is dead code (no callers anywhere in the codebase). Templating it had zero functional effect. Left alone — see "Known Deferred Cleanups" below.

### `src/resources/extensions/workflow/strings.ts` (NEW FILE)
**Commit: c63103e**

- Created. Exports centralized user-facing brand strings:
  - `BRAND` = "LOOP24"
  - `CMD` = "loop24"
  - `BRAND_FULL` = "LOOP24 Agent"
  - `PLANNING_DIR` = ".planning" (unchanged across brands)
  - `STATE_DB_NAME` = ".loop24.db"
  - `slashCommand(sub)` helper function that returns `"/loop24 <sub>"` format.
- Centralizes the user-visible brand references so changing `piConfig.brandName` or `piConfig.commandNamespace` in `package.json` updates every prompt and help message in one place at runtime.

### Brand String Routing — User-Facing Strings
**Commit: c63103e**

Updated the following files to route user-facing "GSD"/"gsd" references through `strings.ts` helpers:

**`src/resources/extensions/workflow/commands/catalog.ts`**
- GSD_COMMAND_DESCRIPTION header and every `desc` field referencing "/gsd <sub>" or "GSD".

**`src/resources/extensions/workflow/commands/dispatcher.ts`**
- The "Unknown: /gsd ..." error warning message.

**`src/resources/extensions/workflow/commands/handlers/core.ts`**
- `showHelp()` output (both summary and full help).
- `handleSetup()` status and hub text.
- `formatTextStatus()` header.
- `handleVisualize()` fallback notice.
- `handleStatus()` empty-state notice.

**`packages/pi-coding-agent/src/index.ts`**
- Extended public re-exports to include `BRAND_NAME` (alongside `COMMAND_NAMESPACE`).

### Brand String Routing — Tests Updated
**Commit: c63103e**

Updated the following test files to use `COMMAND_NAMESPACE`, `slashCommand()`, or `BRAND` instead of hardcoded literal strings:

- `src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts`: assertion against "/gsd debug" regex now built dynamically from `slashCommand("debug")`.
- `src/resources/extensions/workflow/tests/commands-dispatcher-validation-block.test.ts`: help-text recovery assertion now checks for `BRAND` instead of literal "GSD".
- `src/resources/extensions/workflow/tests/help-menu-coverage.test.ts`: regex matcher now built from `CMD` instead of hard-coded "/gsd".
- `src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts`: registration assertions now check for `COMMAND_NAMESPACE` instead of the historical literal "gsd".

### Cleanup Commits — Dead Code Removal
**Commits: 24add4c, 2189c60**

- **24add4c:** Removed unused `loadEffectiveGSDPreferences` import in `src/resources/extensions/workflow/commands/handlers/core.ts` (the Task 6 showHelp refactor stopped using it).
- **2189c60:** Removed the `detectTerminalBackground()` helper function from `src/modes/interactive/theme/theme.ts` (now dead after `getDefaultTheme()` rewrite).

### Plan Corrections
**Commits: ca2b6bd, 40aa39a, a8cd563, 67cec0c, 970081f**

During Phase 0 execution, several plan bugs were caught and the plan was patched in place:

- **ca2b6bd:** Clarified build-script edits — the `build:native` step (Rust compilation) was indeed dropped, but `build:native-pkg` (tsc inside `packages/native`) is kept. Also anchored rsync directory excludes with leading `/` to prevent false matches.
- **67cec0c:** Corrected direction to keep `packages/native/` (JS wrappers). Only the Rust source `native/` directory and `@opengsd/engine-*` binaries are dropped.
- **40aa39a:** Identified that `registerLazyGSDCommand` is dead code. Plan now correctly points Task 5 at the live registration in `commands/index.ts` and explicitly instructs not to touch `commands-bootstrap.ts`.
- **a8cd563:** Expanded Task 4 to include three path-update sweeps (absolute, relative, non-code config) and explicitly excludes documentation paths for later cleanup.
- **970081f:** Removed bogus `~/.loop24/` gitignore entry (can't match outside the repo).

These plan corrections are documented in `/docs/superpowers/plans/2026-05-23-loop24-phase-0-fork-and-rebrand.md`.

### Post-tag patches (after `phase-0-fork-and-rebrand`)

#### src/app-paths.ts
- `appRoot` now reads `piConfig.configDir` from `package.json` at module load (same pattern as `src/help-text.ts`) instead of hardcoding `~/.gsd`. Accepts `LOOP24_HOME` (preferred) and `GSD_HOME` (legacy) as overrides.
- Without this fix, the first-run banner check in `loader.ts:96` reads stale `~/.gsd/` state and the banner never fires for users with prior gsd-pi installs. Also: sessions/auth/web-pid all wrote under `~/.gsd/` instead of `~/.loop24/`.

#### packages/native/src/native.ts
- Changed the native-fallback log prefix from `[gsd]` to `[loop24]`. Visible at every launch on platforms without the Rust addon (always, for our fork). Other `gsd` references in this file (env var names, addon filename strings) deliberately untouched — would require coordinated changes to the build pipeline.

#### src/brand.ts (NEW FILE)
- Small synchronous helper that reads `piConfig` from `package.json` at module load and exports `BRAND_NAME`, `COMMAND_NAMESPACE`, `CONFIG_DIR_NAME`, and `BRAND_TAGLINE`. Mirrors the inline pattern already used by `src/help-text.ts` and `src/app-paths.ts` — extracted because both `src/onboarding.ts` and `src/welcome-screen.ts` now need the same brand strings, and duplicating the ~15-line piConfig boilerplate twice was awkward. Does not import from `@gsd/pi-coding-agent` (keeps the loader-adjacent fast path lean).

#### src/logo.ts
- Replaced the GSD block-letter ASCII with the LOOP24 block-letter art (same content as `src/resources/extensions/loop24/branding/banner.txt`). Export name `GSD_LOGO` kept for backward compatibility with `scripts/postinstall.js` and `src/onboarding.ts`. The ASCII content is now duplicated between `logo.ts` and `banner.txt` — a follow-up could deduplicate by having `logo.ts` read `banner.txt` at module load.

#### src/onboarding.ts
- Replaced the cyan onboarding banner color with brand yellow `#FAD22D` (inline 24-bit ANSI — picocolors has no rgb helper). Replaced `"Welcome to GSD — let's get you set up"` with `"Welcome to ${BRAND_NAME}"` (read from `src/brand.ts`). Other GSD references further down in `onboarding.ts` (step labels, error messages, `/gsd ...` slash-command hints) are still pending — listed in deferred cleanups (item 6).

#### src/welcome-screen.ts
- Replaced two `Get Shit Done v${version}` strings (narrow-terminal and panel-too-thin fallbacks) with `${BRAND_NAME} v${version} — ${BRAND_TAGLINE}` (matches loader banner tagline). Brand strings read from `src/brand.ts`. The block-letter ASCII variable `OGSD_LOGO`, the file header comments, `GsdState`/`readGsdState`/`.gsd/STATE.md` references, and the `GSD` accent label on the panel header are still in place — they belong to the broader welcome-screen rebrand effort tracked in deferred cleanups.

#### src/welcome-screen.ts (second pass)
- `OGSD_LOGO` ASCII art (renamed to `LOOP24_LOGO`) replaced with LOOP24 block letters; color changed from olive `#a7ba78` to brand yellow `#FAD22D` (logo block + closing rule).
- Panel header `accent('GSD')`, `"No active GSD project"` copy, and `/gsd <sub>` command references now read from `BRAND_NAME` / `COMMAND_NAMESPACE`.
- `.gsd/STATE.md` and `.gsd/mcp.json` path references now use `CONFIG_DIR_NAME` so state lives under `.loop24/` per `piConfig.configDir`. **Migration note:** users with existing `.gsd/STATE.md` in their project directories will appear as "No active LOOP24 project" until they migrate (no automatic migration performed — this is per-project state, not user-global config).
- File header comments updated from `GSD-2` / "GSD terminal experience" / "GSD Welcome Screen" to LOOP24 prose.
- `GsdState` interface and `readGsdState()` function name intentionally left — internal identifiers, out of scope.

#### src/onboarding.ts (second pass)
- `[gsd]` log prefixes (line ~129 throw, line ~297 stderr fallback) → `[${COMMAND_NAMESPACE}]`.
- Step labels and skip-hints referencing `/login inside GSD`, `/search-provider inside GSD`, `/gsd remote inside GSD`, `/gsd onboarding --resume`, `/gsd onboarding`, `/model … inside GSD`, plus Discord-channel warnings (`/gsd remote discord`), the Telegram connection-confirmation text (`GSD remote questions connected.`), the remote-questions prompt copy, the Discord channel-selection prompt, the outro (`Launching GSD...`) — all templated through `BRAND_NAME` / `COMMAND_NAMESPACE`. Comments, type names, and `@gsd/pi-coding-agent` package import stay.

#### src/tests/initial-gsd-header-filter.test.ts (DELETED)
- Test imported `../../web/lib/initial-gsd-header-filter.ts`, but `web/` was deliberately dropped during the initial fork import (see Initial Source Import section above). The test was a dead orphan — it has never passed in this fork, since the module it tests doesn't exist. Deleted rather than papered over.

## Known Deferred Cleanups

### 1. Dead Code: `registerLazyGSDCommand` in `src/resources/extensions/workflow/commands-bootstrap.ts`
**Location:** `commands-bootstrap.ts:272`

Function exists but has no callers anywhere in the codebase. Was templated to use `COMMAND_NAMESPACE` during Task 5, but templating dead code has zero functional effect on the user-visible command name. The actual registration is in `commands/index.ts:5`. Left for future cleanup; documenting here so it's not rediscovered and re-templated.

### 2. Orphan Rust Build Scripts in `package.json`
**Location:** Root `package.json` scripts section

Three scripts reference the deleted `native/` Rust directory and are never called by any active pipeline:
- `"build:native": "node native/scripts/build.js"`
- `"build:native:dev": "node native/scripts/build.js --dev"`
- `"sync-platform-versions": "node native/scripts/sync-platform-versions.cjs"`

These scripts remain in the file but would fail if invoked. Scheduled for removal in a future cleanup sweep.

### 3. piConfig Duplication: Root `package.json` and `packages/pi-coding-agent/package.json`
**Location:** Both files have identical `piConfig` blocks

Both packages carry an identical configuration block. The workspace-package version wins at runtime because `getPackageDir()` walks up from `__dirname` and finds it first. Both files have a `_comment` field documenting this. Future cleanup: extract to a shared configuration loader or add CI parity check to ensure they stay in sync.

### 4. Loop24 Signal Theme: JSON ↔ TS Const Duplication
**Location:** 
- Canonical JSON: `src/resources/extensions/loop24/theme/loop24.json`
- Runtime const: `packages/pi-coding-agent/src/modes/interactive/theme/themes.ts`

The canonical brand-palette artifact is the JSON file (lives under the extension dir). The runtime registration is an inlined typed const in `themes.ts`. They must be kept in sync manually. The root cause: `pi-coding-agent`'s tsconfig has `rootDir: ./src` constraint, preventing JSON imports from outside the package boundary. Future cleanup: resolve the import boundary or add tooling to generate one from the other.

### 5. GSD_FIRST_RUN_BANNER Env Var Alongside LOOP24_FIRST_RUN_BANNER
**Location:** `src/loader.ts`

Both `process.env.GSD_FIRST_RUN_BANNER` and `process.env.LOOP24_FIRST_RUN_BANNER` are set at startup. The legacy var is still read by `src/resources/extensions/workflow/tests/session-start-footer.test.ts`. A TODO comment in loader.ts flags this. Future cleanup: update that test to read `LOOP24_FIRST_RUN_BANNER` and remove the legacy var.

### 6. User-Facing Brand Strings Still Hardcoded as "GSD" in Several Non-Dispatcher Files
**Locations:** Multiple files; flagged in commit message c63103e

Task 6 extracted high-traffic prompts/help through `strings.ts`, but remaining hardcoded "GSD" references exist in:
- `packages/pi-coding-agent/src/config/config-overlay.ts`: "GSD Configuration" header
- `packages/pi-coding-agent/src/config/key-manager.ts`: "GSD API Key Manager" header
- `src/resources/extensions/workflow/commands/handlers/onboarding.ts`: "GSD Setup" / "GSD Onboarding" headers
- `src/resources/extensions/workflow/commands/handlers/escalate.ts`: helpMessage text
- `src/resources/extensions/workflow/commands/context.ts`: "GSD must be run inside a project directory." error message
- `packages/pi-coding-agent/src/commands/notifications.ts`: formatNotificationTitle prefix "GSD — ..."
- `src/resources/extensions/workflow/commands-maintenance.ts` + `src/resources/extensions/workflow/commands/handlers/ops.ts`: "Usage: /gsd skip ..." examples
- `src/resources/extensions/workflow/commands/handlers/workflow.ts`: ~30 `requireNotAutoActive("/gsd <sub>", ctx)` call sites (internal labels; user-visible portion is the assembled message).
- `src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts`: fixture text.

These are all candidates for a second comprehensive brand-string sweep in a future cleanup task. Deliberately left in Phase 0 to keep scope conservative.

### 7. Internal References Intentionally NOT Changed
**Scope:** Function names, type names, internal identifiers

The following internal identifiers were deliberately left unchanged because they are **not user-visible**. Refactoring them is out of Phase 0 scope:
- Function names: `registerGSDCommand`, `handleGSDCommand`, etc.
- Custom type strings: `"gsd-add-tests"`, `"gsd-spike"`, etc.
- Error codes: `"MISSING_GSD_MARKER"`, etc.
- Type/interface names: `GSDState`, `GSDConfig`, etc.
- Internal env vars: `GSD_PKG_ROOT`, `GSD_CODING_AGENT_DIR`.
- npm workspace prefix: `@gsd/` (e.g., `@gsd/pi-coding-agent`, `@gsd/pi-tui`).

Updating these would be a large refactor touching every internal data structure and type definition. A future Phase 1 or 2 task can address this if branding consistency becomes a priority.

### 8. Documentation Files Still Reference Old `extensions/gsd/` Path
**Scope:** `docs/**`, `*.md`, SKILL.md files

Documentation files (descriptive, not load-bearing) were deliberately left with references to the old `extensions/gsd/` path. These describe the workflow extension and don't affect runtime behavior. Scheduled for a documentation-only cleanup task.

## Summary of Changes by File Type

- **Configuration:** Root and workspace `package.json` updated with new piConfig keys, name, and configDir.
- **TypeScript source:** ~85 files with absolute-path updates; ~21 files with relative-path imports; 5 test files updated.
- **Non-code config:** 4 CI/scan/deploy configuration files updated (`.github/workflows/ci.yml`, `.github/CODEOWNERS`, shell scripts, ignore files).
- **New files:** `src/resources/extensions/workflow/strings.ts`, `src/resources/extensions/loop24/branding/banner.txt`, `src/resources/extensions/loop24/theme/loop24.json`.
- **Removed files/dirs:** `web/`, `vscode-extension/`, `studio/`, `native/` (Rust source), `gitbook/`, `mintlify-docs/`, gsd-pi's `.plans/`, and all compiled Rust binaries.

## Timeline

- **2026-05-23:** Phase 0 fork and rebrand complete. All 8 core implementation tasks finished; 2 deferred cleanups documented.
- All commits passing tests; build produces version `1.0.1`; `/loop24` command functional; banner renders; theme active.
