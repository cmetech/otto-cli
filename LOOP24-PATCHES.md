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

## Cleanup C — GSD comment/JSDoc erasure (tagged: cleanup-c-comment-erasure)

First step toward the "no one should know we started from GSD" goal. Pure
brand erasure pass on comments and JSDoc — zero runtime behavior change,
just text cleanup.

### Scope (user-approved policy)

- **Style:** brand-neutral. Strip "GSD" mentions where redundant; use generic
  language ("the agent", "the workflow", "the CLI") over LOOP24 in comments.
  Future rebrands need a smaller surface to touch.
- **Directories:** `src/` + `packages/` + `scripts/`. Excludes `docs/`,
  `LOOP24-PATCHES.md`, test files, `dist/`, `node_modules/`.
- **Accuracy fixes folded in:** stale `~/.gsd/` paths → `~/.loop24/`,
  stale `@opengsd/gsd-pi` references → `@ericsson/loop24`.
- **NOT touched per policy:** internal env vars (`GSD_DEBUG`, `GSD_HOME`,
  `GSD_PKG_ROOT`, `GSD_WORKFLOW_PATH`, etc.), npm workspace scope
  (`@gsd/pi-coding-agent`, `@gsd/pi-ai`, `@gsd-build/*`), TypeScript
  identifiers (`GSDState`, `registerGSDCommand`, `GSDNoProjectError`),
  customType strings (`"gsd-add-tests"`, `"gsd-dispatch"`), error codes
  (`MISSING_GSD_MARKER`), filenames that haven't been renamed yet
  (`GSD-WORKFLOW.md`, `gsd-db.ts`, etc.). All deliberately deferred to
  the separate content-files-and-identifiers phase.

### Sweep statistics

- **547 files edited**
- **1,439 insertions / 1,440 deletions** (net -1 — comment swaps are 1:1)
- **3,300+ comment hits collapsed to 0** for the in-scope patterns
- **63/63 regression tests still pass** (comments don't affect runtime)
- **Build clean** (no JSDoc opener accidentally truncated)

### High-frequency batches handled mechanically

The subagent used `Edit replace_all` and `perl -i -pe` with comment-context
guards (`/^\s*(\/\/|\*)/`) for these repetitive patterns:
- `// Project/App: GSD-2` banner — 388 occurrences across 176 files
- `~/.gsd/` → `~/.loop24/` and `.gsd/` → `.loop24/` (accuracy)
- `github.com/open-gsd/gsd-pi/issues/XXXX` → `upstream #XXXX` (preserves
  issue numbers while dropping the upstream repo URL)
- `@opengsd/gsd-pi` → `@ericsson/loop24` (accuracy)
- Common component headers (`// GSD Extension —`, `GSD Auto Mode`, …)

The remaining ~37 stubborn cases were handled file-by-file with judgment.

### Judgment calls worth noting

- **`notifications.ts:31`** — `"GSD"` literal in a backward-compat string
  check kept as-is (refers to the literal value, not a brand mention).
- **`forensics.ts:970`** — `**GSD Version:** ${report.gsdVersion}` is a
  template literal in CODE (the regex matched `**` in markdown bold);
  left as-is per "code string literals unchanged" policy.
- **GitHub issue URLs** — replaced with `upstream #XXXX` rather than
  dropping them; preserves the issue number for future traceback.
- **`@opengsd/engine-{platform}`** in `packages/native/src/native.ts` —
  reframed comment to note LOOP24 doesn't ship Rust binaries; the legacy
  upstream path is documented for clarity but tagged as legacy.
- **`GSD-Task:` git trailer** mentioned in `git-service.ts` comments —
  rewritten as `Workflow-Task:` to match what the runtime actually emits.

### 15 remaining hits — out-of-policy-scope (separate phase)

All in CONTENT FILES (`.md` prompts/skills/fixtures the agent reads or
tests assert against), not comments:

- `src/resources/GSD-WORKFLOW.md` (the runtime workflow content)
- `src/resources/extensions/workflow/prompts/forensics.md`,
  `worktree-merge.md` (agent system prompts)
- `src/resources/extensions/workflow/tests/fixtures/pr-body/*.md` (×3)
- `src/resources/extensions/workflow/docs/preferences-reference.md`
- `src/resources/skills/decompose-into-slices/SKILL.md`
- `src/resources/skills/create-gsd-extension/**` (×3 — dir itself is
  GSD-named, both name + contents in the separate phase)
- `src/resources/skills/forensics/SKILL.md`
- `packages/native/src/gsd-parser/index.ts`, `types.ts` (×2 — dir name
  is `gsd-parser/`, both name + contents in the separate phase)

These are tracked for the next phase, which will:
1. Rename `GSD-WORKFLOW.md` → new name + update loader env var
2. Rename `gsd-*.ts` filenames (gsd-db, gsd-home, gsd-command-home,
   gsd-extension-api, gsd-phase-state, gsd-parser/) + every import
3. Rename `create-gsd-extension/` skill dir + skill registration
4. Sweep brand mentions inside all of the above content files
5. Test the agent end-to-end after renames (runtime risk)

### Diff summary

The 547-file change is large but reviewable: ~80% are 1-line edits
(file-banner `// Project/App: GSD-2` removal) or path-string swaps. The
remaining ~20% are judgment-rewritten JSDoc blocks with full context.

## Cleanup A — piConfig single-source-of-truth (tagged: cleanup-a-piconfig)

Eliminates the manual three-place piConfig sync. Root `package.json` is now
the canonical source; the workspace and `pkg/` mirrors are auto-synced on
every `prebuild` and verified on every `prepublishOnly`.

### Why three places exist (still, for now)

The three runtime contexts that read piConfig:
1. **Root `package.json`** — read by `src/brand.ts`, `src/help-text.ts`,
   `src/app-paths.ts`, `src/loader.ts` (the loader-fast synchronous
   JSON.parse path)
2. **`packages/pi-coding-agent/package.json`** — read by `getPackageDir()`
   in pi-coding-agent's `config.js` when `PI_PACKAGE_DIR` is unset (tests,
   standalone imports)
3. **`pkg/package.json`** — load-bearing for the CLI because
   `src/loader.ts:84-88` forces `PI_PACKAGE_DIR=pkg/`

