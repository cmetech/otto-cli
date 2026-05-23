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

## Phase 0.5 — Namespace-completion sweep (2026-05-23)

Finishes the secondary user-facing surfaces deliberately deferred from Phase 0
(item 6 of "Known Deferred Cleanups" — now reduced to a smaller residue list,
see below). Replaces literal `"GSD"` / `/gsd` strings in the workflow extension
with `BRAND` / `CMD` / `slashCommand()` references from
`src/resources/extensions/workflow/strings.ts`.

### Files swept

- **`src/resources/extensions/workflow/commands-maintenance.ts`** — `handleSkip` usage banner now reads `${slashCommand("skip")} ...`.
- **`src/resources/extensions/workflow/commands/handlers/ops.ts`** — added `CMD, slashCommand` import; templated the merge-resume hint, skip usage, run-hook usage block, steer usage, knowledge usage, and dispatch usage strings.
- **`src/resources/extensions/workflow/commands/handlers/workflow.ts`** — added `slashCommand` import; templated `parseDiscussArgs` errors, `requireNotAutoActive` stop hint, `WORKFLOW_USAGE` header, `dispatchPluginByMode` `markdown-phase` and `auto-milestone` guidance, all `handleCustomWorkflow` usage banners (`run`, `info`, `install`, `uninstall`, `validate`), pause/resume "use dev workflow" hints, all ~30 `requireNotAutoActive` call-site labels (`do`, `backlog`, `queue`, `discuss`x2, `quick`, `new-milestone`, `new-project`, `park`, `unpark`), and the park/unpark reactivation hints.
- **`src/resources/extensions/workflow/commands/handlers/escalate.ts`** — added `slashCommand` import; templated `helpMessage()` (`/gsd escalate` headline + `/gsd escalate resolve` reference), resolve-subcommand usage banner, decision-recorded continuation hint, and rejected-to-blocker continuation hint.
- **`src/resources/extensions/workflow/commands/handlers/onboarding.ts`** — added `BRAND, slashCommand` import; templated all per-step notify strings (`llm`, `search`, `remote`, `tool-keys`, `doctor`, `skills`), the setup-hub select-prompt title, the status header, and the reset-confirmation message.
- **`src/resources/extensions/workflow/commands/context.ts`** — added `BRAND, CMD, slashCommand` import; templated both `GSDNoProjectError` fallback reason strings (kept the class name itself), the web-bridge stop-or-steer hint, the `showNextAction` description fields (`status` and `steer`), the `notYetMessage`, and the steer-hint multi-line notify. **Class name `GSDNoProjectError` deliberately kept** per scope rules.
- **`src/resources/extensions/workflow/notifications.ts`** — added `BRAND` import; templated the `formatNotificationTitle` body (now returns `${BRAND}` / `${BRAND} — projectName`) and the default-title check in `sendDesktopNotification`. **Backward-compat shim:** the title check now matches both `BRAND` and the literal `"GSD"` so the many still-unswept `sendDesktopNotification("GSD", ...)` call sites in `auto/phases.ts`, `undo.ts`, etc. keep getting the project-name prefix.
- **`src/resources/extensions/workflow/config-overlay.ts`** — added `BRAND, slashCommand` import; templated the plain-text `formatConfigText` header, the TUI overlay header `accent`, and the footer "/gsd prefs to edit" hint.
- **`src/resources/extensions/workflow/key-manager.ts`** — added `BRAND, slashCommand` import; templated the "GSD API Key Manager" header, the unknown-provider hint, the empty-key doctor finding, the no-LLM-provider doctor finding, and the seven-line `/gsd keys [subcommand]` usage block.
- **`src/resources/extensions/workflow/auto/phases.ts`** — added `slashCommand` import; templated `sanitizeBlockerForUser` (the `gsd_reassess_roadmap` → `/gsd dispatch reassess` substitution) and `formatBlockedResumeMessage` (both branches). Other `"GSD"` literals in this file (`sendDesktopNotification("GSD", ...)` titles, ~10 sites) intentionally NOT touched — covered by the notifications.ts backward-compat shim, listed in residue below.

### Tests updated

