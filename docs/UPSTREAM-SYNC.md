# Upstream Sync Ledger

> Living document. Update whenever you patch a vendored `packages/pi-*`
> file or change anything that would conflict with an upstream pull.

OTTO is a **permanent hard fork** of gsd-pi (which is itself based on pi-dev).
All `packages/pi-*` directories are vendored source copies — not npm
dependencies — so upstream changes only land here via deliberate cherry-pick.

This document captures:

1. **The fork baseline** so a future diff has a known reference point.
2. **Which packages are diverged** so you know what's safe vs. risky to sync.
3. **The patch log** of every fork-specific edit to a vendored package.
4. **The sync workflow** for evaluating new upstream commits.

For historical phase-by-phase rebranding work (commits `bb6da93` through the
`phase-12-runtime-fixes` tag), see [`../LOOP24-PATCHES.md`](../LOOP24-PATCHES.md).
This file picks up where that one ended.

---

## Fork baseline

| Field | Value |
| --- | --- |
| Upstream project | gsd-pi (`@opengsd/gsd-pi`) |
| Upstream version at import | `1.0.1` |
| Import commit (this repo) | `bb6da93b2893424c59aecf3c4e90f5296133321b` ("fork: import gsd-pi source") |
| Import date | 2026-05-23 |
| Imported via | selective rsync — see LOOP24-PATCHES.md "Initial Source Import" |
| Upstream remote (suggested) | `git remote add upstream https://github.com/open-gsd/gsd-pi.git` |

**We do NOT subscribe to upstream releases.** When a meaningful upstream
improvement appears (security fix, bug fix on a file we've touched, useful
feature), evaluate it manually using the workflow below.

---

## Vendored package divergence status

| Package | Diverged? | Risk to sync | Notes |
| --- | --- | --- | --- |
| `packages/pi-coding-agent` | **Heavy** | High — many files | Core runtime: settings, extension runner, package manager, skill loader, config resolution |
| `packages/pi-tui` | **Moderate** | Medium | Autocomplete tag field for colored chips (this work); minor brand-color touches from LOOP24 phases |
| `packages/pi-ai` | Minimal | Low | Branding/rename only (verify before sync) |
| `packages/pi-agent-core` | Minimal | Low | Branding/rename only (verify before sync) |
| `packages/native` | Wrapper-only | Low | JS wrappers around native engine; engine code lives in `native/` (Rust) |
| `packages/contracts` | Minimal | Low | Type contracts; rebuild required on any change |
| `packages/rpc-client` | Minimal | Low | Generated client; rebuild required |
| `packages/mcp-server` | Minimal | Low | MCP server impl |
| `packages/daemon` | Minimal | Low | Daemon process |

"Diverged" means we have fork-specific edits in the file beyond the LOOP24
rebrand. Anything marked **Heavy** or **Moderate** should be diffed against
upstream before applying any external patch.

---

## File-level patch log (post-LOOP24, ongoing)

Append new entries at the top. Reference the commit SHA that introduced the
change so a future maintainer can find the rationale.

### `packages/pi-coding-agent/src/index.ts`

- **Theme switching re-exports** (commit: TBD, v1.1.0) — added `setTheme`, `getAvailableThemes`, `getAvailableThemesWithPaths`, and `type ThemeInfo` to the public re-export block. Required by OTTO's `/theme` slash command (`src/resources/extensions/otto/commands/theme/command.ts`) so it can list and switch themes without deep-importing from the package internals.

### `packages/pi-coding-agent/src/core/skills.ts`

- **Harness source labeling** (commit: TBD, this PR) — `getSource` returns `"harness:<id>"` when the resolved skill path is under `~/.claude/skills`, `~/.codex/skills`, or `~/.kiro/skills`. Constants exported as `HARNESS_SOURCE_PATHS` for downstream consumers.

### `packages/pi-coding-agent/src/core/settings-manager.ts`

- **`quietExtensions: string[]`** (commit: 52ac5eb, v1.0.9) — substring patterns; runner filters matching extensions' `ui.notify` + `console.log/warn/error/info`.
- **`seedDefaultsOnLaunch: boolean`** (commit: 52ac5eb) — toggles auto-seeding of recommended packages.
- **`seededDefaults: string[]`** (commit: 52ac5eb) — zombie-resurrection guard for recommended packages.
- **`seededQuietPatterns: string[]`** (commit: 52ac5eb) — zombie guard for auto-seeded quietExtensions patterns.
- **`enabledDefaultPackages: string[] \| undefined`** (commit: 52ac5eb) — explicit subset filter from onboarding's persona picker.
- **`seededSkillPaths: string[]`** (commit: TBD) — zombie guard for auto-seeded harness skill paths.

### `packages/pi-coding-agent/src/core/extensions/runner.ts`

