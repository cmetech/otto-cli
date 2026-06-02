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