- **`src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts`** — added `CMD` import; rewrote `assert.match` regexes to be built dynamically from `CMD` instead of literal `/gsd dispatch reassess`; updated test title.
- **`src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts`** — already imported `slashCommand`; rewrote the bare-skip and loop-verb assertions to construct the expected `"Usage: …"` and `"Unknown: …"` strings via `slashCommand()` rather than literal `/gsd …`. Updated the bare-skip test title.

### Tests verified

```
node --import .../tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts \
  src/resources/extensions/workflow/tests/help-menu-coverage.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts
```
→ 32 tests pass, 0 fail. `npm run build` clean. `node dist/loader.js --help | grep -i gsd` → empty.

### Phase 0.5 residue (new deferred items uncovered during sweep)

The following files still contain `/gsd` / `"GSD"` user-facing literals that
weren't in the Phase 0.5 explicit list. They became visible during the survey
grep and are scheduled for a Phase 0.6 sweep:

- `src/resources/extensions/workflow/auto.ts` — `/gsd next`, `/gsd auto`, `/gsd status`, `/gsd report`, `/gsd notifications`, `/gsd doctor` references in `commands:` arrays of session/closeout banners.
- `src/resources/extensions/workflow/auto/phases.ts` — ~10 `sendDesktopNotification("GSD", ...)` callers (kept working via the notifications.ts compat shim).
- `src/resources/extensions/workflow/state.ts` — validation-failed and remediation guidance multi-step instructions still reference `/gsd status`, `/gsd validate-milestone`, `/gsd verdict pass`, `/gsd park`, `/gsd auto`.
- `src/resources/extensions/workflow/auto-verification.ts` — verdict-override hint.
- `src/resources/extensions/workflow/auto-dispatch.ts` — milestone-completion blocker reason.
- `src/resources/extensions/workflow/undo.ts` — `sendDesktopNotification("GSD", ...)` call.
- `src/resources/extensions/workflow/commands-handlers.ts` — `GSD-WORKFLOW.md` filename and doctor-audit/heal title strings.
- `src/resources/extensions/workflow/commands-workflow-templates.ts` — start/init/discuss guidance in two `content:` strings.
- `src/resources/extensions/workflow/commands-codebase.ts` — `"GSD also refreshes CODEBASE.md…"` description.
- `src/resources/extensions/workflow/dev-workflow-engine.ts` — `engineLabel: "GSD Dev"`.
- `src/resources/extensions/workflow/doctor-format.ts` — `"GSD doctor found blocking issues."` / `"GSD doctor report."` titles.
- `src/resources/extensions/workflow/commands-inspect.ts` — `/gsd inspect failed: …` warning prefix.
- `src/resources/extensions/workflow/memory-relations.ts` — `/gsd memory link` comment-only reference (safe to leave).

## Phase 1 — Gateway routing (tagged: phase-1-gateway-routing)

### src/brand.ts
- Exports `LOOP24_GATEWAY_URL` and `LOOP24_GATEWAY_TOKEN` read from env vars (whitespace-trim → undefined).

### packages/pi-ai/src/providers/anthropic.ts
- New env-var branch at the top of `buildAnthropicClientOptions`: when `LOOP24_GATEWAY_URL` is set, returns gateway-shaped options (baseURL → gateway, apiKey null, authToken from LOOP24_GATEWAY_TOKEN or fallback to apiKey). Existing direct-to-Anthropic behavior unchanged when env var unset.

### packages/pi-ai/src/providers/anthropic.gateway.test.ts (NEW)
- 6 unit tests covering: direct path when unset, gateway routing when set, bearer token usage, apiKey fallback, model.headers passthrough, whitespace-only URL treated as unset.

### src/tests/integration/loop24-gateway.test.ts (NEW)
- 2 integration tests using an in-process node:http mock — verify options shape AND that fetch through the mock with the bearer header round-trips correctly (offline-deterministic, no real API key needed).

### scripts/dev-gateway/ (NEW)
- `server.js` — transparent HTTP proxy to api.anthropic.com. Strips client Authorization header, injects x-api-key from `ANTHROPIC_API_KEY`. `/health` endpoint for the connection probe. Stand-in for the real loop24-gateway's `SURF-V2-01` Anthropic surface until that team ships it.
- `README.md` — usage docs.