- **`AsyncLocalStorage` console patch** (commit: 52ac5eb, v1.0.9) — lazy-installed on first `setQuietExtensions(non-empty)`. Wraps `console.log/warn/error/info` to no-op when handler runs inside `quietExtensionContext.run(true, …)`. Concurrent non-quiet extensions unaffected.
- **`setQuietExtensions(patterns)` + `isQuietExtension(ext)` + `withSilencedNotify(ctx)`** — per-extension ctx scoping.

### `packages/pi-coding-agent/src/core/package-manager.ts`

- **Per-source `try/catch` in `resolvePackageSources`** (commit: 52ac5eb, v1.0.9) — refactored body into `resolveOnePackageSource`, wraps each call so a broken source no longer crashes startup. Writes a warning to stderr including the underlying error.
- **Captured stdio in `runCommand` (default), opt-in `interactive: true`** (commit: 52ac5eb, v1.0.9) — auto-resolve installs no longer corrupt the TUI alt-screen. Explicit `install` / `remove` / `update` pass `interactive: true` to preserve live npm/git progress.
- **`installNpm` / `uninstallNpm` / `installGit` / `updateGit` accept `interactive` parameter** propagated through to `runCommand`.

### `packages/pi-coding-agent/src/core/resolve-config-value.ts`

- **`shouldLogBlockedCommands()` gates the "Blocked disallowed command" stderr line** (commit: 52ac5eb, v1.0.9) — opt-in via `OTTO_LOG_BLOCKED_COMMANDS=1`. Off by default to avoid noise from extensions (e.g. piolium) that register `!sh -lc …` apiKey expressions.

### `packages/pi-coding-agent/src/core/agent-session.ts`

- **`extensionRunner.setQuietExtensions(settingsManager.getQuietExtensions())`** (commit: 52ac5eb, v1.0.9) — wires the new setting into the runner right after construction.

### `packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts`

- **Skill autocomplete description decorated with harness tag** (commit: TBD, this PR) — when `skill.source` starts with `harness:`, append `(<id>)` to the description so origin is visible in the dropdown.

### `packages/pi-tui/src/autocomplete.ts`

- **`AutocompleteItem.tag?: string`** (commit: TBD, this PR) — optional colored chip rendered before the item value in the dropdown. Used by the skill autocomplete to mark harness origin.

### `packages/pi-tui/src/components/select-list.ts`

- **`SelectListTheme.tag: (text: string) => string`** (commit: TBD, this PR) — theme hook for tag colour.
- **Tag chip render** before the item value (this PR) when `item.tag` is set.

---

## Sync workflow

When you want to evaluate upstream changes (e.g. you noticed a useful pi.dev
or gsd-pi commit and want to consider porting it):

### One-time: add an upstream remote

```bash
git remote add upstream https://github.com/open-gsd/gsd-pi.git
git fetch upstream main
```

### Find candidate changes

```bash
# What's changed on a file we care about, since our import?
git log bb6da93..upstream/main -- packages/pi-coding-agent/src/core/skills.ts

# Or scan the whole pi-coding-agent for upstream activity:
git log bb6da93..upstream/main --stat -- packages/pi-coding-agent/
```

### Decide whether to cherry-pick

For each upstream commit:

1. **Read it**: `git show <sha>`.
2. **Diff against our local file**: `git diff bb6da93..HEAD -- <file>` to see what we changed, then mentally overlay the upstream patch.
3. **Check this ledger** — if the file is marked Heavy/Moderate, expect conflicts.

### Three apply strategies

| Strategy | When | How |
| --- | --- | --- |
| **Clean cherry-pick** | The upstream change touches code we haven't modified | `git cherry-pick <sha>` |
| **Manual port** | The upstream change overlaps our fork edits | Read both versions, hand-merge, write a commit message that cites the upstream SHA |
| **Skip** | The upstream change is rebrand-incompatible or conflicts with an explicit OTTO design choice | Note the skip in this ledger under the affected file's entry |

### After applying

- Add an entry to the patch log above with the new commit SHA and a short description.
- If the change introduces a new dependency or alters the public API of a vendored package, update the "Risk to sync" column in the divergence table.
- Run `npm run build` and `npm run test:packages` — both must pass before commit.

---

## Branding sync (separate concern)

Pure rebranding edits (string substitution, brand colors, config dir name)
flow through `scripts/sync-piconfig.mjs` and `scripts/sync-brand-colors.mjs`
on every prebuild. They're not "patches" in the sense of this ledger — they
auto-regenerate from `package.json`'s `piConfig` block. If you fork the brand
again, edit `piConfig` once and the rest follows.

---

## When in doubt

- **Don't sync silently.** Always commit upstream cherry-picks with a message that names the upstream SHA, e.g. `chore(sync): port upstream <sha> — <description>`.
- **Don't add to the divergence list for fixes that should go upstream.** If a change is generally useful and not OTTO-specific, contribute it back to gsd-pi / pi-dev first; only fork-patch it locally if upstream declines or doesn't respond.
- **Update this ledger in the same commit** that introduces the divergence. The patch log is the contract — if you forget to update it, the next maintainer pays the cost.
