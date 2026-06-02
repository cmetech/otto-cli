# Phase 3.1 — Production extension activators design

**Status:** Approved 2026-06-02 (brainstorming complete; spec written for plan input).
**Phase name:** Phase 3.1 — Production activators (closes Phase 2 + Phase 3 deferrals).
**Branch:** `feat/coworker-phase-3.1-activators` (created from `main` at `604aaa7`).
**Parent specs:**
- `docs/superpowers/specs/2026-05-30-otto-coworker-design.md`
- `docs/superpowers/specs/2026-06-01-coworker-phase-2-vault-design.md`
- `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md`

---

## 1 Goal

Wire the three co-worker extensions (`coworker-memory`, `coworker-vault`, `coworker-scratchpad`) to Otto's `ExtensionAPI` so the user-facing surfaces shipped in Phase 2 and Phase 3 actually work in a live Otto session. Today those surfaces are defined but unreachable: vault's `/connect` / `/datasource` / `/audit` commands and memory's `/memory` command + `memorize` / `recall` tools have no `api.registerCommand` / `api.registerTool` call site, and memory's `MemoryRecorder.recordTurn` has no event hook calling it on user turns.

The bar is concrete: when this phase merges, every step in `docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md` and `docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md` is live-runnable in the TUI — no more `[BLOCKED on 3.1]` tags. Both smoke checklists become executable manual-verification gates.

Phase 3 Task 20 (auto-retain user turns) and the Phase 3 Task 19 production hop (scratchpad `onDataLoad` → memory `recordFileLoad`) both close out as part of this phase. The Phase 2 vault activator gap (called out as a "Phase 2.1+ deferral" in `2026-06-02-coworker-phase-2-human-tests.md`) closes in the same phase.

## 2 Non-goals

- **Layer C entity knowledge graph, ACC, Cerebellum, Consolidator, weekly digest** — Phase 5 per `2026-05-30-otto-coworker-design.md` §17. No change here.
- **Persona seeding wiring.** `applyPersonaSeed` (Phase 3 Task 11) and `onSessionStart`'s persona branch (Phase 3 Task 17) stay in place and remain unit-tested. The activator does not invoke them in v1 — `persona` is not yet a first-class Otto concept and we don't want to ship a half-baked detection scheme. Adding persona seeding is a strict superset of the v1 activator's behavior; it can land later without breaking anything.
- **A scopeMode setting / config knob.** Hardcoded to `per-project-tagged` per spec §2's "one rule, no decisions" stance. Settings.json plumbing for memory or vault is out-of-scope.
- **Vault OAuth, OS keychain, additional engine seeds beyond `jira.yaml`.** Phase 2 deferral list still holds.
- **Memory user-turn capture via a structural refactor of pi-coding-agent's session controller.** We use the existing `before_agent_start` + `agent_start` events, not a new hook surface. If those events ever lose payload fields, that's a separate task.
- **Combined "coworker" mega-activator.** Three extensions, three activators, three manifests — direct cross-imports between them. Rationale: per-pillar boundaries match the package layout, the roadmap, and the smoke/human-test docs; collapsing them buys cosmetic tidiness at the cost of churning scratchpad's already-shipped activator. The packages are `tier: "bundled"` and always installed together, so cross-imports are safe (no "extension absent" defensive code needed — only "bundle hasn't constructed yet," which is gated by `session_start` ordering).

