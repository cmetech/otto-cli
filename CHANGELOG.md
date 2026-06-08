<!-- OTTO — Project changelog -->
<!--
  This file is the SINGLE SOURCE OF TRUTH for release notes.

  The runtime data consumed by the /release-notes slash command is generated
  from this file at prebuild time by scripts/sync-release-notes.mjs and emitted
  to src/resources/extensions/otto/commands/release-notes/_data.ts. Edit notes
  here, not in the generated file.

  Format (Keep a Changelog with an OTTO extension):
    ## [X.Y.Z] - YYYY-MM-DD

    _Optional one-line headline shown in the release-notes selector._

    ### Added | Fixed | Changed | Removed | Notes
    - bullet
-->

# Changelog

All notable changes to OTTO are documented in this file.

This changelog starts from the `open-gsd/gsd-pi` ownership baseline. Earlier project history is intentionally excluded from the active changelog and documented in [Legacy Release History](./docs/archive/legacy-release-history.md).

## [Unreleased]

## [1.3.3] - 2026-06-08

_Maintenance patch rolling up six upstream-ported fixes that landed on `main` since 1.3.2: TUI rendering on JetBrains terminals, pattern-resolution basedir, project-root artifact placement when running inside worktrees, verification-pause diagnostics, per-PID crash-log isolation, and Ollama context-window trust._

### Fixed

- **JetBrains terminal capabilities.** TUI rendering now provides the correct capability set when running under JetBrains' embedded terminal (`packages/pi-tui`), eliminating layout glitches reported on IntelliJ / WebStorm / GoLand. Closes #31 (ported via PR #77).
- **Pattern basedir resolution.** Pattern lookups now resolve against the correct base directory, restoring expected matching behavior for relative glob patterns. Closes #53 (ported via PR #74).
- **Project root artifacts in worktrees.** Workflow runs invoked from a `git worktree` now project root-level artifacts (lockfile, configs, generated files) into the worktree itself instead of leaking into the primary checkout. Closes #90 (PR #370).
- **Verification pause message shows failing check.** When a workflow pauses after an execution step, the message now surfaces *which* check failed instead of a generic pause string, dramatically shortening the debug loop. Closes #99 (PR #371).
- **Crash logs append to single per-PID file.** Crash diagnostics now append to one file per process rather than fragmenting across multiple files, making post-mortem inspection coherent. Closes #343 (PR #374).
- **Ollama `/api/show` context + `num_ctx` sync.** The Ollama integration now trusts the model's reported context window from `/api/show`, keeps `num_ctx` in lockstep, and corrects `KNOWN_MODELS` drift — preventing silent truncation when a model's real context exceeds the hard-coded table. Closes #345 (PR #375).

### Notes

- Internal: upstream-swarm orchestrator skill + autonomy hardening (PRs #75, #76, #78, #79, #80, #81, #82) landed in this window but are tooling-only and have no runtime impact for end users.

## [1.3.2] - 2026-06-04

_Windows-TUI hotfix on top of 1.3.1: launching `otto` no longer paints three stacked welcome banners on Windows. The CLI rendered correctly all along — it just looked broken because cursor-relative differential updates drifted out of alignment._

### Fixed

- **Stacked TUI frames on Windows launch.** `otto` on Windows (PowerShell inside Windows Terminal) painted the welcome banner three times in scrollback instead of updating one frame in place. Root cause traced to `packages/pi-tui/src/tui.ts`: the differential render path uses *relative* cursor movement (`\x1b[N A/B`) which depends on `hardwareCursorRow` matching the actual terminal cursor row. The welcome screen's full-width yellow rule (`'─'.repeat(termWidth)` at `src/welcome-screen.ts:192`) is the canonical auto-wrap edge case; Windows ConPTY's cursor-state after writing exactly `termWidth` chars differs from xterm's "pending wrap" semantic, so each render drifts the tracked cursor by one row. After ~3 async-driven re-renders during cold-start (workflow's `session_start` handler has 5+ `await` boundaries, each potentially scheduling a render), drift compounds and subsequent updates write to wrong rows — the previous frame stays visible. Two pi-tui changes resolve it: (1) re-enable DEC 2026 synchronized output on Windows — modern Windows Terminal supports it and the prior `platform !== "win32"` guard predated that; (2) force `fullRender(true)` (absolute-positioned clear + repaint) for all non-first renders on Windows, bypassing the cursor-relative differential path entirely. Trade-off: tiny additional write traffic per render, hidden by synchronized output. Opt-outs: `PI_DISABLE_SYNC_OUTPUT=1` and `PI_DISABLE_WIN32_FULL_REDRAW=1` for terminals that mis-handle either change.

