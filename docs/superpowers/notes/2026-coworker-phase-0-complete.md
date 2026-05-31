# Coworker Phase 0 — Foundations — Complete

**Completed:** 2026-05-31

## What shipped

- Seven new workspace packages under `packages/coworker-*`:
  - `@otto/coworker-types` — shared types (memory, artifacts, vault, scratchpad/collector, contracts)
  - `@otto/coworker-utils` — NDJSON, lease, migration, secret scanner, logger
  - `@otto/coworker-memory`, `coworker-vault`, `coworker-artifacts`, `coworker-scratchpad` — pillar shells (impl in Phases 1-5)
  - `@otto/coworker-persona` — registry, manifest parser, `/persona` command handlers, built-in `default` persona
- Build pipeline + test pipeline wired (`build:coworker`, package test discovery)
- `/persona` slash commands functional (`list`, `current`, `switch`, `install`, `uninstall`, `reset`)
- Status-line persona chip rendered leftmost (key `00-persona`), using the persona's `status_line` icon + label
- Built-in `default` persona auto-activates in workspaces with no persona set (seeded on `session_start`)

## Architecture note — resources boundary

The pure `/persona` handlers live in `@otto/coworker-persona` (not `src/coworker/`)
because the Otto wiring at `src/resources/extensions/workflow/persona-status.ts`
is compiled under `tsconfig.resources.json` (`rootDir: src/resources`) and cannot
import from `src/`. `src/coworker/persona-commands.ts` re-exports the handlers for
its co-located unit test. Wiring imports only the package.

## Test counts

- coworker-types: 29 (memory + artifacts + vault + scratchpad + contracts + smoke)
- coworker-utils: 32 (ndjson + lease + migration + secret-scanner + logger)
- coworker-persona: 5 (manifest) + 6 (registry) = 11 package tests
- persona slash-command handlers: 4 (`src/coworker/persona-commands.test.ts`)
- Full build green (exit 0); `test:packages` green; extension bootstrap isolation green

## What's unblocked for the next phase

Phase 1 (otto-scratchpad MVP) can now import `MemoryRecorder`, `CollectorRegistry`,
`writeNdjson`/`readNdjson`, the lease helper, and the logger; can also read the active
persona via `PersonaRegistry.activeInWorkspace()` to expose `otto.persona` bindings in cells.
Phase 2 (otto-vault) can import `CredentialInjector`, `VaultEntry`, `EngineDef` and seed
engines from the active persona's `engines.yaml`. Phase 3 (otto-memory) can import
`MemoryBackend`, `Drawer`, `RecallQuery`, and seed Layer A from the persona's `memory-seed/`.
