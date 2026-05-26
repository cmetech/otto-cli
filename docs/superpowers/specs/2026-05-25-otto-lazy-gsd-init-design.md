# Otto — Lazy `.gsd` Initialization Design

**Status:** Design (pre-implementation)
**Date:** 2026-05-25
**Author:** Brainstormed with Claude (superpowers:brainstorming)

---

## 1. Purpose

Make `otto` start successfully from any directory — including `$HOME` — without
requiring a `.gsd/` project directory anywhere on the ancestor walk. The GSD
workflow becomes an opt-in capability invoked via `/gsd init`, not an implicit
boot-time dependency.

This unblocks otto from being used purely for its non-workflow capabilities
(analyst, voice, browser-tools, mac-tools, claude-code-cli, langflow triggers,
etc.) without forcing users into a coding-project workflow they don't need.

## 2. Context

Otto inherits `gsd-pi`'s assumption that every session is a coding workflow.
The workflow extension's planning artifacts (`milestones`, `slices`, `tasks`,
`preferences`, `graph`) live in `<project>/.gsd/`. The boot path reads
project preferences to decide whether to enable RTK (the shell-command
compression subsystem). This single read drags `.gsd/` resolution into every
startup.

Running `otto` from `$HOME` triggers:

```
Error: Refusing to use /Users/coreyellis/.gsd as a project .gsd directory —
that is the global GSD home. Run GSD from inside a project directory.
```

Trace: `cli.ts:doRtkBootstrap` →
`workflow/preferences.ts:loadEffectiveGSDPreferences` →
`workflow/preferences.ts:loadProjectGSDPreferences` →
`workflow/paths.ts:projectPreferencesPath` →
`workflow/paths.ts:workflowRoot` →
`workflow/paths.ts:assertNotGlobalWorkflowHome` → throw.

Otto today has ~25 extensions (analyst, voice, browser-tools, mac-tools,
claude-code-cli, ollama, langflow, etc.). Workflow is one of them. The boot
crash blocks all of them on the absence of one.

## 3. Goals & Non-goals

**Goals**
- Otto boots cleanly from any directory.
- Workflow features remain unchanged for users in existing `.gsd/` projects
  (auto-detect on ancestor walk, silent bind).
- `/gsd init` is the single, explicit user gesture to create a new project.
- RTK opt-in moves to a user-scoped setting; project-scoped override remains
  honored for backwards compatibility.
- Single PR, narrow blast radius (~5 files changed + 1 new file).

**Non-goals**
- Workflow extension internals refactor (Approach B/C in brainstorm). Deferred.
- Migration of existing `~/.gsd` global directory. Out of scope; the directory
  will simply not be read by RTK anymore.
- Tier 2/3 rebrand work (`LOOP24_*` env vars, internal `@loop24/*` workspaces,
  `~/.loop24/` config dir). Separate effort.
- Reworking the broader extension registration system.

## 4. Architecture

```
┌─────────────────── BOOT (filesystem-agnostic) ───────────────────┐
│ otto starts                                                       │
│   → doRtkBootstrap reads ~/.otto/settings.json   (NOT .gsd)       │
│   → workflow extension registers ALL /gsd commands                │
│   → TUI launches                                                  │
│   → background: auto-detect existing .gsd in cwd ancestry         │
└──────────────────────────────────────────────────────────────────┘

┌─────────────── RUNTIME (workflow opt-in per command) ────────────┐
│ /gsd init        → creates .gsd/ in cwd, refuses if $HOME or dup  │
│ /gsd <other>     → uses detected .gsd; if none, prints guidance   │
│ non-gsd commands → unaffected, work anywhere                      │
└──────────────────────────────────────────────────────────────────┘
```