## [1.3.1] - 2026-06-04

_Windows-install hotfix on top of 1.3.0: the vendored xlsx tarball now ships pre-extracted via `bundleDependencies`, working around an npm bug that prevented `file:` deps in published global packages from resolving on Windows._

### Fixed

- **`npm i -g @cmetech/otto@1.3.0` failed on Windows** with `npm warn tarball … seems to be corrupted` followed by `ENOENT … \vendor\xlsx-0.20.3.tgz`. Root cause: npm's `file:` protocol resolution for deps inside a globally-installed published package is broken on Windows — the inner tarball never gets read even though it ships correctly inside the outer `@cmetech/otto` tarball (byte-identical SHA-256 verified). Switched from `file:`-based vendoring to `bundleDependencies: ["xlsx"]`, which ships the pre-extracted `node_modules/xlsx/` directory (26 files) directly inside the published `@cmetech/otto` tarball. End-user installs no longer go through the `file:` resolver — npm sees `xlsx` already populated in `node_modules` and skips dep resolution entirely. The `file:vendor/xlsx-0.20.3.tgz` dep spec is preserved so local dev installs still work; the SHA-drift guard test and prepublish verifier are unchanged. SheetJS is pure JavaScript (`os: any`, `cpu: any`, no native bindings) so one bundled copy works on Windows / Linux / macOS.

## [1.3.0] - 2026-06-03

_Restores xlsx capability in scratchpad cells via SheetJS Community Edition, replacing the 1.2.6 removal of `exceljs`. Vendored install means `npm i -g @cmetech/otto` remains a single command with no outbound CDN reach._

### Added

- **SheetJS Community Edition (`XLSX`) bound in scratchpad cells.** Restores the xlsx read/write capability dropped in 1.2.6 with the removal of `exceljs`. The SheetJS CE tarball is vendored at `vendor/xlsx-0.20.3.tgz` (SHA-256 verified at prepublish by `scripts/verify-vendored-xlsx.mjs` and at unit-test time by `src/tests/vendor-xlsx.test.ts`), so there is no outbound CDN reach at install time — `npm i -g @cmetech/otto` remains the single command for compliance/air-gapped environments. Cells now write `const wb = XLSX.utils.book_new(); …` (SheetJS canonical API; ExcelJS-style `new Workbook()` calls from pre-1.2.6 cells continue to ReferenceError). CE → Pro upgrade path is documented in `vendor/README.md`: drop a Pro tarball, swap the `file:` reference, regenerate the lockfile — no code change required; the `XLSX` binding name stays.

## [1.2.6] - 2026-06-03

_Second Windows-install hotfix on top of 1.2.5: better-sqlite3 native install no longer requires Visual Studio on Node 24, and the entire exceljs transitive-dep chain (glob@7 / inflight / rimraf@2 / fstream / lodash.isequal) is removed at the source by dropping the library itself._

### Fixed

- **`better-sqlite3` install fails on Windows + Node 24** with `gyp ERR! find VS / Could not find any Visual Studio installation to use`. The pinned `^11.7.0` from 1.2.5 has no prebuilt binary for `NODE_MODULE_VERSION 137` (Node 24), so npm fell through to `node-gyp rebuild`, which requires a C++ toolchain. Bumped to `^12.10.0` in both root `dependencies` and `packages/coworker-memory/package.json`; v12.10.0 ships a `v137-win32-x64` prebuild that installs cleanly.

### Removed

- **`exceljs@4.4.0` dropped from the scratchpad data-lib bindings.** Upstream is dormant (last commit Jan 2024) and the package's transitive deps generate eight `npm warn deprecated` messages on every install — `glob@7.2.3` (CVE), `inflight@1.0.6` (memory leak), `rimraf@2.7.1`, `fstream@1.0.12`, `lodash.isequal@4.5.0`, plus old `uuid@8/9` chains. Removed from `package.json`, `packages/coworker-scratchpad/src/kernel-bindings.ts` import + spread, `kernel-entry.ts` binding-names list, and both test files; the LLM-facing tool description in `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts` no longer claims `ExcelJS` as a pre-bound lib. Cell code that depended on `new ExcelJS.Workbook()` now throws `ReferenceError`. xlsx-capability replacement (likely `xlsx-populate@1.21.0`) is tracked in `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` § Out-of-scope.