Each file still physically exists in the repo (the JSON loaders read them
synchronously and can't follow imports), but they're no longer
hand-maintained.

### scripts/sync-piconfig.mjs (NEW)
Reads `piConfig` from root `package.json` and writes the same block into
`packages/pi-coding-agent/package.json` and `pkg/package.json`. Overwrites
each mirror's `_comment` field with an AUTO-SYNC notice. Idempotent — logs
"already in sync" when the mirrors match.

Mirrors the existing `scripts/sync-pkg-version.cjs` pattern for `version`.

### scripts/verify-piconfig-sync.mjs (NEW)
Exits 1 with a clear per-field diff if any mirror diverges from root.
Mirrors `scripts/verify-version-sync.cjs`. Run by `prepublishOnly` so a
stale publish is impossible.

Example failure (verified by drift test):
```
[verify-piconfig-sync] FAILED — piConfig out of sync:
  - pkg/package.json: piConfig.brandName = "DRIFT", expected "LOOP24" (from root)

Fix: edit root package.json piConfig, then run `npm run sync-piconfig`.
```

### package.json (MODIFIED)
- Root `piConfig._comment` rewritten to identify it as the CANONICAL source
- Mirrors' `_comment` fields rewritten by sync script to say "AUTO-SYNCED — do not edit directly"
- `prebuild` extended: now runs `sync-brand-colors && sync-piconfig`
- New scripts: `sync-piconfig`, `verify:piconfig-sync`
- `prepublishOnly` chain extended with `verify:piconfig-sync`

### To rebrand piConfig (the new workflow)

```bash
# Edit ONE file
vim package.json    # change piConfig.name / brandName / commandNamespace / configDir

# Sync + verify
npm run build       # prebuild auto-syncs; verify-piconfig-sync runs in prepublishOnly
```

That's it. The two mirrors will be regenerated by sync-piconfig.mjs.

### Combined with Cleanup B

To do a full rebrand (strings + colors) now requires editing exactly TWO
files plus running `npm run build`:

1. `package.json` → `piConfig` block (controls brand strings everywhere)
2. `src/brand-colors.ts` → hex + ANSI constants (controls brand colors everywhere)

Then `npm run build` propagates both via the `prebuild` chain:
- `sync-brand-colors.mjs` → mirrors `src/brand-colors.ts` → `src/resources/brand-colors.ts`
- `sync-piconfig.mjs` → mirrors root piConfig → workspace + pkg/

Still-manual sync points (documented):
- `scripts/install.sh` brand ANSI block (hex annotations make drift visible)
- TUI theme palette (`loop24.json` ↔ `themes.ts`) — Known Deferred Cleanups item 4

## Cleanup B — Brand color centralization (tagged: cleanup-b-brand-colors)

Collapses scattered inline hex literals + ANSI escapes into a single source
of truth. Changing a brand color now requires editing ONE file
(`src/brand-colors.ts`); a `prebuild` step mirrors it into the resources
tree for extensions to consume; `scripts/install.sh` (bash, can't import
TS) keeps its own mirror with hex comments next to each ANSI code so drift
is visible in diffs.

### Why this needed cleanup

Before this commit, the brand palette was hardcoded inline across 5 source
files plus the install script — 6+ places to edit for a palette swap. The
2026-05-24 audit (see `docs/npm-registry-options.md` predecessor
conversation) flagged this as the bigger rebrand-friction blocker than the
piConfig triplication.

### src/brand-colors.ts (NEW)
Canonical palette. Exports `BRAND_*_HEX` constants (10 colors), pre-computed
`ANSI_BRAND_*` 24-bit foreground escapes, `ANSI_RESET`, `ANSI_DIM`, and a
small `brandWrap(ansi, text)` helper (chalk replacement for the
loader-fast path that can't import chalk). No runtime parsing, no fs reads
— safe to import from `src/loader.ts` and other early-boot files.

### src/resources/brand-colors.ts (AUTO-GENERATED MIRROR)
TypeScript's two compile contexts (`tsconfig.json`: rootDir=src + excludes
resources; `tsconfig.resources.json`: rootDir=src/resources) prevent files
in either tree from importing across the boundary. The pragmatic fix: keep
ONE canonical file (`src/brand-colors.ts`) and auto-mirror it into the
resources tree at `prebuild` time.

The mirror file gets a header explaining where to edit instead. If
something inside `src/resources/extensions/*` needs to import brand colors,
it uses the mirror.

### scripts/sync-brand-colors.mjs (NEW)
~30-line Node script that copies `src/brand-colors.ts` → `src/resources/brand-colors.ts`
with a "DO NOT EDIT" header. Wired into `prebuild` so `npm run build` keeps
the mirror current automatically. Also available as `npm run sync-brand-colors`
for non-build invocation.

### package.json (MODIFIED)
- Added `prebuild` script that runs `sync-brand-colors.mjs`
- Added `sync-brand-colors` script alias

### 5 source files migrated from inline hex to imports

| File | Before | After |
|---|---|---|
| `src/loader.ts` | 4 inline ANSI escapes for banner colors | imports `ANSI_BRAND_YELLOW`, `ANSI_BRAND_GREEN`, `ANSI_DIM`, `ANSI_RESET` |
| `src/welcome-screen.ts` | 2× `chalk.hex('#FAD22D')` | imports `BRAND_YELLOW_HEX`, uses `chalk.hex(BRAND_YELLOW_HEX)` |
| `src/onboarding.ts` | inline brand-yellow ANSI escape | imports `ANSI_BRAND_YELLOW`, `ANSI_RESET` |
| `src/loop24-wizard.ts` | 2× inline brand-yellow ANSI escapes | imports `ANSI_BRAND_YELLOW`, `ANSI_RESET` |
| `src/resources/extensions/loop24/index.ts` | 4 inline ANSI escapes (gateway/langflow probe) | imports from `../../brand-colors.js` (the auto-synced mirror) |

### scripts/install.sh (MODIFIED)
Bash can't import TypeScript. The 4 brand ANSI escapes stay inline but each
line gets a hex comment annotation (`# #FAD22D — brand yellow`) and the
block has a header comment naming `src/brand-colors.ts` as the canonical
source. Drift between bash and TS is now visible in a diff because the hex
strings are spelled out.

### Out-of-palette colors left in place (not blocking)
`src/welcome-screen.ts` still has two non-brand inline hex literals:
- `#dce4f2` (line 169) — light off-white used by `value()` panel labels
- `#8db7ff` (line 170) — light blue used by `accent()` panel header

These look like inherited gsd-pi colors that don't appear in the LOOP24
brand palette (`loop24.json`). Future cleanup: replace with `BRAND_WHITE_HEX`
and `BRAND_YELLOW_HEX` respectively, OR add them to `brand-colors.ts` as
"panel/utility" colors. Flagged here for the eventual full-brand-audit pass.

### Still in two places (documented, not fixed by this cleanup)
The TUI theme palette is dual-tracked between `src/resources/extensions/loop24/theme/loop24.json`
(canonical JSON consumed by the TUI theme system) and
`packages/pi-coding-agent/src/modes/interactive/theme/themes.ts:loop24`
(inlined TypeScript const). They must stay in sync manually because the
workspace package's tsconfig has `rootDir:./src` and can't reach the
JSON file. Tracked as Known Deferred Cleanups item 4 — separate problem
from this scattered-hex issue.

### Net result
Edit `src/brand-colors.ts`, run `npm run build`, every visual surface
inside the TypeScript codebase updates. The bash install script and the
TUI theme palette (`loop24.json` + `themes.ts`) remain manual sync points,
each with explicit drift-visible comments.

## Phase 7 — Public npm publish prep (tagged: phase-7-npm-publish-prep)

Prepares the package for `npm publish` to `@ericsson/loop24` on the public
registry. The actual publish is a manual user step gated on:

1. Claiming the `@ericsson` org on npmjs.com
2. `npm login --scope=@ericsson --auth-type=web`
3. `npm publish --access public` from the repo root

Mirrors `@opengsd/gsd-pi`'s tarball pattern (`files`-array bundling of the
whole workspace; no `bundledDependencies`; postinstall handles install-time
wiring). Inspected gsd-pi's published tarball before deciding the shape —
49MB / 9663 files; our equivalent lands at 11.6MB / 6951 files (smaller
because Phase 0 dropped `web/`, `vscode-extension/`, `studio/`, `native/`).

### scripts/install.js (MODIFIED)
The npx entry point. When someone runs `npx @ericsson/loop24`, this script
fires. Previously hardcoded to tell users to install `@opengsd/gsd-pi` —
catastrophic for a forked publish. Templated all user-visible literals:

- New top-of-file constants block reads `name`, `piConfig.brandName`,
  `piConfig.commandNamespace` from `package.json` (joins the existing
  version-read block); reasonable fallbacks (`@ericsson/loop24` /
  `LOOP24` / `loop24`) if parse fails.
- ASCII GSD banner replaced with a one-line `${BRAND} v${version}` text
  banner — install script runs once during npx, doesn't need to mirror
  the runtime banner exactly.
- 8 `@opengsd/gsd-pi` literals (help text, spinner labels, `npm install`
  commands in `installGlobally()` and `installLocally()`, error
  remediation strings) all flow through `${PKG_NAME}`.
