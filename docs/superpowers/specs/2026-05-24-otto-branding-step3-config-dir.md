# OTTO Branding — Step 3: Config Dir (~/.loop24 → ~/.otto)

**Date:** 2026-05-24
**Status:** Approved — ready for implementation
**Part of:** OTTO branding rollout. This is the **config-dir migration** step
(canonical roadmap step 4; file-sequence step 3, following step1/step2 which
merged the binary+slash rename). Env vars (`LOOP24_*` → `OTTO_*`) are the next
step.

## Background

Steps 1–2 made the brand name `OTTO` and the command `otto`/`/otto`. The user
config dir is still `~/.loop24/agent/`. This step renames it to `~/.otto/agent/`
and migrates existing users' data.

The dir is derived from `piConfig.configDir` in three independent module-load
readers (`packages/pi-coding-agent/src/config.ts:CONFIG_DIR_NAME`, `src/brand.ts`,
`src/app-paths.ts`, `src/help-text.ts`), each with a hardcoded `'.loop24'`
fallback. Flipping `configDir` cascades to every derived path
(`getAgentDir`, `getPromptsDir`, `appRoot`, `agentDir`, sessions, auth, etc.).

## Critical discovery: two different `.loop24` meanings

A repo-wide scan found **~448 `.loop24` references** (19 code strings, ~404
comments, plus tests). They split into **two unrelated dirs**:

1. **User config dir** — `~/.loop24/agent/`, `~/.loop24/config.json`,
   `~/.loop24/prompts/`. This is what this step renames. **→ `.otto`**
2. **Project state dir** — the workflow extension hardcodes `.gsd`
   (`paths.ts`, `auto-post-unit.ts:149`, `auto-start.ts:811`; global home
   `~/.gsd`). Comments/messages that say `.loop24/KNOWLEDGE.md`,
   `.loop24/milestones/`, `.loop24/workflow-runs/`, `.loop24.db`, and the two
   `headless.ts` bootstrap messages are **stale gsd→loop24 drift** — runtime
   uses `.gsd`. **→ `.gsd`** (correcting them to runtime truth; the `.gsd`
   project-dir lineage is intentionally NOT rebranded in this rollout).

So the sweep is a **smart clean**, not a blind `.loop24`→`.otto`.

## Classification rule (for the sweep)

| A `.loop24` reference that… | Becomes |
|---|---|
| Is rooted at `~/`, `homedir()`, or contains `/agent`, `/config.json`, `/prompts`, `/sessions`, `/themes`, `/extensions`, `/bin`, `auth.json`, `models.json`, `settings.json` | `.otto` |
| Describes project workflow state: `/milestones`, `/workflow-runs`, `/workflow-defs`, `/KNOWLEDGE`, `/REQUIREMENTS`, `/STATE`, `/PROJECT.md`, `/github-sync`, `/exec`, `/runtime`, `/activity`, `/slices`, `/audit`, or `.loop24.db`, or "Bootstrapping .loop24/", "No .loop24/ directory" | `.gsd` |

When ambiguous, prefer the user-dir reading only if the path clearly resolves
under the home/agent dir; otherwise treat as project state (`.gsd`).

## Scope — changes in this step

### A. `piConfig.configDir`: `".loop24"` → `".otto"`
- Edit root `package.json` `piConfig.configDir`; run `npm run sync-piconfig`;
  `npm run verify:piconfig-sync` must pass (propagates to the two mirrors).

### B. Parameterize — single source of truth (no more scattered literals)

Rather than swap each hardcoded `'.loop24'` for a hardcoded `'.otto'` (which just
relocates the problem), introduce **one** zero-dependency reader and have every
wrapper-layer consumer import from it. A future rebrand is then just the
`piConfig` edit + `sync-piconfig`.

- **New** `src/piconfig.ts` — reads `package.json` `piConfig` once (Node builtins
  only, no compiled-pi import so it is safe on the early loader path). Exports
  `BRAND_NAME`, `COMMAND_NAMESPACE`, `CONFIG_DIR_NAME`, `BRAND_TAGLINE`. Holds the
  **single** last-resort fallback literal.
- `src/brand.ts` — drop its own `package.json` read; import + re-export from
  `piconfig.ts` (keep the loop24-config side effect + gateway env reads).
- `src/app-paths.ts` — import `CONFIG_DIR_NAME` from `piconfig.ts`; drop its read.
- `src/help-text.ts` — import the four brand strings from `piconfig.ts`; drop its
  read.