Core insight: only **one** boot-path call site
(`src/cli.ts` lines ~195-200, inside `doRtkBootstrap`) touches `.gsd`. The
workflow extension's `registerExtension` (`src/resources/extensions/workflow/
index.ts`) only declares commands — it does not read `.gsd/` until a `/gsd`
subcommand actually runs. Fixing the single call site and adding graceful
fallback to a few helpers is enough to deliver the goal.

## 5. Components

| File | Change |
|---|---|
| `src/cli.ts` (around line 195-200) | In `doRtkBootstrap`, replace `loadEffectiveGSDPreferences()` call with a new `loadRtkPreference()` helper. The dynamic import target moves accordingly. |
| `src/resources/extensions/workflow/preferences.ts` | Add `loadRtkPreference()`: reads `~/.otto/settings.json#experimental.rtk` → env var → optional project override (if `.gsd` detected) → default `false`. Make `loadEffectiveGSDPreferences()` return safe defaults instead of throwing when no project `.gsd` is found. |
| `src/resources/extensions/workflow/paths.ts` | Add `workflowRootOrNull(basePath)` — same logic as `workflowRoot()` but returns `null` instead of throwing on `assertNotGlobalWorkflowHome` failure. Leave `workflowRoot()` strict for callers that genuinely need a guaranteed root. |
| **NEW** `src/resources/extensions/workflow/commands/init.ts` | Implements `/gsd init`. Preflight checks: cwd ≠ `$HOME`; `cwd/.gsd` does not already exist; cwd is writable. On success: create `cwd/.gsd/`, write `manifest.json` (`{version, createdAt, otto}`) and a minimal `STATE.md` stub (single H1 + one-line placeholder; same content the existing workflow extension writes on first save). |
| `src/resources/extensions/workflow/commands/index.ts` | Wire the new `init` command into the existing `registerWorkflowCommand` registration (this is the file that contains it). |
| **NEW** `src/resources/extensions/workflow/commands/require-project.ts` | Export `requireProject()` shared helper. Walks ancestry via `workflowRootOrNull(cwd)`; if null, prints the standard `No GSD project here…` message and returns null. If a `.gsd/` is found but its `manifest.json` is missing or malformed, prints `Project at /abs/path appears damaged. Inspect .gsd/manifest.json.` and returns null. |
| All existing `src/resources/extensions/workflow/commands/<other>.ts` | Add the `requireProject()` guard at handler entry (early-return if null). One-line change per command. |

**Conceptual boundaries (unchanged from today):**
- `paths.ts` = filesystem resolution (strict + null variants)
- `preferences.ts` = config reading (user-scoped + project-scoped, safe defaults)
- `commands/init.ts` = single-purpose project bootstrap
- `commands/<other>.ts` = workflow operations, all guarded by `requireProject()`

## 6. Data flow

**Boot in any directory (incl. `$HOME` or `/tmp`):**
```
otto → cli.ts → doRtkBootstrap()
  → loadRtkPreference() reads ~/.otto/settings.json   ✓ no .gsd touched
  → returns false (default)
  → RTK env vars set to disabled
  → workflow extension registers /gsd commands (registration only, no fs reads)
  → TUI starts
  → background pass: workflowRootOrNull(cwd) → either path or null
      └─ result cached in session for /gsd command guards
```

**Boot inside a `.gsd` project (existing otto-cli, oscar_app repos):**
Same as above; the background `workflowRootOrNull(cwd)` returns the real path.
`/gsd <subcommand>` calls find it via the cache. No user-visible change.

**`/gsd init` in a fresh project dir:**
```
user types: /gsd init
  → init command resolves cwd
  → preflight checks:
      • cwd ≠ $HOME                   (refuse otherwise)
      • cwd/.gsd does not exist       (refuse otherwise)
      • cwd is writable               (refuse otherwise)
  → creates cwd/.gsd/
      • .gsd/manifest.json   { version, createdAt, otto: "x.y.z" }
      • .gsd/STATE.md        empty "Workflow State" stub
  → invalidate session cache so subsequent /gsd commands see new root
  → print: "GSD project initialized at /abs/path/.gsd"
```

**`/gsd <other>` (e.g. `/gsd plan`) in a fresh dir with no `.gsd`:**
```
user types: /gsd plan
  → command handler calls requireProject()
  → requireProject() → workflowRootOrNull(cwd) → null
  → print: "No GSD project here. Run /gsd init in a project directory."
  → command returns; TUI stays alive
```

**RTK preference resolution order (highest precedence first):**
1. Env var: `LOOP24_RTK_DISABLED` / `GSD_RTK_DISABLED` (existing escape hatch)
2. User settings: `~/.otto/settings.json#experimental.rtk`
3. Project settings: `<cwd-walk>/.gsd/preferences.json#experimental.rtk` —
   only consulted if a `.gsd/` is detected. Backwards compat for users who
   set RTK per-project today.
4. Default: `false` (disabled)

## 7. Error handling

| Scenario | Today | After |
|---|---|---|
| `otto` from `$HOME` | Throws `Error: Refusing to use ~/.gsd...` and exits with stack trace | Boots cleanly; auto-detect returns null; TUI starts |
| `otto` from `/tmp` (no `.gsd` anywhere up the tree) | Same crash | Same: boots cleanly |
| `otto` from a project with `.gsd` | Works | Works (unchanged) |
| `/gsd init` in `$HOME` | n/a | Refuses: *"Refusing to create `.gsd/` in your home directory. `cd` into a project dir first."* |
| `/gsd init` where `.gsd` already exists | n/a | Refuses: *"`.gsd/` already exists at /abs/path. Nothing to do."* |
| `/gsd init` where filesystem write fails (read-only fs, permission denied) | n/a | Refuses with specific OS error; no partial state on disk |
| `/gsd <other>` outside a project | Crashes the TUI (same .gsd walk problem) | Prints actionable message; command returns; TUI stays alive |
| Corrupt `.gsd/manifest.json` | Various downstream failures | `requireProject()` validates manifest shape; refuses with *"Project at /abs/path appears damaged. Inspect .gsd/manifest.json."* |
| `~/.otto/settings.json` malformed JSON | RTK pref read may throw | `loadRtkPreference()` catches and treats as "no setting present"; falls through to env/project/default |