- `User-Agent: 'gsd-pi-installer'` (2 sites, RTK download fetches) now
  `\`${CMD}-installer\``.
- `bin = 'gsd'` and `.bin/gsd` path → `bin = CMD`.
- Final "Run: gsd" message → `Run: ${CMD}`.
- Internal env vars (`GSD_HOME`, `GSD_SKIP_RTK_INSTALL`,
  `GSD_RTK_DISABLED`) intentionally untouched per Known Deferred
  Cleanups item 7 (breaking change for users who knew them from gsd-pi).
- Top-of-file JSDoc reframed to describe `@ericsson/loop24` invocation.
- 19 edits total.

### package.json (MODIFIED)
- `name`: `@loop24/client` → `@ericsson/loop24`
- `description`: rewritten as public registry blurb:
  "Terminal-based developer chat assistant. Permanent hard fork of gsd-pi
   with LangFlow flow triggers, a flow builder, and optional gateway
   routing for compliance environments."
- `keywords`: added (ai, agent, cli, terminal, langflow, anthropic,
  claude, compliance, developer-tools)
- `repository.url`, `homepage`, `bugs.url`: placeholder GitHub URLs
  (`PLACEHOLDER-cmetech/loop24-client`) — grep-able by the `PLACEHOLDER-`
  prefix; final URLs land when the public GitHub repo is created (user
  opted to "publish from local; sort GitHub later")
- `files`: removed orphan `dist/web` entry (Phase 0 dropped the web/
  source); added explicit `LICENSE` entry (npm auto-includes LICENSE
  but explicit is clearer)
- `prepublishOnly`: simplified from the inherited gsd-pi chain.
  Dropped `sync-platform-versions` (references deleted `native/scripts/`
  per Known Deferred Cleanups item 2) and `validate-pack` (hardcodes
  `@opengsd/gsd-pi` at line 155 — needs Phase 7.1 fix before re-enabling).
  Remaining chain: `sync-pkg-version && verify:version-sync &&
  prepublish-check && build && typecheck:extensions`. Fast enough.
- piConfig untouched (still `loop24`/`LOOP24`). Independent of npm
  package name.

### README.md (MODIFIED)
- New top-of-file fork attribution block citing `open-gsd/gsd-pi` and
  MIT license
- Overview reframed: "internal compliance proxy" → "optional gateway
  routing for compliance environments". First bullet now opens with
  "Optionally routes…"
- Status: removed "internal release" language; reframed as "early release.
  Install via npm or clone the repo."
- Quickstart: `npm install -g @ericsson/loop24` is now the **primary**
  install path. Clone+install.sh moved to "Install from source
  (contributors)" subsection.

### LOOP24-PATCHES.md (AUDIT — one edit)
Audited for public-leak risks. Found one: line 695 (Phase 4 section)
referenced a specific internal gitlab path. Generalized to "the upstream
langflow-flow-builder Claude Code skill (source location depends on local
checkout)". No embedded credentials, no other identifying internal-host
references. `localhost:7860` (default LangFlow port) is fine — that's a
public default, not internal.

### Verification (Task 5 — `npm pack` dry-run + local install)
- Tarball: `ericsson-loop24-1.0.1.tgz` — 11.6 MB packed, 54 MB unpacked,
  6951 files
- Tarball does NOT include `.git/`, `.env`, `.planning/`,
  `docs/superpowers/`, or `node_modules` at the root (only nested
  `packages/daemon/node_modules/` which is **intentional** — daemon
  pins `@anthropic-ai/sdk ^0.52.0` while root needs `^0.90.0`,
  incompatible majors)
- Local install in `mktemp -d`: completes in ~18s, creates symlink
  `node_modules/.bin/loop24 → @ericsson/loop24/dist/loader.js`
- `loop24 --version` → `1.0.1`
- `loop24 --help` → `LOOP24 v1.0.1 — compliant agent for developers`

### Manual publish protocol (when @ericsson org is claimed)

```bash
# 1. One-time setup
npm login --scope=@ericsson --auth-type=web

# 2. Bump version (1.0.1 → 1.1.0 for first public LOOP24 release)
npm version minor --no-git-tag-version

# 3. Dry-run
npm publish --dry-run --access public

# 4. Publish
npm publish --access public

# 5. Verify
sleep 10
npm view @ericsson/loop24
npx @ericsson/loop24 --version
```

### Deferred follow-ups
- Real GitHub repository (replace `PLACEHOLDER-cmetech/loop24-client` in
  `package.json`)
- CI publish workflow (currently manual `npm publish`)
- Fix `scripts/validate-pack.js:155` hardcoded `@opengsd/gsd-pi` so
  `validate-pack` can be re-enabled in `prepublishOnly` for production
  publishes
- Republishing `@gsd/*` workspace packages under `@ericsson/*` scope —
  gsd-pi proved this is unnecessary (workspace pkgs ship as files
  inside the tarball)
- npm 2FA / automation tokens
- Version-bump automation
- Public CHANGELOG generation

## Phase 6 — Install script + docs (tagged: phase-6-install-docs)

Phase 1 distribution per design spec §7: clone + install.sh + symlink +
wizard. Three deliverables — no runtime code changes.

### scripts/install.sh (NEW)
POSIX-portable bash, idempotent. Flow:
  1. Verify repo root looks like loop24-client (package.json contains
     `"@loop24/client"`)
  2. Prereq checks: git, Node ≥22, npm (required); python3 (optional, warn
     only — only build-flow needs it)
  3. `npm install` + `npm run build`
  4. Symlink `dist/loader.js` → `~/.local/bin/loop24` (override target dir
     with `--bin-dir DIR`)
  5. Print PATH advice if `~/.local/bin` not on PATH
  6. Offer to launch `loop24 config all` (skip with `--no-wizard` or in
     non-interactive shells)

Flags: `--no-wizard`, `--bin-dir DIR`, `-h|--help`. Uses 24-bit ANSI for
brand colors when stdout is a TTY; degrades to plain text otherwise.
Re-runnable safely on an existing install.

### docs/INSTALL.md (NEW)
Long-form install/uninstall/troubleshoot guide. Sections:
  - Prerequisites (required + per-feature optional)
  - Install (recommended: `scripts/install.sh`; alternative: manual steps)
  - Update (git pull + re-run install.sh)
  - Uninstall (symlink + workspace + optional `~/.loop24/` state)
  - Troubleshooting (Node version, PATH, build failure, missing python3,
    LangFlow offline, no API key, headless dispatch limitation)

### README.md (REPLACED)
Rewritten from the inherited gsd-pi shape. New structure:
  - One-paragraph LOOP24 overview (compliance proxy + local tools +
    LangFlow integration)
  - Status note (v0.x internal release; Phase 7 npm publish blocked on
    registry availability)
  - Quickstart (3-line `git clone` + `install.sh`)
  - "What's inside" table (build-flow, prompt-engineer, flow triggers,
    inherited workflow commands)
  - Documentation links (INSTALL.md, design spec, plans, LOOP24-PATCHES.md)
  - Configuration table (7 env vars + their defaults)
  - License pointer

Removed: gsd-pi history, `npm install -g @opengsd/gsd-pi` install hints,
"migrate from older installs" section, Discord community link, Star History
chart, repository-layout table (referenced dropped dirs `studio/`, `web/`,
`vscode-extension/`, `native/`). License preserved (MIT, inherited from
upstream — see `LICENSE`).

