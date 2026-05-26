# PRD: Pi Clean Seam Refactor

**Author:** Tom Boucher
**Date:** 2026-04-14
**ADR:** [ADR-010-pi-clean-seam-architecture.md](./ADR-010-pi-clean-seam-architecture.md)
**Priority:** High — blocks safe pi-mono upstream updates

---

## Problem Statement

OTTO is built on top of pi-mono, an open-source agent framework maintained by Mario Zechner at [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono). OTTO takes pi-mono as vendored source copies — four packages (`pi-agent-core`, `pi-ai`, `pi-tui`, `pi-coding-agent`) are copied directly into `/packages/` and modified in-place.

This worked as a starting point but has created a structural problem: **OTTO-authored code lives inside the pi packages**. The 98KB `agent-session.ts`, the compaction system, three run modes (interactive, RPC, print), the CLI utilities, and the `createAgentSession()` factory are all authored by OTTO but stored inside `pi-coding-agent`. Approximately 79 OTTO-authored TypeScript files are mixed in with pi's upstream source.

The consequence is that every pi-mono update requires manually diffing OTTO's modifications against the incoming upstream changes file-by-file. There is no reliable way to tell which files are OTTO's and which are pi's without reading them. Updates that should take hours become multi-day archaeology projects. Pi-mono is currently 10 versions behind upstream (0.57.1 vs 0.67.2 as of April 2026), with a blocking API change (`session_switch`/`session_fork` removal in v0.65.0) unresolved.

Beyond update pain, there is a project risk: if pi-mono stops being maintained or changes direction, OTTO's business logic is entangled with a dependency it no longer controls.

## Vision

OTTO's code is clearly separated from pi's code at the module system level. The vendored pi packages contain only upstream code (plus the extension system, which is intentionally pi-typed). OTTO's agent logic lives in OTTO-owned packages that **depend on** pi but do not live inside it. When a new pi release comes out, a maintainer updates the vendored pi packages, runs the TypeScript compiler, and fixes the errors that surface in the OTTO packages — without ever needing to diff individual files to find what's ours vs. theirs.

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Zero OTTO business logic in vendored pi packages | `pi-coding-agent/src/` contains no files that import from `@otto/` packages (except the extension system's bundled module map) |
| Module boundary is compiler-enforced | TypeScript `paths` config or package `exports` prevents pi packages from importing OTTO packages |
| Applying a pi-mono update is scoped | Updating pi packages produces type errors only in `@otto/agent-core` and `@otto/agent-modes` — no changes required in pi package source files |
| Install experience is unchanged | `npm install -g @cmetech/otto@latest` produces an identical binary from the user's perspective |
| Existing extensions continue to work | All built-in OTTO extensions load and execute without modification |
| Build time does not regress significantly | Full build completes within 120% of current baseline |

## Non-Goals

- **Not** moving pi packages from vendored source to npm dependencies (that is a potential Phase 2)
- **Not** creating an abstraction layer that hides pi types from OTTO code — OTTO packages may freely use pi's `AgentMessage`, `Model`, `TUI`, etc.
- **Not** upstreaming OTTO's modifications to pi-mono (desirable long-term but out of scope)
- **Not** changing the published npm package name, install command, or any user-facing CLI behavior
- **Not** removing or replacing the extension system — it stays in `pi-coding-agent` and remains typed against pi's types

## Stakeholders

- **Maintainers applying pi updates** — primary beneficiary; this work directly reduces their update burden
- **Extension authors** — must not be broken; the extension API surface stays in `@otto/pi-coding-agent`
- **End users** — not impacted; the refactor is entirely internal

## Requirements

### R1 — New package: `@otto/agent-core`

A new workspace package at `packages/otto-agent-core/` that owns all OTTO session orchestration logic. It depends on `@otto/pi-coding-agent`, `@otto/pi-agent-core`, and `@otto/pi-ai`. Nothing in the vendored pi packages depends on it.

Must contain:
- `agent-session.ts` and all `AgentSession` types
- `compaction/` (orchestrator, branch summarization, utilities)
- `system-prompt.ts`
- `bash-executor.ts`
- `fallback-resolver.ts`
- `lifecycle-hooks.ts`
- `image-overflow-recovery.ts`
- `contextual-tips.ts`
- `keybindings.ts`
- `sdk.ts` (the `createAgentSession()` factory — the primary public API of this package)
- `artifact-manager.ts`, `blob-store.ts`
- `export-html/`

### R2 — New package: `@otto/agent-modes`

A new workspace package at `packages/otto-agent-modes/` that owns all run-mode and CLI code. It depends on `@otto/agent-core`, `@otto/pi-coding-agent`, and `@otto/pi-tui`. It is the layer the top-level `otto-pi` binary entry point assembles.

Must contain:
- `modes/interactive/` (full TUI interactive mode and all components)
- `modes/rpc/` (RPC server, RPC client, JSON protocol)
- `modes/print/` (print/headless mode)
- `cli/` (arg parsing, config selector, session picker, model lister, file processor)
- `main.ts` entry point logic

### R3 — `pi-coding-agent` contains only upstream code and the extension system

After the migration, the vendored `pi-coding-agent` source must not contain files that:
- Import from `@otto/agent-core` or `@otto/agent-modes`
- Contain OTTO business logic (compaction, session management, run modes, CLI)

The extension system (`src/core/extensions/`) remains in `pi-coding-agent` because it is legitimately pi-typed: extension authors write against pi's `AgentMessage`, `Model`, and `TUI` types. The virtual module map in `extensions/loader.ts` must be updated to include `@otto/agent-core` and `@otto/agent-modes` so extensions can import from them.

### R4 — Public API surfaces are explicit

Each new package must have an `index.ts` that declares its public API. Internal files must not be imported by path from outside the package. Specifically:
- `web/bridge-service.ts` currently imports `AgentSessionEvent` from an internal path in `pi-coding-agent` — this must be fixed to use the public export from `@otto/agent-core`
- Any other internal-path imports identified during migration must be fixed

### R5 — Build order is updated

The workspace build script must be updated to build packages in dependency order:
1. `@otto/pi-agent-core`, `@otto/pi-ai`, `@otto/pi-tui` (parallel, no dependencies between them)
2. `@otto/pi-coding-agent`
3. `@otto/agent-core`
4. `@otto/agent-modes`
5. `otto-pi` (top-level binary)

### R6 — No change to the extension loader's public interface

Extensions are loaded by `pi-coding-agent`'s jiti-based loader. The virtual module map (`STATIC_BUNDLED_MODULES`) must be updated to resolve `@otto/agent-core` and `@otto/agent-modes` alongside the existing pi package mappings. This requires both a map entry and a top-level bundle import in `loader.ts` (see ADR-009 for the exact diff). Extension authors must not need to change their import paths.

## Open Questions

1. Does `clearQueue()` on `AgentSession` need to be added to a public type export, or is it already accessible to the auto-mode extension that uses it?
2. Does `buildSessionContext()` on `SessionManager` need a public re-export from `@otto/agent-core`?
3. Should `@otto/agent-modes` re-export `createAgentSession()` as a convenience, or should consumers always import it from `@otto/agent-core` directly?
