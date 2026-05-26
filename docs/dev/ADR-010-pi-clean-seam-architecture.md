# ADR-010: Pi Clean Seam Architecture

**Status:** Proposed
**Date:** 2026-04-14
**Deciders:** Tom Boucher
**PRD:** [PRD-pi-clean-seam-refactor.md](./PRD-pi-clean-seam-refactor.md)

---

## Context

OTTO vendors four packages from [pi-mono](https://github.com/badlogic/pi-mono) (an open-source coding agent framework) by copying their source directly into `/packages/`:

| Package | Role | Current version |
|---|---|---|
| `@otto/pi-agent-core` | Core agent loop and types | 0.57.1 |
| `@otto/pi-ai` | Multi-provider LLM API | 0.57.1 |
| `@otto/pi-tui` | Terminal UI framework | 0.57.1 |
| `@otto/pi-coding-agent` | Coding agent, tools, extension system | 2.74.0 |

Vendoring was chosen over npm dependencies to allow OTTO to modify the upstream packages freely. However, over time, OTTO has written substantial original logic directly inside `pi-coding-agent` — approximately 79 files including:

- `agent-session.ts` (98KB) — the primary OTTO session orchestrator
- `compaction/` — context window management
- `modes/interactive/`, `modes/rpc/`, `modes/print/` — all three run modes
- `cli/` — CLI argument parsing and utilities
- `sdk.ts` — the `createAgentSession()` factory

This OTTO-authored code is mixed in with upstream pi code inside the same package. The pi packages are currently 10 versions behind upstream (0.57.1 vs 0.67.2), with a breaking API change from v0.65.0 (`session_switch`/`session_fork` removal) unresolved. The primary obstacle to applying updates is that there is no reliable way to distinguish OTTO files from pi files without reading them individually.

### Why not move to npm dependencies now?

Pi-mono does publish to npm as `@mariozechner/pi-*`. Moving to npm dependencies would eliminate vendoring entirely, but it is blocked by:

1. `@otto/native` bindings are imported directly inside the vendored pi-tui and pi-coding-agent source — the upstream npm packages do not have these imports
2. ~50 direct source modification commits to the vendored packages since March 2026 would need to be evaluated individually
3. The upstream extension API (~25 events) is a subset of OTTO's extension system (~50+ events) — the delta would need to be re-architected before the move

Moving to npm is a valid Phase 2. This ADR covers Phase 1: establishing a clean seam without changing the vendoring approach.

---

## Decision

Introduce two new workspace packages that own all OTTO-authored code currently living inside `pi-coding-agent`. The vendored pi packages become close-to-upstream source copies. OTTO code depends on pi; pi code does not depend on OTTO.

### New package structure

```
packages/
  pi-agent-core/          # vendored upstream — no OTTO modifications
  pi-ai/                  # vendored upstream — no OTTO modifications
  pi-tui/                 # vendored upstream — no OTTO modifications
  pi-coding-agent/        # vendored upstream + extension system (pi-typed, stays here)
  otto-agent-core/         # NEW — OTTO session orchestration layer
  otto-agent-modes/        # NEW — OTTO run modes and CLI layer
```

### Dependency graph

```
otto (binary)
  └── @otto/agent-modes
        ├── @otto/agent-core
        │     ├── @otto/pi-coding-agent
        │     ├── @otto/pi-agent-core
        │     └── @otto/pi-ai
        └── @otto/pi-coding-agent
              ├── @otto/pi-agent-core
              ├── @otto/pi-ai
              └── @otto/pi-tui
```

Arrows point in one direction only. No cycles. The vendored pi packages have no knowledge of `@otto/agent-core` or `@otto/agent-modes`.

---

## Package Specifications

### `@otto/agent-core` (`packages/otto-agent-core/`)

**Purpose:** OTTO's session orchestration layer. Owns the `AgentSession` class, compaction, bash execution, system prompt construction, and the `createAgentSession()` factory that wires everything together.

**Public API surface (exported from `index.ts`):**

```typescript
// Primary factory — the entry point for everything above this layer
export { createAgentSession, CreateAgentSessionOptions, CreateAgentSessionResult } from './sdk.js'

// Session class and types
export { AgentSession, AgentSessionEvent } from './agent-session.js'

// Supporting types consumed by modes and extensions
export { CompactionOrchestrator } from './compaction/index.js'
export { BashExecutor } from './bash-executor.js'
export { SystemPromptBuilder } from './system-prompt.js'
export { LifecycleHooks } from './lifecycle-hooks.js'
export { ArtifactManager } from './artifact-manager.js'
export { BlobStore } from './blob-store.js'
```

**Files migrating in from `pi-coding-agent/src/core/`:**

| File | Notes |
|---|---|
| `agent-session.ts` | Core session class — 98KB, primary migration target |
| `sdk.ts` | `createAgentSession()` factory |
| `compaction/compaction.ts` | Context window orchestration |
| `compaction/branch-summarization.ts` | Summarization on fork |
| `compaction/utils.ts` | Shared compaction utilities |
| `system-prompt.ts` | OTTO system prompt construction |
| `bash-executor.ts` | Bash runtime with OTTO integration |
| `fallback-resolver.ts` | Model fallback strategy |
| `lifecycle-hooks.ts` | Phase hook system |
| `image-overflow-recovery.ts` | Context overflow recovery |
| `contextual-tips.ts` | Help text system |
| `keybindings.ts` | Keyboard binding manager |
| `artifact-manager.ts` | Blob artifact storage |
| `blob-store.ts` | External binary data management |
| `export-html/` | Session HTML export |

**Key dependency note:** `agent-session.ts` imports pi types directly (`Agent`, `AgentEvent`, `AgentMessage`, `AgentState`, `AgentTool`, `ThinkingLevel` from `@otto/pi-agent-core`; `Model`, `Message` from `@otto/pi-ai`). This is intentional — OTTO's session layer is pi-typed, not abstracting over pi. This makes the seam a clear seam, not an abstraction.

---

### `@otto/agent-modes` (`packages/otto-agent-modes/`)

**Purpose:** OTTO's run-mode and CLI layer. Assembles the agent session (from `@otto/agent-core`) with a specific interface: interactive TUI, headless RPC server, or print output. Contains the `main()` entry point logic invoked by the `otto` binary.

**Public API surface (exported from `index.ts`):**

```typescript
export { runInteractiveMode } from './modes/interactive/index.js'
export { runRpcMode, RpcMode } from './modes/rpc/index.js'
export { runPrintMode } from './modes/print/index.js'
export { RpcClient } from './modes/rpc/rpc-client.js'
export { parseArgs, GsdArgs } from './cli/args.js'
export { main } from './main.js'
```

**Files migrating in from `pi-coding-agent/src/`:**

| Directory/File | Notes |
|---|---|
| `modes/interactive/` | Full TUI interactive mode (~30 component files) |
| `modes/rpc/` | RPC server, client, JSON protocol, remote terminal |
| `modes/print/` | Print/headless mode |
| `modes/shared/` | Shared mode utilities and UI context setup |
| `cli/args.ts` | CLI argument parsing |
| `cli/config-selector.ts` | Config directory selection |
| `cli/session-picker.ts` | Session picker UI |
| `cli/list-models.ts` | Model listing |
| `cli/file-processor.ts` | File input processing |
| `main.ts` | Entry point logic |

---

### `pi-coding-agent` (what remains)

After the migration, `pi-coding-agent` contains:

- **Upstream tools** (`src/core/tools/`) — bash, read, edit, write, find, grep, ls, hashline tools
- **Upstream agent infrastructure** — auth storage, model registry, upstream session manager
- **Extension system** (`src/core/extensions/`) — loader, runner, types, wrapper

The extension system remains here because it is legitimately pi-typed. Extensions subscribe to pi events (`session_start`, `tool_execution_start`, `model_select`, etc.) and receive pi types in their handlers. Moving the extension system out of `pi-coding-agent` would require re-expressing those types in OTTO terms, which is the abstraction-layer work explicitly out of scope for this phase.

**Required update to extension loader:**

`src/core/extensions/loader.ts` maintains a `STATIC_BUNDLED_MODULES` map of packages that extensions can import at runtime. After the migration, `@otto/agent-core` and `@otto/agent-modes` must be added to this map so that extensions importing those packages continue to resolve correctly in compiled Bun binaries:

```typescript
// Before (current)
const STATIC_BUNDLED_MODULES = {
  "@otto/pi-agent-core": _bundledPiAgentCore,
  "@otto/pi-ai": _bundledPiAi,
  "@otto/pi-tui": _bundledPiTui,
  "@otto/pi-coding-agent": _bundledPiCodingAgent,
  // ...
}

// After
const STATIC_BUNDLED_MODULES = {
  "@otto/pi-agent-core": _bundledPiAgentCore,
  "@otto/pi-ai": _bundledPiAi,
  "@otto/pi-tui": _bundledPiTui,
  "@otto/pi-coding-agent": _bundledPiCodingAgent,
  "@otto/agent-core": _bundledGsdAgentCore,     // NEW
  "@otto/agent-modes": _bundledGsdAgentModes,   // NEW
  // ...
}
```

---

## How Pi Updates Work After This Change

1. Download the new pi-mono release for the four vendored packages
2. Copy the upstream source into `packages/pi-agent-core/`, `pi-ai/`, `pi-tui/`, `pi-coding-agent/`
   - Do not touch `packages/otto-agent-core/` or `packages/otto-agent-modes/`
3. Run `tsc --noEmit` (or the build) across the workspace
4. Fix type errors in `@otto/agent-core` and `@otto/agent-modes` only
5. If upstream changed the extension event API, fix extension system integration in `pi-coding-agent/src/core/extensions/`

Steps 2-5 are scoped to known files. No archaeology required.

---

## Known Issues to Fix During Migration

| Issue | Location | Fix |
|---|---|---|
| Internal-path import of `AgentSessionEvent` | `src/web/bridge-service.ts` | Import from `@otto/agent-core` public export |
| `clearQueue()` not in typed public API | `AgentSession` | Add to public interface in `@otto/agent-core/index.ts` |
| `buildSessionContext()` on `SessionManager` | Used by OTTO code, not publicly exported | Evaluate: re-export from `@otto/agent-core` or remove dependency |
| Deprecated `session_switch`, `session_fork`, `session_directory` usage | 2+ files in `pi-coding-agent` | Migrate to `session_start` with `reason` field (required for v0.65.0 compat) — can be done as part of or after clean seam work |

---

## Consequences

### Positive

- Pi updates are scoped: type errors from a pi update surface only in the two new OTTO packages, not scattered across mixed source
- The module system enforces the boundary: a pi file importing `@otto/agent-core` is a compiler error, not a convention violation
- Phase 2 (moving pi packages to npm) becomes a package.json change rather than a file archaeology project
- Headless/RPC consumers can depend on `@otto/agent-core` without pulling in the TUI layer

### Negative

- One-time migration cost: ~79 file moves, import path updates across the codebase, two new `package.json` files, build script update
- The virtual module map in `extensions/loader.ts` grows by two entries and requires matching bundle imports at compile time
- Maintainers need to understand the new three-layer structure (`pi-coding-agent` → `agent-core` → `agent-modes`) when debugging

### Neutral

- End-user install experience (`npm install -g @cmetech/otto@latest`) is unchanged
- Extension authors see no change — the extension API surface remains in `@otto/pi-coding-agent`
- OTTO packages continue to use pi types directly — no new abstraction layer

---

## Alternatives Considered

### Single `@otto/agent` package

Move everything into one package instead of two. Simpler dependency graph but creates a large package where session logic and TUI logic share a build unit. Rejected because headless/RPC use cases would pull in the TUI unnecessarily, and the two concerns have meaningfully different consumers.

### Directory convention within `pi-coding-agent` (no new packages)

Add a `src/otto/` subdirectory inside `pi-coding-agent` to clearly mark OTTO files without creating new packages. Fastest to implement but the seam is a convention, not enforced by the module system. A future accidental cross-import would not be caught by the compiler. Rejected because the enforcement value of proper packages is worth the modest extra setup.

### Move to npm dependencies now (Phase 2 first)

Take `@mariozechner/pi-*` from npm and skip vendoring entirely. Blocked by `@otto/native` imports baked into the vendored source, ~50 direct source modification commits, and the upstream extension API gap. Deferred to Phase 2.

---

## Implementation Notes

The migration should proceed in this order to maintain a working build at each step:

1. **Audit** — identify all imports of `pi-coding-agent` internal paths (non-index) and document them
2. **Create packages** — scaffold `otto-agent-core` and `otto-agent-modes` with `package.json` and empty `index.ts`
3. **Move files in batches** — start with leaf files (no downstream dependents within pi-coding-agent), work toward `agent-session.ts` last
4. **Fix imports incrementally** — TypeScript will identify broken imports after each batch
5. **Update extension loader** — add new packages to virtual module map
6. **Update build script** — insert new packages in dependency order
7. **Verify** — full build, existing tests pass, `otto --version` works

The pi update to v0.67.2 (and the deprecated API migration) can be done as a follow-on once the clean seam is in place, since that work will be dramatically simpler with the new structure.