### Clean-room verification
Cloned the repo into a fresh temp dir, ran
`./scripts/install.sh --no-wizard --bin-dir <temp>/bin`:
  - All prereq checks pass on this laptop (git 2.x, Node v22+, npm,
    python3 3.12.9)
  - `npm install` + `npm run build` complete cleanly
  - Symlink created at the target bin dir
  - `loop24 --version` prints `1.0.1`
  - `loop24 --help` prints `LOOP24 v1.0.1 — compliant agent for developers`
  - **End-to-end elapsed time: 41 seconds**

### Out of scope (deferred to Phase 7)
- `npm install -g @loop24/client` (Phase 7, blocked on internal npm
  registry — see open Q4 in design spec)
- `loop24 update` self-update command (current update path: `git pull && ./scripts/install.sh --no-wizard`)
- Windows install (macOS + Linux only in v1 per design spec)
- Homebrew formula

## Phase 5 — Prompt engineer command (tagged: phase-5-prompt-engineer)

Per design spec §6.4 — the "smallest piece" in the LOOP24 roadmap. Ships
`/loop24 prompt-engineer <description>` — a one-shot LLM call that turns a
rough developer request into a polished prompt suitable for handing to a
coding agent.

### src/resources/extensions/loop24/commands/prompt-engineer/_template.ts (NEW)
Exports `PROMPT_ENGINEER_SYSTEM` — opinionated system prompt that instructs
the model to polish a rough description into a structured coding-task prompt
(goal sentence, files involved, success criteria, constraints, tactical
approach, ask-clarifying-questions ending). Explicitly forbids preamble so
the handler can write the response verbatim to stdout. 2 sanity tests.

### src/resources/extensions/loop24/commands/prompt-engineer/_storage.ts (NEW)
`savePromptHistory({description, polished, modelId, baseDir?})` writes
`<baseDir>/<YYYY-MM-DD>-<slug>.md` atomically (tmp + rename, mode 0600).
Default baseDir: `~/.loop24/prompts/`. Slug is kebab-cased ASCII (NFKD →
strip combining diacritics → alnum + hyphen) truncated at word boundaries
to ≤50 chars; falls back to `"prompt"` for input with no slug-able chars.
Same-day same-slug collisions get a UTC time suffix (then a numeric suffix
on sub-second collisions). 7 TDD tests.