## 3 Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 3.1 | Three extension activators (no combined entry, no shared bus). | Matches existing package/roadmap boundaries; lowest-churn (scratchpad's activator already exists). |
| 3.2 | Cross-pillar wiring via **direct imports of stateless helpers**. Memory imports `createCurrentScratchpadProvider` from `coworker-scratchpad/sp-command.js` (Phase 3 Task 18); scratchpad imports `getMemoryRecorder` from `coworker-memory/index.js` (new, added in this phase). | Both pillars are `bundled`-tier and always shipped together. Stateless reads from disk (sidecars) or a module-scope `let` (recorder) sidestep ordering fragility. |
| 3.3 | `scopeMode` is **hardcoded to `'per-project-tagged'`** in memory's activator. | Spec §5 default; no settings UX needed for v1. |
| 3.4 | **Persona seed application is not wired** in v1. The helper exists; the activator skips the `persona` branch of `onSessionStart`. | No first-class persona concept yet; avoid premature detection scheme. |
| 3.5 | **Init failure policy: log + disable that pillar.** Bundle construction wrapped in try/catch; failure → `ctx.ui.notify('<pillar> unavailable: <reason>', 'warning')` and no commands/tools registered for that pillar. Other pillars + base chat continue. | Spec §"memory must never break chat"; symmetric for vault. |
| 3.6 | Auto-retain user turns wired via the **`before_agent_start` (captures `prompt`) + `agent_start` (captures `sessionId`, `turnId`)** event pair. | This is the seam that Phase 3 Task 20 investigation identified at `packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts:865`. No upstream changes required. |
| 3.7 | Memory `recordTurn` failures are **swallowed** at the activator call site (try/catch, `ctx.ui.notify('memory write failed', 'warning')` only on first failure per session to avoid noise). | "Never break the chat" principle. |
| 3.8 | Scratchpad `onDataLoad` → memory `recordFileLoad` failures are **swallowed silently** (no notify). | File loads are frequent; notify spam is worse than a silent drop. Failures are visible in `/audit`. |
| 3.9 | Test-glob hygiene: extend `package.json::scripts.test:unit:compiled` to include `dist-test/src/resources/extensions/coworker-{memory,vault,scratchpad}/*.test.js`. | Pre-existing gap surfaced in Phase 3 Task 23; extension tests don't currently run in the main suite. Land it once. |
| 3.10 | Smoke checklist updates: remove `[BLOCKED on 3.1]` tags from `2026-06-02-phase-2-vault-smoke.md` (and the parallel Phase 2 human-tests "Phase 2.1+ deferrals" note) and `2026-06-02-phase-3-memory-smoke.md`. Each blocked step is verified to be unblocked by running the smoke step on the activator branch before stripping its tag. | These docs are the contract; the phase isn't done until they're true. |

## 4 Architecture