- No circular import: `piconfig.ts` is a leaf; `loop24-config.ts → piconfig.ts`;
  `brand.ts → {loop24-config, piconfig}`.

### C. True code literals (parameterized, not re-hardcoded)
- `src/loop24-config.ts` `configPath()` → `join(root, CONFIG_DIR_NAME, "config.json")`
  (imports `CONFIG_DIR_NAME` from `piconfig.ts`).
- `src/resources/extensions/loop24/commands/prompt-engineer/_storage.ts`
  `defaultBaseDir()` → `join(homedir(), CONFIG_DIR_NAME, "prompts")` (imports
  `CONFIG_DIR_NAME` from `@loop24/pi-coding-agent`, the resolvable path for a
  deployed extension).
- `src/cli.ts:353` message `~/.loop24/config.json` → derive from
  `CONFIG_DIR_NAME`.
- `src/resources/extensions/workflow/forensics.ts:172` `~/.loop24/agent/...`
  → derive from `CONFIG_DIR_NAME`.
- `src/resources/extensions/workflow/strings.ts:15-16` comments
  `".loop24.db"`/`".loop24"` → reflect reality: `STATE_DB_NAME` is
  `.${COMMAND_NAMESPACE}.db` = `.otto.db` (already flipped in step 2 — fix the
  stale comment only).

### D. Project-dir corrections (→ `.gsd`)
- `src/headless.ts:346` "Bootstrapping .loop24/ project structure…" → `.gsd/`.
- `src/headless.ts:360` "No .loop24/ directory found…" → `.gsd/`; the same
  block's "Run 'gsd' interactively" → "Run 'otto' interactively" (step-2 miss).
- All workflow-extension comments describing project state → `.gsd` per the rule.

### E. Smart comment/string sweep
Apply the classification rule across `src/` and
`packages/pi-coding-agent/src/` (excluding the exclusions below). User-dir →
`.otto`, project-dir → `.gsd`.

### F. First-launch copy migration
On startup, **before** the agent dir is consumed, if `~/.otto` does **not**
exist but `~/.loop24` **does**, copy `~/.loop24` → `~/.otto` (recursive). Leave
`~/.loop24` intact (safety net; user deletes manually). Idempotent: skip if
`~/.otto` already exists. Best-effort and wrapped so it can never crash the
loader. Hook in the early startup path (`src/loader.ts` / `src/app-paths.ts`
consumer), honoring `LOOP24_HOME`/`OTTO_HOME` overrides if set (migrate the
resolved appRoot, not a hardcoded `~/.loop24`).

### G. Tests
- `packages/pi-coding-agent/src/config.test.ts:10` `CONFIG_DIR_NAME` →
  `".otto"`.
- `src/tests/loop24-config.test.ts:37,39,49,97` `.loop24` → `.otto`.
- `src/tests/welcome-screen.test.ts:108,110,138` `.loop24` → `.otto`.
- Add a migration unit test: given a temp home with `.loop24/agent` and no
  `.otto`, the migration copies it; given an existing `.otto`, it is a no-op.

## Exclusions (MUST NOT change)
- `piConfig.name` (`"loop24"`), `APP_NAME`, npm package `@ericsson/loop24`,
  workspace scope `@loop24/*`.
- Internal filenames/identifiers: `loop24-config.ts`, `loop24-wizard.ts`, the
  `extensions/loop24/` resource dir, `loop24.json` theme.
- `LOOP24_*` env var names and `LOOP24_HOME`/`OTTO_HOME` (step 4).
- The `.gsd` project-dir name itself — not renamed; we only correct stale
  `.loop24` comments to `.gsd`.

## Acceptance criteria
- `npm run build` exits 0; `verify:piconfig-sync` passes.
- `getAgentDir()` / `appRoot` resolve under `~/.otto/` (functional check).
- Fresh launch with an existing `~/.loop24/` and no `~/.otto/` copies the dir;
  second launch is a no-op; `~/.loop24/` remains.
- `grep -rn "\.loop24" src packages/pi-coding-agent/src` (excluding the
  exclusions, filenames, and `LOOP24_*`) returns **zero** — every remaining
  path ref is `.otto` (user) or `.gsd` (project).
- Standing 74-test regression passes (plus the new migration test).
- No `git add -A`; `docs/branding/` untouched.

## Commits (bisectable)
1. `feat(otto-step3): flip configDir .loop24 → .otto + fallbacks + migration`
   (piConfig + sync + fallback defaults + code literals + migration + tests).
2. `feat(otto-step3): smart-sweep stale .loop24 refs (user→.otto, project→.gsd)`
   (comment/string sweep).