**Principles:**
- **Never throw from boot.** Any path resolution at startup uses the `*OrNull`
  variants. Throws are reserved for `/gsd <command>` handlers where the user
  has explicitly invoked workflow.
- **Refuse loudly, never partially.** `/gsd init` validates all preconditions
  before any filesystem write. No half-created `.gsd/` directories.
- **Single error format.** All user-facing refusals follow the pattern:
  `<what>: <why>. <next action>.`

## 8. Testing

**Unit tests** (Node test runner, existing repo pattern):

| Test file | Coverage |
|---|---|
| `src/resources/extensions/workflow/preferences.rtk.test.ts` | `loadRtkPreference()` resolution order: env > user settings > project > default. Includes malformed-JSON handling. |
| `src/resources/extensions/workflow/preferences.safe-defaults.test.ts` | `loadEffectiveGSDPreferences()` returns safe defaults when basePath is `$HOME` or any dir without a project `.gsd` — no throw. |
| `src/resources/extensions/workflow/paths.workflowRootOrNull.test.ts` | Returns `null` when cwd is `$HOME`; returns path when cwd is inside a `.gsd` project; returns `null` for `/tmp`. |
| `src/resources/extensions/workflow/commands/init.test.ts` | `/gsd init` refuses in `$HOME`; refuses when `.gsd/` exists; succeeds in fresh dir; produces well-formed `manifest.json` + `STATE.md`; rolls back on partial write failure. |
| `src/resources/extensions/workflow/commands/require-project.test.ts` | `requireProject()` returns null cleanly outside project; returns path inside; gives same actionable error string in both no-project paths. |

**Integration tests:**

| Test file | Coverage |
|---|---|
| `src/tests/integration/boot-without-gsd.test.ts` | Spawn `otto --version` from `$TMPDIR` and from `$HOME`; assert exit 0, no stderr stack traces, no `.gsd` created anywhere. |
| `src/tests/integration/gsd-init-end-to-end.test.ts` | Spawn otto in fresh tmpdir; drive `/gsd init` via stdin; assert `.gsd/` created with expected files. |

**Regression guard:**
- `src/tests/integration/boot-inside-project.test.ts` — Spawn otto inside an
  existing `.gsd` project; assert workflow auto-detects, `/gsd <existing-cmd>`
  still works (no behavior change for existing users).

**What is NOT tested here:**
- The clack TUI behavior itself (out of scope for this fix).
- RTK's runtime behavior (separate subsystem, already covered elsewhere).
- Existing workflow command internals (untouched by this change).

**Manual smoke checklist:**
1. `cd ~ && otto` → no crash, TUI launches.
2. `cd /tmp && otto` → no crash, TUI launches.
3. `cd ~/code/github.com/cmetech/otto_app/otto-cli && otto` → no crash; `/gsd status` works (existing `.gsd` auto-detected).
4. `cd /tmp/scratch && otto` then `/gsd init` → `.gsd/` created at `/tmp/scratch/.gsd/`.
5. `cd ~ && otto` then `/gsd init` → refuses with helpful message.

## 9. Migration & backwards compatibility

- **Existing `.gsd/` projects:** No behavioral change. The ancestor-walk
  semantics that locate a project root remain identical; only the throw-on-
  global-home failure mode becomes a silent null in the new `*OrNull`
  variant. Users continue to run workflow commands from any subdir of an
  initialized project exactly as before.
- **Existing global `~/.gsd/`:** Not migrated, not removed. Will simply not be
  read by RTK after this change. If a user has nothing else there, they may
  delete it manually.
- **Per-project RTK opt-in:** Users who set `experimental.rtk: true` in
  `<project>/.gsd/preferences.json` keep that behavior. The same flag can now
  also be set globally in `~/.otto/settings.json`.
- **`LOOP24_RTK_DISABLED` / `GSD_RTK_DISABLED` env vars:** Unchanged — still
  the highest-precedence override.

## 10. Open questions (none)

All foundational decisions were resolved during brainstorming:
- End-state: otto boots anywhere without touching `.gsd` ✓
- Existing `.gsd`: auto-detect silently ✓
- New project init: `/gsd init` from inside TUI ✓
- Approach: surgical fix (Approach A in brainstorm) ✓

## 11. Implementation pointer

Implementation plan will be produced by `superpowers:writing-plans` once this
design is approved. Estimated scope: ~4 existing files modified + 2 new files
(`init.ts`, `require-project.ts`) + N existing command files getting a
one-line guard. ~150-300 LOC including tests. One PR.

---

*This design was produced via the `superpowers:brainstorming` skill on
2026-05-25. Brainstorm conversation lives in the session transcript.*