### src/resources/extensions/loop24/extension-manifest.json (NEW)
### src/resources/extensions/loop24/index.ts (NEW)
- Scaffolded the loop24 extension. `session_start` hook probes `LOOP24_GATEWAY_URL/health` with 1500ms timeout and emits `gateway: routed → <host>` (or `unreachable`, or `direct`) status line in brand colors after the loader banner. Phase 3 will extend this with flow-trigger loading.

## Phase 3 — LangFlow runtime triggers (tagged: phase-3-langflow-triggers)

### src/resources/extensions/loop24/clients/LANGFLOW-API.md (NEW)
- Reference doc captured from live LangFlow v1.9.3. Documents auth model (x-api-key), endpoint shapes, streaming framing (NDJSON), text-extraction path.

### src/resources/extensions/loop24/clients/langflow.ts (NEW)
- LangFlowClient class with getVersion() (non-throwing, safe for hot path) and runFlow(flowId, input) (throws on non-2xx). Uses Node 22+ built-in fetch. Optional x-api-key via LangFlowClientOptions.apiKey. Five TDD tests.

### src/resources/extensions/loop24/commands/flow-triggers/_schema.ts (NEW)
- Declarative FlowTrigger interface + hand-rolled validateFlowTrigger(). Seven TDD tests. No external schema dep.

### src/resources/extensions/loop24/commands/flow-triggers/_loader.ts (NEW)
- Scans the flow-triggers/ directory, parses each *.yaml (using the `yaml` package), validates each, returns { commands, errors }. Never throws. Five TDD tests.

### src/resources/extensions/loop24/commands/flow-triggers/example-echo.yaml (NEW)
- One example YAML demonstrating the schema. User must edit `flow.id` to point at an actual flow on their LangFlow.