```
                            Otto runtime (pi-coding-agent)
              ┌───────────────────────────────────────────────────────────┐
              │  ExtensionAPI: on(event), registerCommand, registerTool   │
              └────────┬──────────────────┬─────────────────────┬─────────┘
                       │                  │                     │
              ┌────────▼─────────┐ ┌──────▼────────┐ ┌──────────▼────────┐
              │ coworker-vault   │ │ coworker-     │ │ coworker-         │
              │ /index.ts (NEW)  │ │ memory/       │ │ scratchpad/       │
              │                  │ │ index.ts (NEW)│ │ index.ts (extend) │
              │ • session_start: │ │ • session_    │ │ • session_start:  │
              │   createVault    │ │   start: ←    │ │   (existing)      │
              │   Bundle()       │ │   createMem   │ │ • Add: pass       │
              │ • registerCmd:   │ │   Bundle()    │ │   onDataLoad ────┐│
              │   /connect,      │ │ • before_     │ │   to manager    ││
              │   /datasource,   │ │   agent_     │ │ • session_       ││
              │   /audit         │ │   start:     │ │   shutdown:      ││
              │ • session_       │ │   inject     │ │   (existing)     ││
              │   shutdown:      │ │   Layer A    │ │                  ││
              │   (vault has    │ │ • agent_     │ │                  ││
              │   no close)     │ │   start:     │ │                  ││
              └─────────────────┘ │   recordTurn │ │                  ││
                                   │ • session_   │ │                  ││
                                   │   shutdown:  │ │                  ││
                                   │   bundle.    │ │                  ││
                                   │   dispose()  │ │                  ││
                                   └──┬─────┬─────┘ └──────────────────┘│
                                      │     │                            │
                  getMemoryRecorder() │     │ createCurrentScratchpad   │
                  (module-scope `let  │     │ Provider({scratchpadsRoot}│
                  recorder` in memory │     │ — Phase 3 Task 18, already │
                  index, set on       │     │ exported from sp-command)  │
                  session_start)      │     │                            │
                                      │     └────────────────────────────┘
                                      │
                                      │ (scratchpad's onDataLoad callback
                                      │  closure calls getMemoryRecorder()
                                      │  lazily — works regardless of
                                      │  activation order)
                                      ▼
                                  Vault: independent — no cross-pillar coupling.
```

**Activation order indifference.** Otto's extension loader activates extensions in manifest order. Both memory and scratchpad export their cross-pillar helpers (`getMemoryRecorder`, `createCurrentScratchpadProvider`) immediately — before any `session_start` fires. The bundle each helper hands back is null until that extension's `session_start` runs, but `session_start` runs for ALL extensions before any user turn or cell exec. So by the time `recordTurn` or `recordFileLoad` is called, both bundles exist.

**Failure isolation.** Each activator catches around its bundle construction. If memory fails, scratchpad's `onDataLoad` calls `getMemoryRecorder()` → returns null → swallow. If scratchpad fails, memory's recorder gets a null `currentScratchpadName` provider → room defaults to `'inbox'` (per `MemoryRecorder` Phase 3 Task 8 logic). If vault fails, neither cross-pillar dependency is affected (vault is standalone).

## 5 Module responsibilities

### 5.1 `src/resources/extensions/coworker-vault/index.ts` (NEW activator)

Replaces today's scaffold-only re-export. Adds:

```typescript
export { createVaultBundle } from './vault-singleton.js';
export type { VaultBundle, VaultBundleOptions } from './vault-singleton.js';

export default function coworkerVaultExtension(api: ExtensionAPI): void {
  let bundle: VaultBundle | null = null;
  let unavailable = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createVaultBundle({
        globalDir: getCoworkerGlobalDir(),    // see §5.4
        workspaceDir: ctx.cwd,
      });
    } catch (err) {
      unavailable = true;
      ctx.ui.notify(`vault unavailable: ${(err as Error).message}`, 'warning');
      return;
    }
  });

  api.registerCommand('connect', {
    description: 'Add or edit a credential entry',
    handler: async (args, ctx) => {
      if (!bundle) { ctx.ui.notify(unavailable ? 'vault unavailable' : 'vault not ready', 'warning'); return; }
      await runConnect(bundle, args, ctx);
    },
  });
  // …same shape for /datasource and /audit, calling runDatasourceList / runDatasourceRemove
  // / runDatasourceTest and runAudit respectively (all are existing Phase 2 functions)

  api.on('session_shutdown', async () => {
    // VaultBundle has no async close in Phase 2; nothing to await.
    bundle = null;
  });
}
```

Notes:
- All command handlers gate on `bundle !== null`. If unavailable, surface a one-line notice. The user can still chat; just can't `/connect`.
- `getCoworkerGlobalDir()` is a shared helper (§5.4) — both memory and vault use it so the same `audit.jsonl` is shared at the conceptual `~/.otto/` root.
- Phase 2's `runConnect`/`runDatasourceList`/`runAudit`/`runDatasourceRemove`/`runDatasourceTest` functions already exist with handler-friendly signatures; this activator is the thin wrapper that didn't exist.

### 5.2 `src/resources/extensions/coworker-memory/index.ts` (NEW activator)

Replaces today's scaffold-only re-export. Adds:

```typescript
export { createMemoryBundle } from './memory-singleton.js';
export type { MemoryBundle, MemoryBundleOptions } from './memory-singleton.js';

// Exported for scratchpad's onDataLoad — see §5.3.
let activeRecorder: MemoryRecorder | null = null;
export function getMemoryRecorder(): MemoryRecorder | null { return activeRecorder; }

export default function coworkerMemoryExtension(api: ExtensionAPI): void {
  let bundle: MemoryBundle | null = null;
  let unavailable = false;
  let pendingPrompt: string | undefined;
  let writeFailureNotified = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createMemoryBundle({
        globalDir: getCoworkerGlobalDir(),
        workspaceDir: ctx.cwd,
        scopeMode: 'per-project-tagged',          // §3.3
        currentScratchpadName: createCurrentScratchpadProvider({
          scratchpadsRoot: getScratchpadsRoot(),  // matches scratchpad activator's derivation
        }),
      });
      activeRecorder = bundle.recorder;
    } catch (err) {
      unavailable = true;
      ctx.ui.notify(`memory unavailable: ${(err as Error).message}`, 'warning');
      return;
    }
  });

  api.on('before_agent_start', async (event) => {
    if (!bundle) return;                          // unavailable: skip injection
    pendingPrompt = event.prompt;                 // capture for agent_start
    const block = await buildLayerAContext({
      mode: bundle.scopeMode,
      globalStore: bundle.globalLayerA,
      workspaceStore: bundle.workspaceLayerA,
      tokenLimit: 3000,                           // §3.3 (hardcoded — settings later)
    });
    if (block.length === 0) return;
    return { systemPrompt: event.systemPrompt + '\n\n' + block };
  });

  api.on('agent_start', async (event, ctx) => {
    if (!bundle || !pendingPrompt || !event.sessionId || !event.turnId) {
      pendingPrompt = undefined;
      return;
    }
    const userText = pendingPrompt;
    const sessionId = event.sessionId;
    const turnId = event.turnId;
    pendingPrompt = undefined;
    try {
      await bundle.recorder.recordTurn({ sessionId, userText, turnId });
    } catch (err) {
      if (!writeFailureNotified) {
        ctx.ui.notify(`memory write failed: ${(err as Error).message}`, 'warning');
        writeFailureNotified = true;
      }
    }
  });

  api.registerTool({ name: 'memorize', /* JSON schema for {text, kind, scope?}, calls runMemorize */ });
  api.registerTool({ name: 'recall',   /* schema for {query, kind?, wing?, room?, days_back?, max_results?}, calls runRecall */ });

  api.registerCommand('memory', {
    description: '/memory note|wing|room|status|clear|seed',
    handler: async (args, ctx) => {
      if (!bundle) { ctx.ui.notify(unavailable ? 'memory unavailable' : 'memory not ready', 'warning'); return; }
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const result = await runMemoryCommand(bundle, argv);
      ctx.ui.notify(result.message, 'info');
    },
  });

  api.on('session_shutdown', async () => {
    if (bundle) await onSessionShutdown(bundle);  // Phase 3 Task 17 — closes backend
    bundle = null;
    activeRecorder = null;
  });
}
```

Notes:
- `pendingPrompt` is captured in `before_agent_start` (sync write to closure var) and consumed in `agent_start`. The two events fire in deterministic order per turn — `before_agent_start` first, then `agent_start`. No race.
- `recordTurn` failures notify only **once per session** to avoid log spam. Subsequent failures are silently swallowed (still recoverable via `/audit --producer memory`).
- The `memorize` / `recall` tool registrations wrap the existing `runMemorize` / `runRecall` Phase 3 functions; the JSON schemas are derived from those functions' parameter types.

### 5.3 `src/resources/extensions/coworker-scratchpad/index.ts` (EXTEND existing)

Two surgical changes:

1. **Constructor:** add `onDataLoad` to the `ScratchpadManager` construction in `getManager`:

   ```typescript
   manager = new ScratchpadManager({
     workspace: workspaceCwd,
     root,
     sessionId: sessionId ?? 'default',
     onDataLoad: (drawer, scratchpadName) => {
       const recorder = getMemoryRecorder();
       if (!recorder) return;                    // memory unavailable or not yet session_started
       void recorder.recordFileLoad({
         scratchpadName,
         collector: drawer.collector,
         uri: drawer.uri,
         bytes: drawer.bytes ?? 0,
         rows_loaded: drawer.rows_loaded ?? undefined,
         schema: drawer.schema ?? undefined,
         turnId: '',                             // see note below
       }).catch(() => { /* §3.8: silent swallow */ });
     },
   });
   ```

2. **Import:** at top of file:

   ```typescript
   import { getMemoryRecorder } from '../coworker-memory/index.js';
   ```

Notes:
- `turnId` is empty here because the `onDataLoad` callback fires from inside the kernel runtime, which doesn't have the in-flight `turnId` in scope. Acceptable for v1 (`metadata.turn_id = ''`). Phase 4+ can plumb turnId through if needed.
- No other change to scratchpad's activator. The existing restore logic, sweep, `session_shutdown` handler, sidecar logic stay untouched.

### 5.4 `src/resources/extensions/_coworker-paths.ts` (NEW helper)

Single source of truth for the global / workspace / scratchpads root directories. Replaces the per-activator `deriveScratchpadRoot()` duplication.

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getCoworkerGlobalDir(): string {
  return process.env.OTTO_COWORKER_GLOBAL_DIR ?? join(homedir(), '.otto');
}

export function getScratchpadsRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}
```

Why one helper: memory needs the same `~/.otto/` root that vault writes its audit log to, and the same scratchpads root that scratchpad's activator already derives. Centralizing avoids "memory's audit.jsonl is here, vault's is there" drift. Scratchpad's activator already has its own `deriveScratchpadRoot()` — Phase 3.1 refactors it to call this helper (one-line change).

### 5.5 `package.json` (test-glob hygiene)

`scripts.test:unit:compiled` today is a single line invoking `node --test` with a list of quoted glob strings. Existing extensions follow a `dist-test/src/resources/extensions/<name>/tests/*.test.js` shape (note the `/tests/` subdirectory). The coworker extensions put `*.test.ts` files at the extension root (next to the source), so the new globs are:

```
"dist-test/src/resources/extensions/coworker-memory/*.test.js"
"dist-test/src/resources/extensions/coworker-vault/*.test.js"
"dist-test/src/resources/extensions/coworker-scratchpad/*.test.js"
```

Append these three quoted globs to the existing `test:unit:compiled` invocation. Do NOT migrate the other extensions' test layout — that's out of scope.

### 5.6 Smoke checklist + human-test doc updates

- `docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md` — no `[BLOCKED]` tags today, but the steps' implicit assumption (slash commands work) is now true. Verify each step still passes; add a "Verified live on <date>" footnote when smoke runs green.
- `docs/superpowers/notes/2026-06-02-coworker-phase-2-human-tests.md` — strike-through the "Phase 2.1+ deferrals" paragraph (`/connect`, `/datasource`, `/audit` registration) and add an "Activator landed in Phase 3.1 (commit <SHA>)" note.
- `docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md` — remove the top-of-file note explaining `[BLOCKED on 3.1]`; remove each step's `[BLOCKED on 3.1]` tag (7 of 9 steps); add the "Verified live on <date>" footnote.
- `docs/superpowers/notes/2026-06-02-coworker-phase-3-human-tests.md` — same update for the same `[BLOCKED]` scenarios; add the activator-landed note.
- `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` — append a "Phase 3.1 — Production activators (complete)" note under the Phase 3 entry; explicitly call out that this also closes Phase 2's "Phase 2.1+" deferral.

## 6 Cross-pillar contract

```
┌─────────────────────────────────────────────────────────────────────┐
│ memory.index.ts exports                                             │
│   getMemoryRecorder(): MemoryRecorder | null                        │
│     — module-scope `let` assigned in session_start, cleared in      │
│       session_shutdown                                              │
│   default fn coworkerMemoryExtension(api)                           │
│                                                                     │
│ scratchpad.index.ts imports                                         │
│   { getMemoryRecorder } from '../coworker-memory/index.js'          │
│   (called lazily inside onDataLoad closure)                         │
│                                                                     │
│ memory.index.ts imports                                             │
│   { createCurrentScratchpadProvider } from                          │
│     '../coworker-scratchpad/sp-command.js'                          │
│   (Phase 3 Task 18 export — called once at session_start)           │
│                                                                     │
│ vault.index.ts has no cross-pillar imports.                         │
└─────────────────────────────────────────────────────────────────────┘
```

Both cross-imports are one-way value reads. There are no two-way callbacks, no circular dependency.

## 7 Lifecycle ordering (per Otto session)

```
1. Otto starts → loads extensions → calls each default export.
   - coworker-vault registers /connect /datasource /audit handlers + session hooks.
   - coworker-memory registers memorize/recall tools + /memory + before/agent_start
     + session hooks.
   - coworker-scratchpad registers /sp + scratchpad tool + session hooks.
   All three are now subscribed; no bundles exist yet.

2. session_start fires for all three (order set by manifest list).
   - vault: createVaultBundle()           — bundle ready.
   - memory: createMemoryBundle()         — bundle ready; activeRecorder set.
   - scratchpad: existing logic           — manager created lazily on first /sp use,
                                            with onDataLoad closure capturing
                                            getMemoryRecorder reference.

3. User types in chat → pi-coding-agent fires before_agent_start.
   - memory.on('before_agent_start'): captures event.prompt in pendingPrompt,
     returns { systemPrompt: original + '\n\n' + Layer-A-block } or undefined.

4. pi-coding-agent fires agent_start (sessionId + turnId now known).
   - memory.on('agent_start'): consumes pendingPrompt, calls
     recorder.recordTurn({sessionId, userText: pendingPrompt, turnId}).
     Failures swallowed (one notify per session).

5. Agent loop runs. If a cell loads a file via FileCollector:
   - kernel emits data_load event → ScratchpadManager runtime's onDataLoad fires.
   - scratchpad's closure calls getMemoryRecorder() → recorder.recordFileLoad(...).
     Failures silently swallowed.

6. Session ends → session_shutdown fires.
   - memory: bundle.dispose() (closes SQLite WAL checkpoint).
   - scratchpad: existing manager.disposeAll().
   - vault: nothing to close.
```

**Why pendingPrompt is safe.** `before_agent_start` and `agent_start` fire in deterministic order per turn (verified in `pi-coding-agent/src/modes/interactive/interactive-mode.ts:865`). There is no nested turn concept; one user input → one of each event in sequence. If `before_agent_start` doesn't fire (e.g., `agent_start` from an internal source), `pendingPrompt` is undefined and `agent_start` skips silently.

## 8 Error policy

| Failure | Policy | User-visible |
|---|---|---|
| `createMemoryBundle` throws on `session_start` | Catch, set `unavailable=true`, `ctx.ui.notify('memory unavailable: <msg>', 'warning')`. Skip registration. | One-time warning. Chat continues. `/memory` command shows "memory unavailable". |
| `createVaultBundle` throws on `session_start` | Same shape as memory. | Same. `/connect` etc. show "vault unavailable". |
| `recordTurn` throws on `agent_start` | Try/catch. First failure: `ctx.ui.notify('memory write failed: <msg>', 'warning')`. Subsequent: silent. | One-time warning per session. |
| `recordFileLoad` throws inside `onDataLoad` callback | Silent swallow (no notify). | Nothing in TUI; visible in `/audit --producer memory` (or absence thereof). |
| `runMemorize` / `runRecall` tool call throws | Tool returns error result per `ToolDefinition` contract — model sees the error in its tool result. | Model handles. |
| `/memory clear` without `--confirm` | Existing Phase 3 Task 16 behavior: throws. | Handler catches, `ctx.ui.notify(err.message, 'warning')`. |
| `buildLayerAContext` throws on `before_agent_start` | Catch, return undefined (no injection). Notify once. | One-time warning. Chat continues without memory context. |
| `getMemoryRecorder()` returns null inside scratchpad's `onDataLoad` | Treated as expected — silent skip. | None. (Already-tested Phase 3 Task 19 behavior.) |

## 9 Testing strategy

### 9.1 Unit (per activator)

Each activator gets a `*.test.ts` next to it covering:
- Happy path: `session_start` constructs bundle; commands/tools registered; `session_shutdown` disposes.
- Init failure: stub `createXxxBundle` to throw; assert `ctx.ui.notify` called with 'unavailable'; assert no command/tool registrations followed.
- (Memory only) `before_agent_start` → `agent_start` round-trip: drives both handlers with a stub `event` pair; asserts `pendingPrompt` captured then consumed; asserts `recorder.recordTurn` called with correct args.
- (Memory only) Layer A injection: stub workspaceLayerA with one lesson; assert `event.systemPrompt + '\n\n' + block` returned.
- (Vault only) Each command registration calls the right Phase 2 function with bundle + args.
- (Scratchpad only) `onDataLoad` callback invokes `getMemoryRecorder()` lazily; with null recorder → no-op; with recorder → calls `recordFileLoad` with translated args.

Test stubs use the existing `ExtensionAPI` test helpers in `packages/pi-coding-agent/src/test-utils/` (if present — confirm during plan-phase). Falls back to minimal hand-rolled stub.

### 9.2 Integration

One new test at `packages/coworker-memory/src/activator-integration.test.ts`:
- Construct a fake `ExtensionAPI` (in-memory event emitter, command registry, tool registry, notify capture).
- Activate all three extensions in order (vault → memory → scratchpad).
- Fire `session_start` for each.
- Fire `before_agent_start` with a prompt → assert `systemPrompt` augmented.
- Fire `agent_start` with sessionId/turnId → assert a drawer landed in the backend with the prompt text and the right wing/room.
- Trigger a `data_load` event through the scratchpad manager → assert a `kind:'file_load'` drawer.
- Call the `recall` tool → assert results include the turn + file_load drawers.
- Fire `session_shutdown` → assert backend closed cleanly; re-open and confirm WAL is consistent.

This is the goal-backward target: it must exist (or at least be sketched as a failing test) before any activator code is written.

### 9.3 Cross-cutting

- `npm run test:unit:compiled` now picks up extension tests (post-glob update).
- `npm run test:packages` still picks up package tests (unchanged behavior).
- Smoke checklists run live in the TUI after the branch is built; record the verification date in each smoke doc.

## 10 Edge cases

| Case | Handling |
|---|---|
| `before_agent_start` fires but `agent_start` never does (some control flow path) | `pendingPrompt` lives until next `before_agent_start` overwrites it. No persistence. No harm — worst case is one user turn not recorded. |
| Two `before_agent_start` events in a row before `agent_start` | Second overwrites first. The first prompt is dropped. Per `pi-coding-agent` contract this shouldn't happen, but the behavior is "the most recent prompt wins" — safe. |
| `agent_start` fires with no preceding `before_agent_start` (internal-only loop) | `pendingPrompt` is undefined → memory skips silently. Correct: that loop isn't a user turn. |
| Memory's `session_start` fires before scratchpad's session_start | OK — memory immediately constructs the `currentScratchpadName` provider closure, which reads sidecars on each call. If scratchpad hasn't set up sidecars yet, provider returns null, room defaults to `'inbox'`. |
| Scratchpad `onDataLoad` fires before memory's `session_start` | `getMemoryRecorder()` returns null → silent skip. (Won't happen in practice — `session_start` precedes any cell exec.) |
| User explicitly sets `OTTO_SCRATCHPAD_ROOT` to a non-default path | Both memory's `createCurrentScratchpadProvider` and scratchpad's manager read from `getScratchpadsRoot()` — they stay in sync. Good. |
| `~/.otto/audit.jsonl` doesn't exist on first run | `AuditLog` creates it (Phase 1.5 behavior). Vault + memory share the file. |
| User has both old (pre-Phase 3.1) and new Otto versions in parallel | Schema version handling is per-package; memory's `workspace.json._schema:1` and SQLite `PRAGMA user_version=1` both pin the format. Backward-compat is a future task. |
| Init failure on one pillar partway through `session_start` (e.g., vault's notify call itself throws) | Outer try/catch wraps everything. Worst case: extension is "registered but silent". User can still chat. |

## 11 Persistence triggers

No new persistence introduced — all writes go through existing libraries.

| Write | Triggered by | Lands at |
|---|---|---|
| `recordTurn` drawer | activator's `agent_start` handler | `<workspace>/.otto/memory/layer-b.db` |
| `recordFileLoad` drawer | scratchpad activator's `onDataLoad` callback | same |
| `/memory note` lesson | activator's `/memory` command handler | `<workspace>/.otto/memory/lessons.md` (Phase 3 default) |
| `/connect` credential | activator's `/connect` command handler | `~/.otto/data_vault/<engine>-<name>.json` (Phase 2) |
| audit records | every pillar | `~/.otto/audit.jsonl` |

## 12 Milestone

When this phase merges:
1. A live Otto session shows the `Memory (Layer A)` block in the system prompt when Layer A has content.
2. Typing a message in chat results in a `kind:turn` (short) or `kind:paste` (long) drawer in Layer B, queryable via `/audit --producer memory --action write-drawer`.
3. `/memory note "X"`, `/memory status`, `/memory clear --wing W --confirm` all work in chat.
4. `/connect jira prod`, `/datasource list`, `/audit --producer vault` all work in chat.
5. `/sp new p1` + load a CSV cell results in a `kind:file_load` drawer linked to `p1`.
6. The `memorize` and `recall` LLM tools are model-callable.
7. `npm run test:unit:compiled` exercises all three extension activator tests.
8. The two smoke checklists run end-to-end without `[BLOCKED]` tags.

## 13 Errors

No new error types. Existing taxonomy holds:
- `MemoryNotInitialized`, `BackendUnavailable`, `LayerAWriteBlocked`, etc. (Phase 3 Task 1) — surface unchanged.
- `VaultError` subclasses (Phase 2) — surface unchanged.

## 14 Out-of-scope (recap, for clarity)

- Layer C, Cerebellum, ACC, Consolidator, weekly digest — Phase 5.
- Persona-seed activator wiring — Phase 4 or later.
- scopeMode settings.json knob — Phase 4+ if asked.
- OAuth, OS keychain, additional vault engine seeds — Phase 2.5 / 6.
- `turnId` propagation into `recordFileLoad` — Phase 4+.
- Combined "coworker" mega-activator — explicitly rejected here.

---

## Appendix A — file change summary

| File | Action | LOC estimate |
|---|---|---|
| `src/resources/extensions/coworker-vault/index.ts` | Replace scaffold with activator | ~80 |
| `src/resources/extensions/coworker-vault/index.test.ts` | NEW | ~120 |
| `src/resources/extensions/coworker-memory/index.ts` | Replace scaffold with activator | ~110 |
| `src/resources/extensions/coworker-memory/index.test.ts` | Replace stub (Phase 3 Task 12 left a spot-check; replace with activator test) | ~180 |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Add `onDataLoad` closure + import | +15 |
| `src/resources/extensions/coworker-scratchpad/index.test.ts` | Add `onDataLoad` test cases | +60 |
| `src/resources/extensions/_coworker-paths.ts` | NEW shared helper | ~15 |
| `packages/coworker-memory/src/activator-integration.test.ts` | NEW | ~120 |
| `package.json` | Add 3 globs to `test:unit:compiled` | +3 |
| `docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md` | Add "verified live" footnote | +3 |
| `docs/superpowers/notes/2026-06-02-coworker-phase-2-human-tests.md` | Strike deferrals paragraph, add activator-landed note | +5 |
| `docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md` | Remove `[BLOCKED]` tags, add footnote | +/- 15 |
| `docs/superpowers/notes/2026-06-02-coworker-phase-3-human-tests.md` | Same removal | +/- 10 |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Add Phase 3.1 complete note | +5 |

Total new/modified: ~12 files, ~700 LOC delta net of doc deletions.

## Appendix B — task ordering (informs the plan)

1. **Failing integration test** — `packages/coworker-memory/src/activator-integration.test.ts` written against the not-yet-existing activator surface. Compiles + fails. This is the goal-backward target.
2. **Shared paths helper** — `src/resources/extensions/_coworker-paths.ts`. Tiny, independent.
3. **Vault activator** — first because no cross-pillar imports. Closes Phase 2.1+ deferral. Live `/connect` `/datasource` `/audit` in chat.
4. **Memory activator** — closes Phase 3 Task 20. Requires Phase 3 Task 18's `createCurrentScratchpadProvider` export (already in place from Phase 3).
5. **Scratchpad activator extension** — add `onDataLoad` closure + `getMemoryRecorder` import. Closes Phase 3 Task 19 production hop.
6. **Test-glob hygiene** — extend `package.json::test:unit:compiled`.
7. **Integration test passes** — by this point, all activators exist; the failing test from step 1 turns green.
8. **Smoke + human-test doc updates** — live-run both smoke checklists; strip `[BLOCKED]` tags; add verified-live footnotes.
9. **Roadmap update** — Phase 3.1 complete; note Phase 2 + Phase 3 deferrals both closed.
10. **Branch-level review + push readiness** — same shape as Phase 3 Task 23.

This ordering produces ~10 atomic commits, smallest-blast-radius first, with the goal-backward test landing first so subsequent steps have a verification target.
