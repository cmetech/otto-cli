# OTTO Branding — Step 1: Display Brand Name

**Date:** 2026-05-24
**Status:** Approved — ready for implementation plan
**Part of:** OTTO branding rollout (Approach A — staged by risk). This is **step 1 of 5**.

## Background

The product is being rebranded from **loop24** to **OTTO** (full name "OTTER —
Orchestrating Tools, Tasks, Execution & Research"; "OTTO" for short). The
decision is to make **OTTO the runtime brand** while keeping **loop24 as the
npm packaging identity**.

Final target state (across all 5 steps):

| Surface | Target | Step |
|---|---|---|
| Display brand name (banner, help header, footer, welcome) | OTTO | **1 (this spec)** |
| `[loop24]` log/error prefix | `[otto]` | **1 (this spec)** |
| Binary command (`loop24` → `otto`) | otto | 2 |
| Slash-command namespace (`/loop24` → `/otto`) | otto | 3 |
| Config dir (`~/.loop24/` → `~/.otto/`, with migration) | .otto | 4 |
| Env vars (`LOOP24_*` → `OTTO_*` canonical + fallbacks) | OTTO_* | 5 |

Stays loop24 throughout: npm package `@ericsson/loop24`, workspace scope
`@loop24/*`, `piConfig.name` (pi app identity / `PI_PACKAGE_DIR` resolution).

The staged approach was chosen because the five efforts have very different
risk profiles — a pure-display change (this step) vs. a user-data migration
(step 4) vs. a ~60-variable compat shim (step 5). Each step is its own
spec → plan → implement cycle so the risky pieces stay isolated and bisectable.

## Goal of Step 1

Make the product **name** read "OTTO" everywhere the running CLI displays it,
plus flip the `[loop24]` log prefix to `[otto]`. No command names, paths, slash
commands, or env vars change in this step.

## Why this is small

The brand layer is already centralized. `src/brand.ts` and `src/help-text.ts`
each read `piConfig.brandName` at module load and expose `BRAND_NAME` / `BRAND`.
Nearly all display surfaces consume that constant, so changing one config value
flips them all. Only two things bypass it: the static ASCII banner file and the
hardcoded `[loop24]` log prefixes.

## Scope — changes in this step

### 1. `piConfig.brandName`: `"LOOP24"` → `"OTTO"`

- Edit **root `package.json`** `piConfig.brandName`.
- Run `npm run sync-piconfig` (or rely on `prebuild`) to propagate to the two
  mirrors (`packages/pi-coding-agent/package.json`, `pkg/package.json`).
- This single change updates every `BRAND_NAME` / `BRAND` consumer, including:
  - **TUI footer** badge `● OTTO`
    (`packages/pi-coding-agent/src/modes/interactive/components/footer.ts:251`)
  - **Welcome screen**: `OTTO v<version> — compliant agent for developers`,
    `No active OTTO project`, `OTTO Project Console`
    (`src/welcome-screen.ts:126,144,151,173`)
  - **`--help` / `--version` header** and command descriptions
    (`src/help-text.ts:200,232` and the description strings)
  - **Transcript rail label** default
    (`packages/pi-coding-agent/src/modes/interactive/components/transcript-design.ts:217`)

### 2. Banner ASCII art → OTTO

- Replace `src/resources/extensions/loop24/branding/banner.txt` (currently
  spells LOOP24) with the **ANSI Shadow** OTTO art (matches the existing block
  style):

```
 ██████╗ ████████╗████████╗ ██████╗ 
██╔═══██╗╚══██╔══╝╚══██╔══╝██╔═══██╗
██║   ██║   ██║      ██║   ██║   ██║
██║   ██║   ██║      ██║   ██║   ██║
╚██████╔╝   ██║      ██║   ╚██████╔╝
 ╚═════╝    ╚═╝      ╚═╝    ╚═════╝ 
```

- The banner is read and printed by `src/loader.ts:117-124`. No loader code
  change needed — only the file contents.
- The file path keeps `loop24` in it (`extensions/loop24/branding/`); that's an
  internal resource path, not a display surface, and stays until/unless the
  extension dir is renamed (out of scope for all 5 steps).

### 3. `[loop24]` log/error prefix → `[otto]`

Flip the hardcoded prefix in these user-visible stderr/stdout/console writes.
The `loop24 <subcommand>` *invocation* text on the same lines stays `loop24`
(binary rename is step 2), producing accepted interim lines like
`[otto]   loop24 auto`.

- `src/cli.ts:82,83,84,85,87,89,90,91,93` (non-TTY help block) — prefix only
- `src/cli.ts:106` (extension load-error printer)
- `src/cli.ts:118` (extension warning printer)
- `src/cli.ts:261` (graph build-failed)
- `src/worktree-status-banner.ts:144,147`
- `src/worktree-cli.ts:369,372`
- `packages/pi-coding-agent/src/main.ts:414` (all-local offline-mode log)

Implementation note: these are independent literal strings, not derived from a
constant. Step 1 changes the literal `[loop24]` → `[otto]`. (A future cleanup
could derive the prefix from `BRAND_NAME.toLowerCase()` / `COMMAND_NAMESPACE`,
but that's out of scope — YAGNI for this step.)

## Out of scope (deferred to later steps)

- `loop24 <subcommand>` invocation hints in help/usage text (`loop24 auto`,
  `loop24 graph build`, `loop24 -w`, `loop24 worktree merge`, etc.) — **step 2**
- `/loop24` slash-command namespace (`piConfig.commandNamespace`) — **step 3**
- `~/.loop24/` config-dir paths (`piConfig.configDir`) — **step 4**
- `LOOP24_*` env vars — **step 5**
- `piConfig.name`, npm package name, `@loop24/*` workspace scope — stay loop24
- The `extensions/loop24/` resource directory name — not in any step
- Tagline "compliant agent for developers" — not brand-specific, unchanged

## Accepted interim inconsistency

After step 1, the product **name** reads OTTO (banner, footer, help header,
welcome, `[otto]` prefixes), but help/usage text still instructs the user to run
`loop24 auto`, type `/loop24 status`, and points at `~/.loop24/`. This is the
expected staged-rollout state — those are command/path tokens, not the brand
name, and they convert in steps 2–4.

## Acceptance criteria

- `npm run build` exits 0; `sync-piconfig` reports mirrors in sync.
- `loop24 --version` prints the version; `loop24 --help` header reads
  `OTTO v<version> — compliant agent for developers`.
- First-launch banner renders the OTTO ANSI Shadow art.
- TUI footer shows `● OTTO`; welcome screen shows `OTTO …`.
- `grep -rn "\[loop24\]" src/ packages/pi-coding-agent/src/` (excluding
  comments/tests) returns **zero** hardcoded prefixes; `[otto]` appears instead.
- Help/usage text still shows `loop24 <subcommand>` invocations (deferred to
  step 2) — verified present, not a regression.
- Standing 74-test regression: 74/74 pass.
- No `git add -A`; `docs/branding/` untouched.

## Files touched (estimate)

- `package.json` (+ 2 synced mirrors via sync-piconfig)
- `src/resources/extensions/loop24/branding/banner.txt`
- `src/cli.ts`, `src/worktree-cli.ts`, `src/worktree-status-banner.ts`,
  `packages/pi-coding-agent/src/main.ts`

~5 source files + 2 auto-synced mirrors, ~25 line changes. Single focused commit.