### src/resources/extensions/loop24/index.ts (MODIFIED — added flow-trigger loader + langflow probe)
- session_start hook now probes both gateway and langflow.
- Loads flow-triggers/*.yaml fire-and-forget at extension init, registers each as a slash command via pi.registerCommand. Handler parses --name value args, maps to flow inputs, calls LangFlowClient.runFlow, writes result to stdout.

### packages: `yaml` added (verified present)
- Used by _loader.ts to parse YAML files.

### Tests added
- langflow-client.test.ts (5), flow-trigger-schema.test.ts (7), flow-trigger-loader.test.ts (5) = 17 new tests, all passing.

## Phase 2b — First-run wizard (tagged: phase-2b-first-run-wizard)

### src/loop24-config.ts (NEW)
- Synchronous reader/writer for `~/.loop24/config.json` (schema:
  `{ gateway: { url, token }, langflow: { url, apiKey, enabled } }`).
- Atomic save: tmp+rename, mode `0600`, parent dir created with `0700`.
- Honors `LOOP24_HOME` env override (test seam).
- Module-load side effect: applies config.json values to `process.env`
  for any env var that is currently unset. Env always wins. This is the
  seam that lets `packages/pi-ai/src/providers/anthropic.ts` and the
  loop24 extension's `session_start` probe keep reading
  `process.env.LOOP24_GATEWAY_URL` / `LANGFLOW_SERVER_URL` without
  any code change — they automatically pick up config.json values.
- `applyConfigToEnv()` exported so the wizard can re-propagate values
  into the current process after `saveConfig()` (the module-load side
  effect already fired before the user's wizard run).
- `probeGateway(url, timeoutMs?)` and `probeLangflow(url, timeoutMs?, apiKey?)`
  helpers for service validation. Both never throw; on timeout the
  `reason` is `"timed out after <N>ms"` rather than the unhelpful
  default `AbortError` message.

### src/loop24-wizard.ts (NEW)
- `runLoop24Wizard()`: clack-based interactive wizard. Prompts for gateway
  URL, optional bearer token, LangFlow enabled, LangFlow URL, optional API
  key. Probes each service after capture; soft-warns on probe failure
  (saves anyway — users frequently configure before services are running).
- `shouldRunLoop24Wizard({ isPrint, isTTY })`: true when config.json is
  missing AND on TTY AND not in `--print` mode.
- Mirrors `src/onboarding.ts`'s clack pattern. No TDD on the interactive
  shell — pure pieces (probes, save) are covered in
  `src/tests/loop24-config.test.ts`.

### src/brand.ts (MODIFIED)
- Added `import './loop24-config.js'` at the top of the imports block.
  Side-effect-only import: triggers loop24-config's load-time
  env-propagation so `process.env.LOOP24_GATEWAY_URL` is populated from
  config.json BEFORE brand.ts reads it a few lines later.

### src/cli.ts (MODIFIED)
- Added `loop24 setup` subcommand (parallel to `loop24 config`). Re-runs
  `runLoop24Wizard()` and exits. `setup` added to
  `subcommandsExemptFromEarlyTtyCheck` so it works from scripts / non-TTY.
- Added first-run trigger immediately before the existing
  `shouldRunOnboarding` block: if `shouldRunLoop24Wizard(...)` returns
  true, the LOOP24 services wizard runs before the LLM-auth wizard.
  After the wizard returns, calls `applyConfigToEnv(saved)` so the
  current process picks up the freshly-saved values (not just future
  launches).
- Added headless fallback: when config.json is missing AND
  `LOOP24_GATEWAY_URL` is unset AND not `--print` mode, emit a single
  stderr line pointing at `loop24 setup`. The same warn fires from two
  code paths (early non-TTY exit guard + the else-if to the wizard
  trigger) because the two paths cover non-overlapping headless modes
  (piped stdin → early exit; --mode rpc/mcp/text → else-if). Message
  extracted to `MISSING_CONFIG_WARN` const to keep the two writes in sync.

### src/tests/loop24-config.test.ts (NEW)
- 18 tests: defaults, partial-merge, mode `0600`, atomic overwrite,
  env-precedence (via spawn-based brand.ts probe), probe helpers
  (`probeGateway`/`probeLangflow`) against in-process mock HTTP servers,
  and an explicit timeout-reason test.

### Naming decision: `loop24 setup` (not `loop24 config`)
`loop24 config` was already wired in Phase 0 to launch the LLM-auth wizard
via `runOnboarding`. Two wizards under one subcommand would either chain
them (annoying for re-runs) or require an extra prompt. Adding a separate
subcommand is the simplest non-breaking change. If we ever consolidate,
the cleanup is mechanical.

### Env-var precedence (canonical, post-Phase 2b)
Env var > config.json field > built-in default. The env-var override is
applied by loop24-config.ts's load-time side effect (it only populates
`process.env` when the env var is unset, so any value the user sets in
their shell wins).

## Phase 2b.1 — Unified config subcommand (tagged: phase-2b.1-unified-config)

### Why

`loop24 setup` (added in Phase 2b) sat awkwardly alongside the existing
`loop24 config` (LLM-auth wizard). Two parallel "configure something"
subcommands is a usability wart — standard CLIs use one entry point with
sub-actions. Phase 2b.1 collapses to a single `loop24 config [subject]`
shape.

### src/loop24-wizard.ts (MODIFIED)
- `runLoop24Wizard` now takes `{ section: 'gateway' | 'langflow' | 'all' }`
  (default 'all' = today's behavior). Internal helpers `promptGateway` and
  `promptLangflow` hold the per-section prompt+probe logic; the orchestrator
  wires them according to the requested section. Intro line adapts to the
  partial scope ("LOOP24 — gateway config" / "— LangFlow config" / "— services setup").
- New export: `selectConfigSection()` shows a clack `p.select` of the four
  configurable surfaces (gateway / langflow / llm / all) and returns the choice
  or null on cancel. Used by `loop24 config` with no second arg.
- Summary "Re-run with" hint updated from `loop24 setup` to `loop24 config`.

### src/cli.ts (MODIFIED)
- `loop24 config` branch now dispatches on `cliFlags.messages[1]`:
  - `gateway` → `runLoop24Wizard({ section: 'gateway' })`
  - `langflow` → `runLoop24Wizard({ section: 'langflow' })`
  - `llm` → existing `runOnboarding` (preserves Phase 0 behavior)
  - `all` → `runLoop24Wizard({ section: 'all' })` then `runOnboarding`
  - no arg → `selectConfigSection()` interactive menu, then dispatch
- Removed: `loop24 setup` branch entirely.
- Removed: `'setup'` from `subcommandsExemptFromEarlyTtyCheck` (no longer a subcommand).
- Updated: `MISSING_CONFIG_WARN` now points at `loop24 config` not `loop24 setup`.

### Breaking change scope
`loop24 setup` is no longer a subcommand. Phase 2b shipped less than an
hour before Phase 2b.1 with zero deployed users, so the breakage is
contained to documentation and any in-flight ad-hoc invocations.

## Phase 2c — GSD residue sweep + debug toggle (tagged: phase-2c-residue-sweep)

### packages/pi-coding-agent/src/core/extensions/loader.ts (MODIFIED)
- `pi.registerCommand` closure emits a stderr line when
  `LOOP24_DEBUG_EXTENSIONS` is set:
  `[loop24-debug] registered command 'NAME' from /path/to/extension`.
- Exports `createExtensionAPI` and `createExtension` so the test can
  exercise the closure directly without spinning up a full extension load.

### packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts (NEW)
- 2 tests: env var on → log line appears; env var unset → no output.

### src/resources/extensions/workflow/extension-manifest.json (MODIFIED)
- `provides.commands` changed from `["gsd", ...]` to `["loop24", ...]`
  to match what the runtime actually registers. The extension `id` is
  kept as `"gsd"` because the registry tracks enable/disable state by id.

### src/bundled-resource-path.ts (MODIFIED)
- `resolveBundledGsdExtensionModule()` now reads from
  `extensions/workflow/` (both dist and src fallback paths), aligning
  with the Phase 0 directory rename.

### src/resources/extensions/workflow/*.ts (MODIFIED — 15 files)
- Display strings: `health-widget-core.ts`, `init-wizard.ts`,
  `exit-command.ts`, `commands/catalog.ts`.
- Hardcoded `extensions/gsd/` paths: `prompt-loader.ts`,
  `workflow-plugins.ts`, `forensics.ts`, `workflow-templates.ts`.
- Phase 0.5 residue files: `auto.ts`, `state.ts`, `auto-verification.ts`,
  `auto-dispatch.ts`, `undo.ts`, `commands-handlers.ts`,
  `commands-workflow-templates.ts`, `commands-codebase.ts`,
  `dev-workflow-engine.ts`, `doctor-format.ts`, `commands-inspect.ts`.

Also modified: `bootstrap/register-extension.ts` (kill command description).

All user-visible `GSD` / `Get Shit Done` / `/gsd <sub>` literals now flow
through `BRAND` / `CMD` / `slashCommand()` from `workflow/strings.ts`.
Internal identifiers (function names, type names, error codes,
`MISSING_GSD_MARKER`, etc.) are kept per Phase 0 Known Deferred Cleanups
item 7.

### Live diagnostic finding (Phase 2c smoke test)
Running `LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "hi"` before `rm -rf ~/.loop24/agent` showed:
```
[loop24-debug] registered command 'gsd' from ...workflow/index.js
```
This CONFIRMS the bug: the stale agent dir contains old code that still
registers the literal `"gsd"` command name. After `rm -rf ~/.loop24/agent`
and a fresh startup, the extension loader resyncs from the updated dist,
and the new code registers `"loop24"` instead. The `/loop24` command
should then appear in the TUI autocomplete as expected.

### Out of scope (still residue, will be addressed when something triggers a sweep)
- `mcp-client/manager.ts:349`, `mcp-client/index.ts:147`,
  `mcp-client/auth.ts:89`: MCP client identifier `name: "gsd"` sent to
  remote MCP servers. Changing it requires re-handshake with any tracking
  server. Internal protocol field, not user-facing.
- `~/.gsd/crash/` log directory in `crash-log.ts`. Only matters after an
  extension crash; can move when something else changes there.
- `commands-extensions.ts:215+`: `MISSING_GSD_MARKER` validation messages
  for third-party-extension `package.json` schema. Internal error code.
- `runner.ts:119`: `PROTECTED_EXTENSION_COMMANDS = new Set(["gsd"])`.
  After our rename, nothing registers `"gsd"` literally anymore, so the
  protection list is effectively dead. Leave for now — removing it is
  the kind of cleanup that might break a sibling tool's expectations.

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

### 3. piConfig Triplication: Root `package.json`, `packages/pi-coding-agent/package.json`, AND `pkg/package.json`
**Locations:** All three files carry a `piConfig` block

Three places must stay in sync. The truly load-bearing one is `pkg/package.json` — `src/loader.ts:84-88` explicitly sets `process.env.PI_PACKAGE_DIR=pkg/`, which short-circuits `getPackageDir()` in pi-coding-agent's `config.js` and forces it to read `pkg/package.json` regardless of where the import resolves from. The workspace-package's piConfig and the root piConfig are only used when `PI_PACKAGE_DIR` is unset (e.g., running tests / standalone imports, not when running the `loop24` binary).

A Phase 2c bug surfaced from this: `pkg/package.json` was left with the original gsd-pi piConfig (`name: "gsd"`, `configDir: ".gsd"`, no `commandNamespace`/`brandName`) after the fork. At TUI runtime, `getPackageDir()` returned `pkg/`, `COMMAND_NAMESPACE` fell back to `APP_NAME = "gsd"`, and every `pi.registerCommand(COMMAND_NAMESPACE, ...)` in the workflow extension registered under the literal name `"gsd"` — making `/loop24 status` return "Unknown command" while `/gsd` showed up in autocomplete but had no working dispatch. Fixed at commit `1ffe53c` (Phase 2c follow-up): aligned all three piConfigs to `{ name: "loop24", configDir: ".loop24", commandNamespace: "loop24", brandName: "LOOP24" }`.

Future cleanup: collapse to one source of truth (generate the other two from one canonical file, or remove the `pkg/` shim entirely if the loader can read from the workspace package). Until then, **any piConfig edit must update all three files in lockstep**. A CI parity check would catch drift cheaply.

### 4. Loop24 Signal Theme: JSON ↔ TS Const Duplication
**Location:** 
- Canonical JSON: `src/resources/extensions/loop24/theme/loop24.json`
- Runtime const: `packages/pi-coding-agent/src/modes/interactive/theme/themes.ts`

The canonical brand-palette artifact is the JSON file (lives under the extension dir). The runtime registration is an inlined typed const in `themes.ts`. They must be kept in sync manually. The root cause: `pi-coding-agent`'s tsconfig has `rootDir: ./src` constraint, preventing JSON imports from outside the package boundary. Future cleanup: resolve the import boundary or add tooling to generate one from the other.

### 5. GSD_FIRST_RUN_BANNER Env Var Alongside LOOP24_FIRST_RUN_BANNER
**Location:** `src/loader.ts`

Both `process.env.GSD_FIRST_RUN_BANNER` and `process.env.LOOP24_FIRST_RUN_BANNER` are set at startup. The legacy var is still read by `src/resources/extensions/workflow/tests/session-start-footer.test.ts`. A TODO comment in loader.ts flags this. Future cleanup: update that test to read `LOOP24_FIRST_RUN_BANNER` and remove the legacy var.

### 6. User-Facing Brand Strings — RESOLVED in Phase 0.5

The original deferred items in this section (config-overlay header,
key-manager header, onboarding headers, escalate helpMessage,
GSDNoProjectError reason, notifications title prefix, skip-usage
examples, ~30 `requireNotAutoActive` call sites, and the
auto-blocked-remediation test fixture) were swept in Phase 0.5 above.

Note: the deferred-item list incorrectly pointed at `packages/pi-coding-agent/src/config/…` and `packages/pi-coding-agent/src/commands/…` paths during Phase 0; the actual files live in `src/resources/extensions/workflow/`. The Phase 0.5 sweep operated on the real locations.

A smaller residue (auto.ts session banners, state.ts validation guidance,
auto-verification.ts, auto-dispatch.ts, undo.ts, commands-handlers.ts,
commands-workflow-templates.ts, commands-codebase.ts,
dev-workflow-engine.ts, doctor-format.ts, commands-inspect.ts) is listed
in the "Phase 0.5 residue" subsection above and remains for a future
Phase 0.6 cleanup sweep.

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