## [1.2.5] - 2026-06-03

_Windows-install hotfix: silences three startup errors that fired the first time `otto` launched after a global npm install, and stops the otto extension from racing the TUI welcome banner with raw stderr writes._

### Fixed

- **`_coworker-paths.js` "Extension does not export a valid factory function".** The shared helper module sat at the top of `src/resources/extensions/` so the pi-coding-agent extension discovery (`discoverExtensionsInDir`) walked it as an extension candidate. Moved to `src/resources/extensions/shared/coworker-paths.{ts,test.ts}` (subdir is skipped by `resolveExtensionEntries` because it has no `index.ts`/`package.json`). The three coworker-{memory,scratchpad,vault}/index.ts importers were updated in lockstep.
- **`Cannot find module 'better-sqlite3'` on global install.** `better-sqlite3` was declared only in `packages/coworker-memory/package.json`. Because npm only resolves the root manifest for end users of a published tarball, the native module was never installed and `@otto/coworker-memory`'s eager re-export of `local-sqlite-backend.js` blew up at first import. Hoisted `better-sqlite3@^11.7.0` into root `dependencies`.
- **`/audit` slash-command conflict between coworker-vault and slash-commands.** Both extensions registered the same id; the vault command (the real Phase 2 reader) supersedes, but the conflict warning fired every launch. Renamed the slash-commands command to `/audit-codebase` (file + manifest + dispatch updated).
- **Otto session_start bled raw stderr into the TUI welcome banner.** The gateway + langflow probes wrote ANSI-colored status lines directly to `process.stderr` while the pi TUI was still painting; on Windows the rendered output collided with the yellow `─` rule and overwrote the prompt area. Now routes status through `ctx.ui.setStatus("otto-gateway"|"otto-langflow", ...)` when `ctx.hasUI` is true; falls back to stderr only in headless/RPC modes.
- **Duplicate "OTTO" brand on the no-project landing.** The `gsd-health` widget's no-project line began with `"  OTTO  No project loaded — …"`, which appeared alongside the ASCII OTTO logo in the welcome header — looking like the brand was loading twice. Dropped the `OTTO ` prefix; the header already brands the session.

## [1.2.4] - 2026-06-02

_Co-worker pillars go live: persistent memory (Layer A rules/lessons + Layer B verbatim drawers with FTS5 recall), workspace-scoped artifact store with `artifact://` URIs and two-turn provenance, vault's `/connect` `/datasource` `/audit` slash surface, and per-subagent dedicated scratchpads. Day-2 milestone — paste an incident note Monday → recall the exact words Tuesday — works end-to-end._

### Added