### src/resources/extensions/loop24/commands/prompt-engineer/command.ts (NEW)
`registerPromptEngineerCommand(pi)` — registers `/loop24 prompt-engineer`.
Handler:
  1. Usage hint on empty args
  2. Direct `@anthropic-ai/sdk` call (`messages.create`, max_tokens 4096)
  3. Honors `LOOP24_GATEWAY_URL` (gateway mode, optional `LOOP24_GATEWAY_TOKEN`
     Bearer via SDK's `authToken` field) or `ANTHROPIC_API_KEY` (direct mode);
     fails clear if neither configured
  4. Model defaults to `claude-haiku-4-5-20251001`; override with
     `LOOP24_PROMPT_ENGINEER_MODEL`
  5. Prints polished prompt to stdout (the deliverable)
  6. Saves a copy via `savePromptHistory()`; surfaces save path to stderr;
     save failures are non-fatal — stdout output is already delivered

Uses `TextBlock` from `@anthropic-ai/sdk/resources/messages/messages.js` for
the content-block predicate (SDK's `TextBlock` has a required `citations`
field that an inline shape can't satisfy).

No TDD on the handler — LLM call is the integration boundary; template +
storage are fully TDD-covered.

### src/resources/extensions/loop24/index.ts (MODIFIED)
Added `registerPromptEngineerCommand(pi)` call between the Phase 4
`registerBuildFlowCommand(pi)` and the Phase 3 `loadFlowTriggers(...)` block.
Docblock updated to mention Phase 5.

### src/resources/extensions/loop24/extension-manifest.json (MODIFIED)
Version 0.2.0 → 0.3.0. Description updated to mention Phase 5.
`provides.commands` extends to `["build-flow", "prompt-engineer"]`.

### src/headless.ts (MODIFIED — incidental fix surfaced by live smoke)
Two hardcoded `/gsd` literals templated via `COMMAND_NAMESPACE`:
  - `buildHeadlessSlashCommand()` at line 95 (emitted `/gsd <cmd>` for every
    headless invocation visible in `[headless] Running ...` messages)
  - Auto-mode chaining at line 1002 (sent literal `/gsd auto` after milestone
    creation)
Both now use ``/${COMMAND_NAMESPACE} `` template literals.

### New env vars
- `LOOP24_PROMPT_ENGINEER_MODEL` — optional override for the model used by
  `/loop24 prompt-engineer`. Defaults to `claude-haiku-4-5-20251001`.

### Tests added
`prompt-engineer-template.test.ts` (2), `prompt-engineer-storage.test.ts` (7)
= **9 new tests**, all passing. Full regression at end of Task 4: **63/63 pass**.

### Deferred / out-of-scope (controller decision)
- `/loop24 prompts list` and `/loop24 prompts show <id>` — browse via
  `ls ~/.loop24/prompts/` and `cat ...` until a list command lands.

### Architectural limitation surfaced
`loop24 headless <cmd> <args>` dispatches via the workflow extension's
command catalog. Extension-registered commands like `loop24__build-flow`
(Phase 4) and `prompt-engineer` (Phase 5) are NOT reachable through that
path — headless falls through to `/gsd quick <args>` for any unrecognized
command name. The commands ARE registered (confirmed via
`LOOP24_DEBUG_EXTENSIONS=1`) and work in the interactive TUI; the headless
gap is pre-existing (Phase 4's build-flow has the same issue) and out of
Phase 5 scope. Fixing it requires extending headless's dispatch table to
consult `pi.registeredCommands`, not just the workflow catalog.

## Phase 0.6 — Residue sweep (tagged: phase-0.6-residue-sweep)

Cleanup pass on user-visible `/gsd` and `"GSD"` string literals that escaped
Phase 0, 0.5, and 2c. The original Phase 0.5 residue list (auto.ts,
auto/phases.ts, state.ts, auto-verification.ts, auto-dispatch.ts, undo.ts,
commands-handlers.ts, commands-workflow-templates.ts, commands-codebase.ts,
dev-workflow-engine.ts, doctor-format.ts, commands-inspect.ts) was verified
fully addressed in Phase 2c — only comments remain there (out of scope per
Known Deferred Cleanups item 8).

This sweep targets eight files NOT in the prior residue list whose user-visible
literals escaped detection until a comprehensive grep at the end of Phase 4.

### Files swept (single commit)

- **`auto-dashboard.ts`** (6 edits): three `commands:` arrays of `/gsd …` shortcuts in session/closeout banners templated via `slashCommand()`; two `theme.fg("accent", theme.bold("GSD"))` headings now use `BRAND`; step-mode hint at the auto-loop end.
- **`commands-logs.ts`** (5 edits): "View details" tips, the activity-log-not-found warning, the "before /gsd auto" tip. `GSD_DEBUG=1` env var deliberately untouched per Known Deferred Cleanups item 7.
- **`shortcut-defs.ts`** (3 edits): keyboard shortcut `command:` fields for `/gsd status`, `/gsd notifications`, `/gsd parallel watch`.
- **`doctor-providers.ts`** (4 edits): `Run /gsd keys` remediation strings in two doctor blocks (LLM provider + remote-questions).
- **`guided-flow.ts`** (3 edits): plan-gate failure hint pointing at `/gsd doctor heal`; AI-facing system context referencing `\`/gsd new-project --deep\``; corrupted-state hint pointing at `/gsd doctor`.
- **`worktree-lifecycle.ts`** (1 edit): milestone-merge-failed error pointing at `/gsd dispatch complete-milestone`.
- **`init-wizard.ts`** (12 edits): nine `notYetMessage: "Run /gsd init when ready."` entries (templated via `replace_all`), two `/gsd prefs project` hints, and the generated PREFERENCES.md header `"Generated by \`/gsd init\`. Edit directly or use \`/gsd prefs project\` to modify."`.
- **`commands-memory.ts`** (11 edits): every `"Usage: /gsd memory …"` notify (8 sites), the "No memory sources yet" hint, the extract-dispatch tip, and the import usage banner.

### Imports

Each file gains `import { slashCommand } from "./strings.js"` (or `{ BRAND, slashCommand }` for the two files that also needed the brand constant). Two files (`commands-logs.ts`, `init-wizard.ts`) already imported from `./strings.js` — extended in place rather than duplicating. All imports verified used-only (no dead imports introduced).

### Residue still deferred (deliberately out of scope)

- **Comments and JSDoc** mentioning `/gsd` or `"GSD"` — ~500 hits across the workflow extension. Documentation-only, not load-bearing. Tracked in Known Deferred Cleanups item 8.
- **Internal identifiers** — function names, type names, customType strings, error codes (`MISSING_GSD_MARKER`), env vars (`GSD_DEBUG`, `GSD_PKG_ROOT`, `GSD_HOME` legacy), npm scope `@gsd/`. Item 7.
- **One bare `gsd auto` reference** in `commands-logs.ts:421` ("Enable debug logging: GSD_DEBUG=1 gsd auto") — appears without a slash so doesn't match the standard `/gsd` grep. Spotted by the implementer but left untouched to match the env-var stay-as-is policy on the same line.

### Tests verified
`packages/pi-coding-agent/src/config.test.ts` + the 6 standing workflow tests + all 8 loop24 tests (Phase 3 + 4): **65/65 pass, 0 fail**. `npm run build` clean.

## Phase 4 — LangFlow flow builder (tagged: phase-4-flow-builder)

Ports the upstream `langflow-flow-builder` Claude Code skill to a first-class
Pi extension. Adds `/loop24 build-flow <description>` — a natural-language →
LangFlow JSON flow generator backed by seven typed Pi tools (TypeBox parameter
schemas) wrapping bundled Python scripts.

### src/resources/extensions/loop24/tools/scripts/ (NEW — 7 files)
Verbatim copy from the upstream `langflow-flow-builder` Claude Code skill (source location depends on local checkout):
`refresh_component_catalog.py`, `normalize_component_catalog.py`,
`check_catalog_health.py`, `inspect_component.py`, `validate_flow.sh`,
`import_flow.py`, `smoke_test_flow.py`. All marked executable.
Byte-for-byte match with source confirmed via `diff -r`.

### src/resources/extensions/loop24/reference/ (NEW — 4 files)
Verbatim copy of `workflow.md`, `component-catalog-rules.md`,
`edge-handle-rules.md`, `flow-json-rules.md` from the same source skill.
Loaded as system context by `/loop24 build-flow` (see _system-context.ts).

### src/resources/extensions/loop24/tools/python-runtime.ts (NEW)
`runPython(scriptPath, args, opts)` / `runBash(scriptPath, args, opts)`
spawn helpers. `ensurePython3()` resolves `LOOP24_PYTHON_BIN` (override) → `python3`
on PATH; returns a structured error if missing. Every tool call surfaces
missing-python as exitCode 127 with an install-docs hint.
2-minute default timeout; exitCode 124 on timeout (coreutils convention).
TDD: 7 passing tests.

### src/resources/extensions/loop24/tools/{refresh,normalize,check}-catalog.ts + {inspect,validate,import,smoke}-*.ts (NEW — 7 files)
One TS file per tool. Each exports a `ToolDefinition` with a TypeBox
parameter schema (verified shape: `{ content: TextContent[], details: T }`
on success, plus `isError: true` on failure — matches the existing pattern
in `src/resources/extensions/context7/index.ts`). Execute() shells out via
python-runtime.ts and returns combined stdout/stderr as tool-result text.
- No-arg tools (`refresh_catalog`, `normalize_catalog`, `check_catalog_health`)
  use `Type.Object({})`.
- Single-positional-arg tools (`inspect_component`, `validate_flow`,
  `import_flow`) take a `searchTerm` or `flowFile` string with `minLength: 1`.
- `smoke_test_flow` takes two args (`flowId`, `message`) and a 180-second timeout.
- `validate_flow` uses `runBash` (not `runPython`) — the bundled script is `.sh`.
- `inspect_component` differentiates exit-2 ("no matches") from other non-zero
  exits ("error") — only the latter sets `isError: true`.

### src/resources/extensions/loop24/tools/_loader.ts (NEW)
Exports `LOOP24_TOOL_NAMES` (readonly tuple of the seven tool names) and
`registerLoop24Tools(pi)` for index.ts to call at extension load.
Tools are eagerly registered — available from any conversation, not only
inside `/loop24 build-flow` (e.g., users may want the model to refresh the
catalog while debugging an existing flow). 2 TDD tests.

### src/resources/extensions/loop24/clients/langflow.ts (MODIFIED)
Added `importFlow(payload, timeoutMsOverride?)`. POSTs JSON to `/api/v1/flows/`.
Reuses existing `_fetch` for auth (`x-api-key`) and timeout. Distinct from
the bundled `import_flow.py` script which uses `/api/v1/flows/upload/`
multipart; both ship — Python wrapper for the build-flow agent's tool use,
TS method as a programmable surface for future imperative commands.
3 TDD tests against in-process mock server.

### src/resources/extensions/loop24/commands/build-flow/_scaffold.ts (NEW)
`ensureRepoConventions(cwd)` creates `flows/{generated,templates,imported}`
and `catalog/`. Patches `.gitignore` to skip the regenerable catalog cache
(`catalog/components.raw.json`, `catalog/components.normalized.json`,
`catalog/component-index.md`). Idempotent — safe to call every
`/loop24 build-flow` invocation. 4 TDD tests.

### src/resources/extensions/loop24/commands/build-flow/_system-context.ts (NEW)
`loadReferenceDocs()` reads the four bundled `reference/*.md` files and
concatenates them with file-header banners. Load order matters: `workflow.md`
first (establishes the process), then the rules docs (catalog → edges → JSON).
3 TDD tests.

### src/resources/extensions/loop24/commands/build-flow/command.ts (NEW)
`registerBuildFlowCommand(pi)` — registers `/loop24 build-flow <description>`.
Handler:
  1. usage hint on empty args
  2. `ensureRepoConventions(ctx.cwd)` (stderr notes on dir/gitignore changes)
  3. `loadReferenceDocs()` to assemble the system context
  4. `ctx.newSession({ workspaceRoot: ctx.cwd })` — fresh session for this task
  5. `pi.sendMessage({ customType: "loop24-build-flow", content: prompt, display: false }, { triggerTurn: true })`

Same dispatch seam used by `src/resources/extensions/workflow/auto-direct-dispatch.ts:307-310`.
The composed prompt embeds the four reference docs plus a tool catalog
preamble and repo conventions.

### src/resources/extensions/loop24/index.ts (MODIFIED)
After Phase 1's `session_start` hook and BEFORE Phase 3's `loadFlowTriggers`,
added two new lines at extension-init time:
  - `registerLoop24Tools(pi)` — seven tools registered eagerly
  - `registerBuildFlowCommand(pi)` — `/loop24 build-flow` registered

Verified live: `LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "hi" 2>&1 | grep "loop24-debug" | grep "build-flow"`
emits `registered command 'build-flow' from .../loop24/index.js`.

### src/resources/extensions/loop24/extension-manifest.json (MODIFIED)
Version bumped 0.1.0 → 0.2.0. `description` updated to mention Phase 3 + 4.
`provides.tools` enumerates the seven flow-builder tools; `provides.commands`
declares `["build-flow"]`.

### Tests added
`python-runtime.test.ts` (7), `langflow-import-flow.test.ts` (3),
`tools-loader.test.ts` (2), `build-flow-scaffold.test.ts` (4),
`build-flow-system-context.test.ts` (3) = **19 new tests**, all passing.
Full regression at end of Task 9: **54/54 pass**.

### Hard dependency: Python 3
The seven tool wrappers shell out to `python3`. If python3 is not on PATH,
each tool returns exitCode 127 with an install-docs hint. Override with
`LOOP24_PYTHON_BIN` if the interpreter is at a non-standard path.
Python is **NOT bundled** — install it via your package manager.

The bundled Python scripts depend on the `requests` PyPI package
(`refresh_component_catalog.py`, `import_flow.py`, `smoke_test_flow.py`).
`validate_flow.sh` optionally uses the `lfx` CLI for LangFlow schema
validation; degrades to JSON-syntax-only validation when absent.

### New env var: LOOP24_PYTHON_BIN
Optional override for the python3 interpreter resolution. Used by
`tools/python-runtime.ts:ensurePython3()`.

### Live verification (deferred)
Per-controller decision: the `/loop24 build-flow "summarize a chunk of text"`
end-to-end live test against the user's running LangFlow at
`http://localhost:7860` was deferred — to be run manually by the user.
The Phase 4 surface is verified wired (registration + autocomplete + 54
regression tests + `loop24-debug` smoke), but the multi-tool agent loop
that actually generates the flow JSON has not been exercised live in this
session.

## Phase 8 — GSD identifier + content-file erasure (tagged: phase-8-gsd-identifier-erasure)

Picks up where Cleanup C left off: filename renames, TypeScript identifier
renames, env-var compat shims, and the remaining content-file content sweep.
Cleanup C focused on comments/JSDoc as a low-risk first pass; Phase 8
absorbs the higher-risk runtime touchpoints.

### Scope (user-approved policy)

- **Filenames:** drop the `gsd-` prefix from internal TypeScript files; rename
  the bundled `GSD-WORKFLOW.md` content file; rename the `create-gsd-extension`
  skill directory; rename `packages/native/src/gsd-parser/` directory.
- **Identifiers:** drop `GSD`/`Gsd` from function names, type names, and
  module-level constants. Resolve collisions with pre-existing names by
  prefixing `Workflow` (e.g., `GSDState` → `WorkflowDbState` not `State`,
  because `State` collides; `Project` was pervasive so `GSDProject` →
  `WorkflowProject`).
- **Env vars:** introduce `LOOP24_X` as canonical with `GSD_X` as fallback.
  Production code reads `LOOP24_X ?? GSD_X` and setters write both. Tests
  continue using `GSD_X` directly; the compat shim keeps them green.
- **Content files:** brand-neutral sweep of the 14 Cleanup-C-residue files
  (`WORKFLOW.md`, workflow prompts, preferences-reference, decompose-into-slices
  SKILL, create-extension SKILL, forensics SKILL, native parser JSDoc).

### What was done (commits in order)

- **Task 1** (`a459679`, `378de28`, `d7c62f4`): produced
  `docs/superpowers/notes/PHASE8-NAMING-MAP.md` — full audit of every GSD
  identifier in `src/`/`packages/` with proposed new names and pre-flight
  collision checks. Three rounds of map updates during execution captured
  mid-flight discoveries (see "Mid-flight discoveries" below).
- **Task 2** (`ef0cf73`): 8 TS file renames (`gsd-phase-state.ts` →
  `phase-state.ts`, `gsd-db.ts` → `db.ts`, `gsd-home.ts` → `home.ts`, plus
  5 more) with 348 importer updates via quote-bounded extension-anchored perl.
- **Task 3** (`2f790c2`): `packages/native/src/gsd-parser/` → `parser/`
  with 2 importer updates (barrel `index.ts` + subpath in `package.json`).
- **Task 4** (`90026dd`): `GSD-WORKFLOW.md` → `WORKFLOW.md` +
  `LOOP24_WORKFLOW_PATH` env var with `GSD_WORKFLOW_PATH` fallback. 3 production
  readers updated, 5 production setter files, plus 7 test files' filename
  literals.
- **Task 5** (`58417bd`): `create-gsd-extension/` skill dir → `create-extension/`
  (22 files; preserves history at R090-R100). 4 reference sites updated.
- **Task 6** (`d45321c`): 23 function identifier renames across 70 files via
  word-boundary perl. `handleGSDCommand` → `dispatchWorkflowCommand`,
  `runGSDDoctor` → `runDoctor`, `registerGSDCommand` → `registerWorkflowCommand`,
  plus 20 more.
- **Task 7** (`7731226`): 30 type/class identifiers + 23 module-level constants
  across 167 files. Collision-resolved names: 8 pervasive types get `Workflow*`
  prefix (`GSDProject` → `WorkflowProject` because `Project` had 508 hits, etc.).
- **Task 8** (`e3ae047`): `LOOP24_X` canonical + `GSD_X` fallback compat shim
  for 30 env vars across 56 production files. Pattern: reader sweep with
  negative lookahead to skip setters; setter sweep with chained assignment
  (`process.env.LOOP24_X = process.env.GSD_X = expr`); env-spread literals
  duplicate the key; string-constant env-var-name helpers gain LOOP24_*
  siblings; Object.prototype.hasOwnProperty checks both keys.
- **Task 9** (`44c2d8e`): brand-neutral content sweep of the 14 Cleanup-C
  residue files (~60 GSD mentions removed) plus the 4 source-file strings
  that generate test-fixture content. 3 PR-body golden fixtures regenerated
  via `UPDATE_GOLDENS=1`.

### Mid-flight discoveries

The naming map's initial audit was incomplete in two ways that surfaced during
execution and required map updates:

1. **15 names initially listed as "module constants" in the map's Section 4
   were actually used as `process.env.X` reads** (e.g., `GSD_MILESTONE_LOCK`,
   `GSD_PARALLEL_WORKER`, `GSD_WORKFLOW_EXECUTORS_MODULE`,
   `GSD_PERSIST_WRITE_GATE_STATE`, `GSD_STARTUP_TIMING`, `GSD_VERBOSE`, etc.).
   Discovered during Task 7 spot-check. Reclassified to Section 5 (env vars)
   and absorbed into Task 8's compat-shim treatment. Section 4 shrunk from
   38 → 23; Section 5 grew from 15 → 30. Committed separately at `d7c62f4`.

2. **22 additional production env vars not in the naming map at all** —
   discovered during Task 8 inventory pass. These include `GSD_HEADLESS`,
   `GSD_WEB_HOST`, `GSD_WEB_PORT`, `GSD_WEB_AUTH_TOKEN`, `GSD_WEB_PROJECT_CWD`,
   `GSD_WORKFLOW_MCP_*`, `GSD_CLI_PATH`, `GSD_DEV_CLI_PATH`, `GSD_PROJECT_ID`,
   `GSD_AGENT_DIR`, `GSD_CLAUDE_DEBUG`, `GSD_DISABLE_LSPMUX`,
   `GSD_DISABLE_WORKTREE_WRITE_GUARD`, `GSD_ENABLE_NATIVE_TUI_HIGHLIGHT`,
   `GSD_FAKE_LLM_TRANSCRIPT`, `GSD_FETCH_ALLOWED_URLS`, `GSD_LEGACY_TELEMETRY_FILE`,
   `GSD_NATIVE_DISABLE`, `GSD_RTK_PATH`, `GSD_SKILL_MANIFEST_STRICT`,
   `GSD_STATE_DIR`, `GSD_UOK_FORCE_LEGACY`, `GSD_UOK_LEGACY_FALLBACK`,
   `GSD_WEB_ALLOWED_ORIGINS`, `GSD_WEB_BRIDGE_TUI`, `GSD_WEB_HOST_KIND`,
   `GSD_WEB_PACKAGE_ROOT`, `GSD_WEB_PROJECT_SESSIONS_DIR`, `GSD_WORKER_MODEL`.
   These remain GSD_X-only in production code; tracked in "Known Deferred
   Cleanups" below.

3. **Functions with verb prefixes outside the map's audit pattern.** The
   inventory grep required a verb prefix from a closed list (`read|write|get|set|create|init|load|save|build|run|dispatch|...`).
   Function names like `resolveGsdRoot`, `resolveGsdRootFile`, `ensureGsdSymlink`,
   `syncGsdStateToWorktree`, `resolveGsdPathContract`, `executeGsdExec` use
   verbs (`resolve`, `ensure`, `sync`, `execute`) that weren't in the list and
   were missed. These are still GSD-prefixed; tracked in "Known Deferred
   Cleanups".

### Out of scope (per plan)

- **npm workspace scope** `@gsd/pi-coding-agent`, `@gsd/pi-ai`, `@gsd/pi-tui`,
  `@gsd/pi-agent-core`, `@gsd-build/contracts`, `@gsd-build/rpc-client`,
  `@gsd-build/mcp-server`, `@gsd-build/daemon` → Phase 9 (916 references;
  biggest by raw count).
- **customType protocol strings** `"gsd-add-tests"`, `"gsd-dispatch"`,
  `"gsd-spike"`, etc. → Phase 10 (would break forward compatibility on
  persisted session files without migration logic).
- **`.gsd/` runtime directory references** (1,695 hits) → Phase 10
  (operational; coordinated with customType strings since both shape persisted
  artifacts the runtime reads on restart).
- **LICENSE attribution** to Lex Christopherson — MIT requires retention.
- **README "Fork attribution" block** — MIT requires reasonably prominent
  surface.
- **LOOP24-PATCHES.md** — the file's purpose is to document the fork.
- **Commit history** — destructive to rewrite, breaks tags.
- **`GSD-Task:` commit trailer** — operational metadata parsed by
  `auto-recovery.ts` and asserted in 5+ tests; renaming requires coordinated
  writer/parser/test changes that exceed Task 9's content-sweep scope.
- **`docs/branding/`** — user-owned working area.

### Verification results

- **Build:** `npm run build` clean (exit 0) after every task.
- **Standing regression:** 74/74 pass throughout (the plan's 65-test set
  has grown to 74 since plan was written).
- **Workflow-extension supplemental set:** 65/67 pass — the 2 failing tests
  (`derive-state-db: DB-unavailable runtime does not derive...` and
  `derive-state-db: needs-attention with all slices done returns blocked`)
  hardcode `/gsd migrate` and `/gsd park` slash-command literals in their
  assertions. Both pre-date Phase 8 (introduced in fork-import commit
  `bb6da93`); the strings broke when `COMMAND_NAMESPACE` was changed to
  `"loop24"` in an earlier phase. NOT caused by Phase 8 renames.
- **`typecheck:extensions`:** 3 pre-existing stale import paths
  (`commit-linking.test.ts`, `remote-answer-normalization.test.ts`,
  `milestone-status-authoritative.test.ts` reference deleted
  `gsd/` extension paths from a pre-Phase-8 rename). NOT caused by Phase 8.

### Why a compat shim instead of a hard rename for env vars

Hard rename would require updating every external script and configuration
that exports `GSD_*` env vars. The compat shim lets external setters
(shell aliases, systemd units, CI pipelines, user dotfiles) keep using
`GSD_X` while internal code reads `LOOP24_X` first. Later cleanup can drop
the `GSD_X` fallback once external surfaces are migrated.

### Diff summary across Phase 8

- Tasks 2-9 commits: 770 files changed, ~1900 line edits net.
- Identifier renames: 76 distinct names (23 functions, 30 types, 23 constants).
- Env-var compat shims: 30 vars (15 from plan + 4 added Task 1 + 11 reclassified Task 7).
- File renames: 31 files (8 TS + 22 skill-dir + 1 markdown).
- Directory renames: 2 (`gsd-parser/`, `create-gsd-extension/`).
- Content-file sweeps: 14 files.

## Phase 10 — Source residue sweep (tagged: phase-10-source-residue-sweep)

Closes out the GSD source-code erasure that Phases 8 and 9 didn't reach.
Refactored mid-flight per user decision to **preserve session state on
disk** — `.gsd/` runtime directory and customType protocol strings stay
unchanged so existing user sessions keep loading.

### Scope (user-approved)

- Task 1: 103 missed identifier names (functions + locals Task 6's
  verb-prefix grep missed: `resolveGsdRoot`, `ensureGsdSymlink`,
  `syncGsdStateToWorktree`, `originalGsdHome`, `tempGsdHome`,
  `batchParseGsdFiles`, etc.). Word-boundary perl: `Gsd<UPPER>` →
  `Workflow<UPPER>` and `\bgsd<UPPER>` → `workflow<UPPER>`. 338 files
  touched. One collision fixed manually (`workflow-mcp.ts` had a
  pre-existing `workflowCliPath` parameter; renamed `gsdCliPath` to
  `agentCliPath` to disambiguate).
- Task 2: 33 additional `process.env.GSD_*` vars get the Task 8 compat
  shim treatment (`GSD_HEADLESS`, `GSD_WEB_*`, `GSD_WORKFLOW_MCP_*`,
  `GSD_CLI_PATH`, `GSD_DEV_CLI_PATH`, `GSD_PROJECT_ID`, `GSD_AGENT_DIR`,
  `GSD_CLAUDE_DEBUG`, plus 25 more). Combined with Tasks 4 + 8 + 10.2,
  the compat-shim layer now covers ~63 distinct env vars.
- Task 3: 648 files swept for brand-neutral language in comments / JSDoc
  / prose strings.

### Out of scope (preserved per user decision)

- **`.gsd/` runtime directory references (~1,664 hits)** — preserved
  so existing user sessions on disk keep working
- **customType protocol strings** (`"gsd-add-tests"` etc., ~1,386 hits)
  — persisted in session message files
- **`process.env.GSD_X` compat-shim fallback** — intentional from
  Tasks 8 + 10.2
- **`@opengsd/engine-*` native binary deps** — intentional upstream reuse
- **LICENSE / README / LOOP24-PATCHES.md** — fork attribution (MIT-required
  or by design)
- **Commit history** — destructive to rewrite

### Verification

- `npm run build` clean (exit 0) after every task
- Standing regression: 74/74 pass throughout
- Final residue grep for standalone `\bGSD\b` brand mentions (excluding
  the preserved categories above) returns **0**

### Diff summary

- Task 1: 338 files, 2,453 line changes (identifier sweep)
- Task 2: 25 files, 42/-31 lines (env var compat shim)
- Task 3: 387 files, 442/-442 lines (brand-neutral comment sweep)

Total Phase 10: ~750 files, ~3,400 lines touched.

## Phase 11 — Deferred cleanups close-out (tagged: phase-11-deferred-cleanups)

Closes 4 of 6 items from Known Deferred Cleanups (Tasks 1, 2, 5, 6
completed; Tasks 3 + 4 deferred to a follow-up since they add new
build-time infrastructure rather than just sweeping residue).

- Task 1: removed dead `registerLazyGSDCommand` function from
  `src/resources/extensions/workflow/commands-bootstrap.ts:272`.
- Task 2: removed 3 orphan Rust build scripts from root `package.json`.
- Task 5: removed legacy `GSD_FIRST_RUN_BANNER` writer from `loader.ts`;
  updated `session-start-footer.test.ts` to read `LOOP24_FIRST_RUN_BANNER`.
- Task 6: swept 45 docs/** files for `extensions/gsd/` and `@gsd/`
  path references → `extensions/workflow/` and `@loop24/`.

Build clean, 80/80 regression pass.

**Deferred to follow-up (added new "Phase 11 Residue" items below):**
- piConfig CI parity check (Task 3) — adds a new verify script
- Loop24 Signal Theme JSON→TS generator (Task 4) — adds a build-time
  generator

## Known Deferred Cleanups

### 1. Dead Code: `registerLazyGSDCommand` — RESOLVED in Phase 11 Task 1

### 2. Orphan Rust Build Scripts — RESOLVED in Phase 11 Task 2

Removed `build:native`, `build:native:dev`, and `sync-platform-versions`
from root `package.json`. Workspace-internal `packages/native/`
scripts and the `.github/workflows/npm-publish.yml` reference to
`sync-platform-versions` remain — pre-existing broken-on-invoke state,
out of Phase 11 scope.

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

### 5. GSD_FIRST_RUN_BANNER Env Var — RESOLVED in Phase 11 Task 5

Removed the dual-write in `loader.ts`; `session-start-footer.test.ts`
now reads/writes `LOOP24_FIRST_RUN_BANNER` exclusively.

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

### 7. Internal References Intentionally NOT Changed — PARTIALLY RESOLVED in Phase 8

The original deferral list:
- ~~Function names: `registerGSDCommand`, `handleGSDCommand`, etc.~~ — DONE in Phase 8 Task 6 (23 functions renamed).
- Custom type strings: `"gsd-add-tests"`, `"gsd-spike"`, etc. — STILL DEFERRED to Phase 10 (persisted session-file forward compatibility).
- ~~Error codes: `"MISSING_GSD_MARKER"`, etc.~~ — DONE in Phase 8 Task 7 (renamed to `MISSING_WORKFLOW_MARKER` + 22 other constants).
- ~~Type/interface names: `GSDState`, `GSDConfig`, etc.~~ — DONE in Phase 8 Task 7 (30 type renames).
- Internal env vars: `GSD_PKG_ROOT`, `GSD_CODING_AGENT_DIR`. — RESOLVED in Phase 8 Task 8 via `LOOP24_X` canonical + `GSD_X` fallback compat shim (30 env vars; the GSD_X writes/reads remain in code as the fallback side of the shim).
- npm workspace prefix: `@gsd/` (`@gsd/pi-coding-agent`, `@gsd/pi-tui`, `@gsd-build/*`). — STILL DEFERRED to Phase 9 (916 references; biggest by raw count).

### 8. Phase 8 Residue — Identifiers Missed by the Naming-Map Audit

The Phase 8 naming map's identifier grep used a closed verb prefix list
(`read|write|get|set|create|init|load|save|build|run|dispatch|format|parse|validate|resolve|extract|sanitize|notify|emit|with|is|has`).
Functions with verbs outside that list were missed. Discovered post-execution
during the Task 10 residue audit:

- `resolveGsdRoot` (~80 hits)
- `resolveGsdRootFile` (~73 hits)
- `resolveGsdPathContract` (~41 hits)
- `ensureGsdSymlink` (~56 hits)
- `syncGsdStateToWorktree` (~42 hits; already marked deprecated)
- `executeGsdExec` (~39 hits)
- `relGsdRootFile` (~37 hits)
- `loadEffectiveGSDPreferences` (count unknown; surfaced during Task 8 setter audit)
- Plus likely a few more

Local variable names holding GSD-home paths (`originalGsdHome`, `tempGsdHome`,
`previousGsdHome`, `savedGsdHome`, `providedGsdHome`) appear in test scaffolding
and are scope-local — not in scope for identifier erasure, but they read as
brand mentions in code reviews.

**RESOLVED in Phase 10 Task 1.** Mechanical word-boundary perl sweep
(`Gsd<UPPER>` → `Workflow<UPPER>` and `\bgsd<UPPER>` → `workflow<UPPER>`)
applied across 338 files. One collision fixed (`workflow-mcp.ts`
`gsdCliPath` parameter renamed to `agentCliPath` to disambiguate from
the pre-existing `workflowCliPath` parameter).

### 9. Phase 8 Residue — 22 Additional Production Env Vars Not in the Naming Map

The naming map's Section 5 (env vars) captured 30 vars after mid-flight
expansion. Task 8's production-grep audit discovered 22 more `process.env.GSD_*`
references not covered by the map:

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

**RESOLVED in Phase 10 Task 2.** All 33 vars (including `GSD_UOK_FORCE_LEGACY`
and `GSD_UOK_LEGACY_FALLBACK` discovered during Task 9) now have `LOOP24_X`
canonical + `GSD_X` fallback compat shim. Combined coverage across
Tasks 4 + 8 + 10.2: ~63 distinct env vars.

### 10. Workflow Prompt Files — Broader GSD Brand Sweep
**Scope:** `src/resources/extensions/workflow/prompts/*.md` (~25 files)

**RESOLVED in Phase 10 Task 3.** Brand-neutral sweep across 648 files
(prompts/, skills/, source comments, JSDoc). Multi-word substitutions from
Phase 8 Task 9 applied broadly. `.gsd/` literal paths, customType strings,
and fork-attribution references intentionally preserved.

### 11. Documentation Files Still Reference Old `extensions/gsd/` Path — RESOLVED in Phase 11 Task 6

45 docs/** files swept for `extensions/gsd/` → `extensions/workflow/`
and `@gsd/` → `@loop24/`. `docs/branding/`, `docs/superpowers/plans/`,
`LICENSE`, `LOOP24-PATCHES.md` intentionally preserved.

### 12. Phase 11 Residue — piConfig CI parity check (Task 3 deferred)

`piConfig` block remains triplicated in root + `packages/pi-coding-agent` +
`pkg/package.json`. Phase 11 plan recommended adding a
`scripts/verify-piconfig-parity.cjs` script wired into `prebuild`.
Deferred since it adds new infrastructure rather than just removing
residue. **Workaround:** any piConfig edit must update all three files
in lockstep — drift currently goes undetected until runtime.

### 13. Phase 11 Residue — Loop24 Signal Theme JSON→TS generator (Task 4 deferred)

`loop24.json` (canonical brand palette) and `themes.ts` (runtime const)
remain manually synced. Phase 11 plan recommended a `prebuild`
generator that emits `loop24-theme.generated.ts` from the JSON.
Deferred since it adds new build-time infrastructure. **Workaround:**
edit JSON and TS in lockstep.

## Summary of Changes by File Type

- **Configuration:** Root and workspace `package.json` updated with new piConfig keys, name, and configDir.
- **TypeScript source:** ~85 files with absolute-path updates; ~21 files with relative-path imports; 5 test files updated.
- **Non-code config:** 4 CI/scan/deploy configuration files updated (`.github/workflows/ci.yml`, `.github/CODEOWNERS`, shell scripts, ignore files).
- **New files:** `src/resources/extensions/workflow/strings.ts`, `src/resources/extensions/loop24/branding/banner.txt`, `src/resources/extensions/loop24/theme/loop24.json`.
- **Removed files/dirs:** `web/`, `vscode-extension/`, `studio/`, `native/` (Rust source), `gitbook/`, `mintlify-docs/`, gsd-pi's `.plans/`, and all compiled Rust binaries.

## Timeline

- **2026-05-23:** Phase 0 fork and rebrand complete. All 8 core implementation tasks finished; 2 deferred cleanups documented.
- All commits passing tests; build produces version `1.0.1`; `/loop24` command functional; banner renders; theme active.
