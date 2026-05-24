# OTTO Branding — Step 2: Command Rename (loop24 → otto)

**Date:** 2026-05-24
**Status:** Approved — ready for implementation plan
**Part of:** OTTO branding rollout. This **merges the originally-planned steps 2 (binary rename) and 3 (slash namespace)** into one step, because both are driven by a single knob (`piConfig.commandNamespace`) and cannot be cleanly separated.

## Background

Step 1 changed the displayed brand *name* to OTTO. The **command** users type is still `loop24` — both the shell binary and the in-app `/loop24` slash commands. This step renames the command to `otto`.

### Why steps 2 and 3 merge

`piConfig.commandNamespace` ("loop24") is a single source that drives three distinct surfaces:

1. **Binary-invocation help text** — `src/help-text.ts` (`${CMD}` = commandNamespace), `src/cli.ts`/`src/loop24-wizard.ts` (`"${COMMAND_NAMESPACE} config"`).
2. **Slash commands** — registration via `pi.registerCommand(COMMAND_NAMESPACE, …)` in `commands/index.ts`, and hints like `/${COMMAND_NAMESPACE} start` in `welcome-screen.ts`/`onboarding.ts`.
3. **Dynamic log prefixes** — `[${COMMAND_NAMESPACE}]` in cli/wizard/onboarding (these render `[loop24]` at runtime and were *not* caught by step 1's literal-`[loop24]` sweep; they self-correct when the namespace flips).

There is no separate "binary name" field. Making help text say `otto config` *requires* `commandNamespace = otto`, which also makes slash commands `/otto`. Splitting them would mean inventing a `binName` field (YAGNI). So the binary, its help text, and its slash commands all rename together.

User decisions (locked):
- Command name **`otto`**, hard replace — after reinstall, `loop24` is gone (command-not-found), no transitional alias.
- Slash namespace **`/otto`**.

## Goal

`otto` is the command everywhere: the shell binary, its `--help`/usage text, its slash commands, and its log prefixes. `loop24` survives only as the npm packaging identity and in the not-yet-migrated config dir / env vars.

## Scope — changes in this step

### A. Binary name — `package.json` `bin`
- `"bin": { "loop24": "dist/loader.js" }` → `"bin": { "otto": "dist/loader.js" }`.

### B. `piConfig.commandNamespace` loop24 → otto (the load-bearing flip)
- Edit root `package.json` `piConfig.commandNamespace` → `"otto"`; run `npm run sync-piconfig` to propagate to the two mirrors; `npm run verify:piconfig-sync` must pass.
- This auto-flips every `${COMMAND_NAMESPACE}` / `${CMD}` / `/${COMMAND_NAMESPACE}` / `[${COMMAND_NAMESPACE}]` consumer (help-text usage lines, cli/wizard messages, welcome/onboarding slash hints, dynamic log prefixes).
- `src/brand.ts` exports `COMMAND_NAMESPACE` from this field; command dispatch (`pi.registerCommand(COMMAND_NAMESPACE, …)`) then registers under `otto` → `/otto …` works, `/loop24 …` no longer resolves.

### C. Hardcoded literal command-reference sweep
~121 occurrences across ~26 files use literal `loop24 <subcommand>` or `/loop24 <subcommand>` instead of the variable. Flip these:
- `loop24 <cmd>` → `otto <cmd>` (shell invocations: `loop24 config`, `loop24 -w`, `loop24 auto`, `loop24 worktree …`, `loop24 graph …`, `loop24 --print/--mode/--web`, `loop24 headless`, `loop24 setup`).
- `/loop24 <cmd>` → `/otto <cmd>` (slash hints: `/loop24 auto`, `/loop24 worktree`, `/loop24 start`, `/loop24 prompt-engineer`, `/loop24 build-flow`, `/loop24 templates`, `/loop24 next`, `/loop24 setup`, `/loop24 onboarding`, etc.).

Files include (plan will enumerate exact lines): `src/cli.ts`, `src/help-text.ts` (the few non-`${CMD}` literals if any), `src/worktree-cli.ts`, `src/worktree-status-banner.ts`, `src/headless.ts`, `src/loop24-wizard.ts`, and ~20 under `src/resources/extensions/workflow/` (auto.ts, setup-catalog.ts, guided-flow.ts, commands-worktree.ts, commands/handlers/*, bootstrap/*, auto/phases.ts, prompt/skill `.md` files, etc.) plus `packages/pi-coding-agent/src/modes/interactive/components/footer.ts` and `controllers/input-controller.ts`.

### D. `scripts/install.sh`
- `PROG_NAME="loop24"` → `"otto"` (symlinks `~/.local/bin/otto`).
- All user-facing message strings (`Run 'loop24 config' …` → `otto config`).
- **Fix the stale package-name guard** at line ~78: it greps for `'"@loop24/client"'` but the package is `@ericsson/loop24` — this guard currently fails. Update to match the real package name (improve-while-touching).

### E. Docs
- `README.md`, `docs/INSTALL.md`: command examples `loop24 …`/`/loop24 …` → `otto …`/`/otto …`. (Keep `@ericsson/loop24` npm install lines and `~/.loop24/` path references as-is — those are packaging / deferred.)

### F. Global reinstall (manual, user-run)
- After build, the npm global bin symlink still points `loop24` → loader. The user re-runs the global install (`npm install -g .` from the repo, or the documented install path) to create the `otto` bin and remove `loop24`. This is a manual step the user performs (it mutates their global environment); the plan documents the exact command and a verification (`which otto`, `which loop24` → not found).

## Out of scope (later steps / never)
- `~/.loop24/` config dir (`piConfig.configDir`) — **step 3** (renumbered; config-dir migration).
- `LOOP24_*` env vars — **step 4** (renumbered).
- npm package `@ericsson/loop24`, `@loop24/*` scope, `piConfig.name` — packaging, stays.

## Sweep exclusions (MUST NOT flip)
- `.loop24` / `~/.loop24` config-dir paths.
- `@loop24/…` workspace scope, `@ericsson/loop24` package name.
- `LOOP24_*` env var names.
- Internal file/module/import names: `loop24-wizard.ts`, `loop24-config.ts`, `loop24-config.js`, the `extensions/loop24/` resource dir, `loop24.json` theme file.
- `piConfig.name` ("loop24") — distinct from commandNamespace; leave it.
- Any persisted `customType` strings (`"gsd-*"`) — separate session-compat concern, not touched.

## Risk + mitigation
`commandNamespace` is load-bearing — the Phase 2c bug ("Unknown command", `/loop24` showed in autocomplete but didn't dispatch) was caused by the three piConfig copies drifting on exactly this field. Mitigation:
- Change only root `package.json`; use `sync-piconfig` to propagate; gate on `verify:piconfig-sync`.
- After build + reinstall, **functionally verify**: `otto` launches, `otto --help` reads `otto …`, and inside the TUI `/otto status` dispatches (not "Unknown command"). This is the definition-of-done, not just a grep.

## Acceptance criteria
- `package.json` bin is `otto`; build exits 0; `verify:piconfig-sync` passes.
- `grep -rn "loop24 \|/loop24 " src/ packages/pi-coding-agent/src/` (excluding the exclusions list, comments, tests) returns zero user-facing command-reference literals; `otto`/`/otto` present instead.
- After global reinstall: `which otto` resolves; `which loop24` → not found.
- `otto --help` header + usage lines read `otto …`; `otto worktree list` hint reads `otto -w <name>`; `otto graph status` hint reads `otto graph build`.
- Inside the TUI, `/otto status` dispatches correctly (functional check — guards against the Phase 2c failure mode).
- Standing 74-test regression 74/74; build clean.
- `~/.loop24/` paths and `LOOP24_*` env vars still present (deferred — verified NOT changed).
- No `git add -A`; `docs/branding/` untouched.

## Expected scale
~26 source files (~121 literal refs) + `package.json` (bin + commandNamespace, +2 synced mirrors) + `install.sh` + README/INSTALL. Larger than step 1; the commandNamespace flip is low-LOC but the highest-risk single change in the rollout. One feature unit; likely 3–4 commits (bin+namespace; literal sweep; install+docs; verification).