- **`@otto/coworker-memory` Layer A + Layer B (Phase 3).** Workspace-scoped SQLite store at `<workspace>/.otto/memory/layer-b.db` with FTS5 BM25 ranking + WAL journaling; markdown Layer A files at `<workspace>/.otto/memory/{profile,rules,lessons}.md` with YAML frontmatter and atomic writes. Three scoping modes (global, per-project, per-project-tagged). SecretScanner split policy: Layer A blocks writes containing secrets (`LayerAWriteBlocked`); Layer B redacts (`[REDACTED:<kind>]`) and sets `redacted:true`. Persona-seed helper for one-shot bootstrap from `<persona>/memory-seed/`.
- **Production activators wire memory + vault + scratchpad to Otto's `ExtensionAPI` (Phase 3.1).** Vault's `/connect <engine> <name>` interactive wizard, `/datasource list|remove|test`, and `/audit [--producer|--action|--limit|--since|--engine|--severity]` now register at extension activation — first time these are reachable in a live chat. Memory activator captures `event.prompt` in `before_agent_start`, calls `recorder.recordTurn(...)` in `agent_start` (one-time warning on failure, then silent). `/memory note <text>` appends a workspace lesson; `/memory status` reports `workspace_wing`, `drawer_count`, db path; `/memory clear --wing <w> --confirm` deletes drawers. `memorize` and `recall` LLM tools are model-callable. Layer A injects into the system prompt on `session_start` (3000-token cap; sections sorted profile → rules → lessons → truncate lowest-priority on overflow).
- **`/memory show` + `/memory recall` slash surface (closes #73).** `/memory show [profile|rules|lessons] [--scope workspace|global]` dumps Layer A markdown inline; defaults to all three for per-project-tagged scope (workspace first, then global). `/memory recall <query> [--kind|--room|--wing|--limit|--days_back]` searches Layer B drawers directly from chat without going through the model's tool call. Memory command tab-completion lists all 8 subcommands.
- **`@otto/coworker-artifacts` workspace-scoped store (Phase 4).** `report` artifact kind (markdown v1; workbook + dataset deferred). `ArtifactStore` with slug derivation (`deriveSlug` lowercase ASCII kebab, max 64 chars) + collision suffixing (`-2`, `-3`, … up to 100). Atomic writes (tmp → chmod → rename), mode 0o700 dir / 0o600 files. `DirSnapshot` (nanosecond mtime + size_bytes) drives per-turn `files_touched` via before/after diff. Append-only `provenance.json` records `{ts, action: create|update, turn_id, agent_turn_id?, user_prompt, scratchpad_name?, files_touched}` per turn. Deterministic `README.md` re-renders on every save. `resolveArtifactUri(uri, workspaceDir)` validates `^artifact://[a-z0-9][a-z0-9-]*[a-z0-9]$|^artifact://[a-z0-9]$`, rejects `..` traversal + length > 64 + non-ASCII. Production activator registers `/artifacts list|show|remove --confirm` (flag-order-agnostic) + `list_artifacts` + `open_artifact` LLM tools. Kernel-side `otto.artifact.create(kind, name)` + `otto.artifact.spillIfLarge(value, opts?)` (10 KB default threshold) via bidirectional NDJSON RPC over stdio. `kind:'artifact'` drawer in memory (migration 002 rebuilds the `drawers.kind` CHECK constraint) tagged with the scratchpad name as `room`, so `/memory recall <q> --kind artifact` finds them.
- **Subagent-scratchpad scoping (Phase 4.5).** Subagent dispatcher mints `subagent-<sanitized-agent>-<6-hex>` per child process; the spawned `pi` reads `OTTO_SUBAGENT_SCRATCHPAD` env var at `session_start` and force-attaches before sidecar/pointer restore (validated against `^subagent-[a-z0-9-]+$`, max 80 chars). Scratchpads persist after subagent exit — parent can `/sp attach subagent-<id>` post-hoc to inspect kernel state, cells, namespace globals. Failure (invalid name, disk error) emits a warning and falls through to normal restore; never crashes `session_start`.

### Changed

- **Memory backend `local-sqlite-backend` runs migrations conditionally.** `open()` checks `PRAGMA user_version` and applies `001-init.sql` (if version < 1) then `002-artifact-kind.sql` (if version < 2). Migration 002 rebuilds the `drawers` table with `'artifact'` added to the kind CHECK and re-runs FTS5 contentless-rowid alignment.
- **Memory drawer kinds vocabulary** now includes `'artifact'`. Existing kinds (`turn`, `paste`, `file_load`, `ticket`, `email`, `rca`, `note`) unchanged.
- **`/memory` command** description is a sentence; `getArgumentCompletions` lists all 8 subcommands with one-line descriptions of each.
- **Audit log gains three new producers**: `memory` (write-layer-a, write-drawer, redact, block, recall, seed-applied), `vault` (set, remove, test, inject, inject-skipped — Phase 2 already had these but now reachable via slash), and `artifacts` (write, remove). All land in the shared `~/.otto/audit.jsonl`.

### Fixed

- **Strict-tsc compatibility for activator tool registrations.** `api.registerTool<TParams, TDetails>(...)` generics are explicit union types so success-vs-error result shapes both satisfy `AgentToolResult<TDetails>`. Caught at Phase 3.1 build-gate; not at test-compile (which uses esbuild). All Phase 3.1 + Phase 4 + Phase 4.5 activators carry the pattern.
- **Strict `pi` kernel-entry main loop no longer deadlocks on artifact RPC.** `await runCell(req.code)` inside the `for await (const raw of readNdjson(stdin))` loop blocked the iterator from receiving its own RPC responses. Now fire-and-forget; manager already serializes cell submissions.
- **Memory migration 002 rebuilds FTS5 triggers + virtual-table rowids** after the `drawers` table rename. Without this, `recall()` on existing v1 databases would return zero results post-upgrade.
- **Memory recorder `byte_count` audit field** now uses `Buffer.byteLength(content, 'utf8')` instead of character count.
- **`LayerAStore` write-then-read round-trip preserves the section heading** on subsequent appends. Title-dedup regex tolerates leading newline left by frontmatter split.
- **`optionalDependencies.@cmetech/otto-engine-*` pins synced to root version.** `version-sync.test.ts` asserts equality on every build; root publish would fail npm resolution otherwise.

### Notes

- Phase 5 (Layer C entity graph + ACC + Cerebellum + Consolidator + daily digest + `memory://` URI resolver) is the next phase — depends on Phase 3 + Phase 4 (both shipped here). Phase 6 (NOC persona bundle, integration testing, time-to-first-artifact < 5 min) follows.
- Smoke checklists for the four shipped phases live at `docs/superpowers/notes/2026-06-02-{phase-2-vault,phase-3-memory,phase-4-artifacts,phase-4.5-subagent-scratchpad}-smoke.md`. Each carries a PENDING verified-live placeholder — fill in after end-to-end TUI walkthrough.
- Spec + plan artifacts at `docs/superpowers/specs/2026-06-02-*` and `docs/superpowers/plans/2026-06-02-*` for every phase shipped here.

## [1.2.0] - 2026-06-01

_Co-worker scratchpad Phase 1.5 polish wave: typing `otto` in a workspace where you previously attached a scratchpad now auto-restores it without `--resume`; `/sp evict` and idle-age display land; `otto.duckdb.registerDf` drops polars→DuckDB from ~8 LLM cells to 2._

### Added

- **Workspace-pointer auto-restore (Issue #6).** New `~/.otto/scratchpads/_workspaces/<sha256-16>.json` keyed on git toplevel (else cwd). On `session_start`, when no per-session sidecar matches, falls back to the workspace pointer. The spec's canonical day-2 RCA scenario now works without `--resume` — typing `otto` in the same workspace surfaces `attached to <name> (from workspace, last used <relative>)`. 7-day staleness threshold; cross-workspace isolation; restored scratchpads cold-restart from disk via Phase 1's existing snapshot path.
- **`/sp list` idle-age column (Issue #4).** Warm entries now show `active` (cell running) or `idle Xm` / `idle Xh` / `idle Xd` (floored minutes/hours/days since last use). Cold entries unchanged.
- **`/sp evict <name> [--force]` slash command (Issue #4).** Releases a warm kernel without deleting the scratchpad — on-disk state (kernel.db, namespace.json, cells.jsonl) remains for cold-restart on next attach. Refuses on active cell unless `--force`. `--force` reuses the existing `runtime.cancel()` SIGINT→SIGTERM→SIGKILL escalation; skips snapshot since the kernel is dead post-cancel.
- **`otto.duckdb.registerDf(name, input, opts?)` (Issue #1).** Duck-typed input detection for polars DataFrames, Arrow Tables, and arrays of records. First-10-rows null-walk schema inference covers sparse leading rows. Optional `opts.schema` override (accepts `Record<string, type>` or `Array<[col, type]>`). All-or-nothing semantics: partial-row failure drops the partial table so retries don't hit "Table already exists." Per-column failure attribution in error messages. `cw_scratchpad` `promptGuidelines` updated so the LLM reaches for the helper instead of API discovery — polars→DuckDB drops from ~8 cells to 2.
- **Stale sidecar GC on init (Issue #67).** `sweepStaleSidecars` runs once at `session_start`. Deletes foreign-session sidecars where the referenced scratchpad is gone OR sidecar mtime is > 7 days old. Per-file try/catch isolation; current session's sidecar always protected.

### Changed

- **`/sp attach <name>` errors on typo (Issue #5).** Previously, `/sp attach <typo>` silently spawned a phantom scratchpad. Now errors with `scratchpad not found: <name>. Use /sp new <name> to create it.` Library `manager.getOrAttach` and the LLM tool path (`cw_scratchpad` action=exec) remain permissive — the asymmetry is intentional (LLM-passed names should auto-create; user-typed names should fail loud).
- **Session sidecar filename format (Issue #66).** Renamed from `<sessionId>.json` to `sidecar_<sessionId>.json` for visual scan and `sidecar_*` glob. Old-format files become inert orphans (the sweep ignores anything without the `sidecar_` prefix). Users upgrading can manually `rm ~/.otto/scratchpads/_sessions/*.json` once if they want a clean slate; otherwise old files are harmless and persistent.
- **`ScratchpadInfo` interface gains `hasActiveCell: boolean`.** Workspace-private package change with two internal consumers; no out-of-tree breakage.

### Fixed

- **`meta.json` on fresh `/sp new` reflects post-spawn disk state (Issue #2).** Previously showed `kernel_db.present: false` and `size_bytes: 0` because the initial `writeMeta` fired before `kernel.db` existed on disk. Added a second `writeMeta` call after `spawnRuntime` succeeds; the first call still preserves the lock-acquire side-effect.

### Notes

- Phase 1.5 closes the open known-issues backlog from `docs/superpowers/notes/2026-06-01-coworker-phase-1-known-issues.md` (Issues #1, #2, #4, #5, #6) and GH #66, #67.
- Five follow-up items filed as #68–#72 for post-merge polish (workspace-pointer GC, `/sp evict <current>` sidecar question, `formatRelativeAge`/`hasActiveCell` overlap, `detectWorkspaceRoot` memoization, and dual-`writeMeta` doc comment).
- Issue #3 (LLM "ask if unsure" reliability) remains accepted as inherent LLM behavior; revisited in Phase 6 (NOC persona polish).
- See the Phase 1.5 re-verify section in `docs/superpowers/notes/2026-06-01-coworker-phase-1-human-tests.md` for the 11-scenario sign-off checklist.

## [1.1.1] - 2026-05-29

_Windows `otto update` no longer emits EPERM cleanup warnings or leaves orphan `.otto-*` staging dirs._

### Fixed

- `otto update` on Windows would log `EPERM: operation not permitted, unlink` warnings against `duckdb.dll`, `sharp.dll`, and `otto_engine.win32-x64.node` because the running otto.exe still held DLL handles. The install still succeeded but left orphan `.otto-RouGtD54`-style staging directories under `%APPDATA%\npm\node_modules\@cmetech\`. `otto update` now spawns a detached PowerShell bootstrap in a visible "OTTO Updater" console window that waits for the parent otto.exe to exit (max 30s), runs the install with locks released, sweeps the orphan staging dirs, and writes a completion status to `~/.otto/agent/update-status.json` that the next `otto update` surfaces. macOS / Linux behavior unchanged — POSIX inode semantics handle live-process replacement without the lock issue.

### Added

- `update-status.json` written to `~/.otto/agent/` on every `otto update` — tracks `startedAt`, `completedAt`, `fromVersion`, `toVersion`, and `exitCode`. The next `otto update` prints "Last update: vX.Y.Z → vA.B.C at … (✓ success / ✗ exit N)" before checking the registry, so you can see whether a previous background update finished.

### Changed

- `/release-notes` data is now capped at the last 20 releases per npm tarball (override at build time via `OTTO_RELEASE_NOTES_CAP=<n>`; set `0` for unlimited). `CHANGELOG.md` stays the canonical full history; the runtime command shows a footer like "Bundled here: v1.0.5 → v1.2.0 (20 of 35 total). Older releases: github.com/cmetech/otto-cli/blob/main/CHANGELOG.md" when truncation is active. Keeps the shipped data file from growing unbounded as the project ages.

## [1.1.0] - 2026-05-29

_Harness compatibility (Claude / Codex / Kiro skills + agents), [claude] origin chips, and a `/theme` slash command._

### Added

- Harness skill paths (`~/.claude/skills`, `~/.codex/skills`, `~/.kiro/skills`) are now auto-seeded into `settings.skills` on launch — but only if the directory actually exists on disk. Skills loaded from those paths follow pi.dev's documented convention. A new `settings.seededSkillPaths` zombie-guard records every path attempted, so removing an entry from `settings.skills` keeps it removed across launches.
- Skill origin is now visible in the slash-command autocomplete. Skills loaded from a known harness folder (`~/.claude/skills`, `~/.codex/skills`, `~/.kiro/skills`) carry `source: "harness:<id>"`. The dropdown shows a colored chip — e.g. `[claude] skill:review-pr  Review a pull request (claude)` — so the origin is glanceable. Implementation: new `HARNESS_SOURCE_PATHS` in `skills.ts`, new optional `tag` field on `AutocompleteItem` + `SelectItem`, new `SelectListTheme.tag` color hook.
- Harness agent discovery. OTTO's `subagent` tool now also resolves agent names against `~/.claude/agents/`, `~/.codex/agents/`, `~/.kiro/agents/` (user scope) and the nearest `.claude/agents/`, `.codex/agents/`, `.kiro/agents/` (project scope). A Claude skill that delegates to a companion agent now finds it without manual setup. Collision rule: OTTO's own agents win at each scope; project always wins over user.
- Tool-name normalization for harness-imported agents. Capitalized Claude/Codex/Kiro tool names in an agent's `tools:` frontmatter are rewritten to OTTO's lowercase registry names at load time — `Bash` → `bash`, `Read` → `read`, `AskUserQuestion` → `ask_user_questions`, `Task`/`Agent` → `subagent`, `WebSearch` → `web_search`, `WebFetch` → `fetch_page`, `Skill` → the stub below. Unknown names flow through as lowercase and the runtime allowlist silently drops them, so a single unknown entry no longer blocks the rest of the agent's toolset. MCP names (`mcp__server__*`) are preserved verbatim.
- Stub `skill` tool for imported Claude skills that call `Skill(name=...)`. OTTO doesn't support model-invoked skill execution; the stub returns a friendly message redirecting the model to either ask the user to run `/skill:<name>` from chat input or to act on the skill content inline.
- `/subagent` listing now renders each row with embedded ANSI styling: white agent name, dim source/model metadata, dim description, and an accent `[claude]/[codex]/[kiro]` chip when the agent was discovered under a harness path. Matches the `/skills` autocomplete chip style. `AgentConfig` gains an optional `harnessSource` field.
- New `/theme` slash command — `/theme` opens an interactive picker over built-in themes (`otto`, `dark`, `light`, `tui-classic`, `vivid`) plus any `*.json` you drop in `~/.otto/agent/themes/`. `/theme <name>` switches directly. `/theme list` prints a non-interactive index. Switch is session-only; set `"theme": "<name>"` in `~/.otto/agent/settings.json` to persist.
- New `docs/HARNESS-COMPAT.md` — user-facing matrix of what's automatically translated when importing skills/agents from Claude/Codex/Kiro, what doesn't translate, and how to test.
- New `docs/UPSTREAM-SYNC.md` living ledger — fork baseline (gsd-pi @ 1.0.1, import commit `bb6da93`), per-package divergence status, file-level patch log, and the cherry-pick workflow for evaluating future upstream changes. Update this file in the same commit as any new vendored-package edit.

## [1.0.9] - 2026-05-29

_Recommended packages, /release-notes, and quieter startup._

### Added

- New `otto onboarding` subcommand — re-run the first-run wizard at any time to revisit LLM provider, web search, remote questions, tool keys, or recommended packages.
- New `/release-notes` slash command — browse what's new across releases. Type `/release-notes` for the interactive selector, `/release-notes <version>` for a specific release, `/release-notes list` for the index, or `/release-notes latest`.
- Onboarding now offers a categorical "Recommended packages" step (Developer + Productivity personas) — see what each package does, untick anything you don't want, and OTTO installs them on launch.
- Opt-in flags for recommended packages without re-running onboarding: `otto --with-defaults` (one launch), `OTTO_SEED_DEFAULTS=1` (env), or `seedDefaultsOnLaunch: true` in settings.json.
- Opt-out controls with matching precedence: `otto --no-seed-defaults`, `OTTO_NO_SEED_DEFAULTS=1`, or `seedDefaultsOnLaunch: false`.
- New `quietExtensions: string[]` setting — case-insensitive substring patterns matched against extension paths. Matching extensions have their `ui.notify` AND `console.log/warn/error/info` calls suppressed while their handlers are on the stack. Use to mute noisy session_start banners from extensions like piolium (`ui.notify`) or pi-notion (`console.log`). Concurrent non-quiet extensions are unaffected — suppression is scoped via AsyncLocalStorage to the quiet handler's own async context.
- Known-noisy default packages are now silenced automatically: when onboarding seeds pi-notion (and any future curated package with a `quietPattern`), the pattern is added to `quietExtensions` on the same launch. Tracked via a new `seededQuietPatterns` settings key — if you remove a pattern from `quietExtensions`, OTTO will not re-add it.
- New `OTTO_LOG_BLOCKED_COMMANDS=1` env to opt back into the `[resolve-config-value]` warning when actively debugging credential resolution.

### Fixed

- Doubled OTTO header on first launch is gone: auto-resolve npm install no longer corrupts the TUI's alt-screen because install stdio is now captured instead of inherited. Explicit `otto install <pkg>` still streams live progress.
- A bad source in `settings.packages` (typo, 404, dead git host) no longer crashes startup — the resolver now warns-and-continues per source with the underlying npm/git error attached to the message.
- `/release-notes` content renders inside a chat response card via the session's custom-message stream instead of being interleaved with live TUI redraws.
- `[resolve-config-value] Blocked disallowed command: "sh"` warning is suppressed by default; it was unactionable noise from extensions that intentionally register `!sh -lc ...` apiKey expressions.

### Changed

- `CHANGELOG.md` is now the single source of truth for `/release-notes` data. `src/resources/extensions/otto/commands/release-notes/_data.ts` is regenerated by `scripts/sync-release-notes.mjs` on every prebuild.
- Piolium dropped from the default Recommended Packages list. Existing installs are left alone; the zombie-resurrection guard prevents reseeding. `otto remove npm:@vigolium/piolium` to drop it.

### Notes

- New `~/.otto/agent/settings.json` keys this release: `seedDefaultsOnLaunch`, `seededDefaults`, `enabledDefaultPackages`, `quietExtensions`. All optional; omit to inherit the defaults documented in `/release-notes`.

## [1.0.8] - 2026-05-28

_Bundled-tools path fix._

### Fixed

- Bundled ripgrep/fd now land in the correct destination so OTTO's managed tools resolve on fresh installs.

## [1.0.7] - 2026-05-28

_OTTO brand cutover + bundled ripgrep & fd._

### Added

- Ship ripgrep and fd with the OTTO binary — no separate install required for fast search and file discovery.

### Changed

- README rebrand from prior identity to OTTO — clearer messaging for the v1.x line.

## [1.0.6] - 2026-05-27

_uuid deprecation warning silenced._

### Fixed

- Pin the uuid package override so Node no longer prints deprecation warnings during startup.
- Native package repository.url corrected to cmetech/otto-cli for provenance verification.

### Changed

- INSTALL.md expanded with macOS and Linux instructions.

## [1.0.5] - 2026-05-26

_npm provenance enabled._

### Added

- Publish with npm provenance — installs can now verify OTTO and engine packages came from this repo's CI.

### Changed

- Native and main publish workflows split for trusted-publishing compatibility.

## [1.0.4] - 2026-05-24

_Trusted publishing + gateway model discovery._

### Added

- Gateway: discover available models exposed through `OTTO_GATEWAY_URL` so `/model` lists them out of the box.
- Footer: GW status color decoupled from the routing label so health is glanceable.

### Fixed

- LangFlow: surface timeouts on id lookups instead of hanging silently.
- LangFlow: fail fast on auth failures with a clear actionable message.

### Changed

- Release pipeline switched to npm trusted publishing by default.
- Bumped CI npm-registry propagation retry budgets to reduce flaky publishes.

## [1.0.3] - 2026-05-23

_TUI hardening + workflow command cleanup._

### Fixed

- Hardened interactive TUI behavior across edge cases (resize, focus, paste).
- Streamlined workflow command handling so dispatching is more predictable.
- OTTO startup no longer requires you to be inside a project directory.
- Workflow context no longer attempts to load from the home directory.

### Changed

- Tightened gateway remote-tool handling.
- Hardened npm publish and install tooling.

## [1.0.2] - 2026-05-23

_Hard-fork runtime complete + LangFlow control plane._

### Added

- LangFlow control plane: register, validate, smoke-test, and import flows from inside OTTO.
- Codebase excavation workflows for spelunking unfamiliar repos.
- Improved OTTO package management — install, remove, list, and update with provenance-aware paths.
- Lazy `/gsd init` — OTTO is now bootable from any directory, no preflight required.
- `requireProject` guard so gsd commands fail with a clear message when run outside a project.

### Fixed

- RTK opt-in is now read from user settings before project preferences (correct precedence).
- `loadProjectGSDPreferences` returns null outside projects instead of throwing.

### Notes

- This release completes the hard-fork rebrand to OTTO: workspace scope, config dirs, brand colors, and patches now flow from `piConfig` as the single source of truth.

## [1.0.0] - 2026-05-22

_Project baseline._

### Changed

- Started the `open-gsd/gsd-pi` development baseline.
- Reset first-party package versions to `1.0.0`.
- Cleaned public README and changelog history for the new project ownership.

### Notes

- Historical release notes are archived outside the active changelog.
- New release notes should be added above this entry under `Unreleased`.
