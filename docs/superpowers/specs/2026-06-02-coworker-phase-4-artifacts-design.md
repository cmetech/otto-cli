# Phase 4 — otto-artifacts design

**Status:** Approved 2026-06-02 (brainstorming complete; spec written for plan input).
**Phase name:** Phase 4 — otto-artifacts (production package + activator + cross-pillar wiring).
**Branch:** `feat/coworker-phase-4-artifacts` (created from `main` at `2633f78`).
**Parent specs:**
- `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.3, §3.1 disk layout, §3.4 tech choices.
- `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md` (memory contract memory drawer kinds reference).
- `docs/superpowers/specs/2026-06-02-coworker-phase-3.1-activators-design.md` (activator + cross-pillar wiring pattern Phase 4 follows verbatim).

---

## 1 Goal

Graduate `@otto/coworker-artifacts` from `export {};` stub to a workspace-scoped store for typed deliverables, with a production extension activator wired into Otto's `ExtensionAPI` from day one. Every artifact gets a stable `artifact://<slug>` URI that resolves deterministically to a directory under `<workspace>/.otto/artifacts/<slug>/`. Each create + update appends to an append-only provenance log so later phases (Phase 5 Consolidator, daily digest) can walk artifact lineage.

The bar is concrete: by merge, the milestone *"Draft the RCA from yesterday's cells"* works end-to-end. A scratchpad cell calls `otto.artifact.create('report', 'RCA: load balancer 503')` + `handle.update([{path: 'report.md', content: '...'}])`; the directory lands at `<workspace>/.otto/artifacts/rca-load-balancer-503/`; the artifact surfaces in `/memory recall load balancer` as a `kind:'artifact'` drawer with the URI; `/artifacts show rca-load-balancer-503` prints the report body + provenance lineage.

## 2 Non-goals

- **Workbook (Excel xlsx) and dataset kinds.** Parent design spec §2.3 lists both; roadmap (week 7) explicitly narrows v1 to markdown-only. Workbook + dataset deferred to Phase 4.5 or later if NOC analysts request them.
- **HTML / PDF rendering.** Parent §1 already excludes; reaffirmed.
- **Cross-workspace artifact browsing.** Workspace-scoped store only; global `~/.otto/artifacts/` not in v1. v2 if asked.
- **`<workspace>/.otto/artifacts/_index.json` aggregate index.** `ArtifactStore.list()` reads `readdir` + parses each `metadata.json`. Add the index when listing gets slow (≥ hundreds of artifacts).
- **Generic URL-scheme resolver registry** on Otto's command bus. `artifact://` is a pure-function resolver exported from the package; no command-bus integration. Consumers (memory, future Phase 5, `/artifacts show`) call `resolveArtifactUri()` directly.
- **Stable UUID ids + slug rename support.** Slugs are append-only filesystem-safe strings. Collision suffixing (`-2`, `-3`) handles name conflicts. UUID ids + lookup table is YAGNI for v1.
- **Tree-style provenance with explicit `parentTurnIds`.** Append-only chronological list; the chain is the entry order.
- **Automatic post-cell render spill.** Cells must explicitly call `otto.artifact.spillIfLarge(value, opts?)`. No background renderer that auto-spills naively-large output behind cells' backs.
- **Persona templates / Handlebars artifact templates** (parent spec §2.3 mentions `artifact-templates/`). Phase 6.

## 3 Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 3.1 | **Markdown-only `report` kind in v1.** No workbook, no dataset. | Roadmap narrows scope explicitly; ExcelJS dep + xlsx writer + binary-diff test surface deferred until real demand surfaces. |
| 3.2 | **Explicit `otto.artifact.create(kind, name)` + `otto.artifact.spillIfLarge(value, opts?)` kernel bindings.** No silent post-cell auto-spill. | Predictable, easy to test, no surprise spills. Cells opt in. |
| 3.3 | **Pure file-path indirection via `resolveArtifactUri(uri, workspaceDir): ResolvedArtifactUri`.** | Simplest mechanism. No command-bus dispatch. Symmetric with Phase 3 Task 18's `createCurrentScratchpadProvider` stateless helper. |
| 3.4 | **Activator ships with the package** in Phase 4. No "Phase 4.1 activator" follow-up. | Phase 3 lesson learned: separating package and activator costs an extra phase + leaves smoke checklists `[BLOCKED]` between phases. |
| 3.5 | **Append-only TurnEntry provenance list.** Every create + update appends one entry; never edits prior entries; chronological order is the edit chain. | YAGNI for explicit `parentTurnIds`. Matches roadmap's "later edits chain" intent. |
| 3.6 | **Workspace-scoped at `<workspace>/.otto/artifacts/<slug>/`.** | Matches parent design spec §3.1 disk layout; aligns with memory's `.otto/memory/` + vault's workspace override. |
| 3.7 | **Memory `kind:'artifact'` drawer + SQLite CHECK migration `002-artifact-kind.sql` lands in this phase.** | Cell-created artifacts must be `recall`-able by the next session. Splitting it out would force a Phase 4.1 again. |
| 3.8 | **Init failures log + disable that pillar.** Inherits Phase 3.1 §3.5 policy. | Symmetric with vault/memory/scratchpad. |
| 3.9 | **`recordArtifact` failures swallowed silently** (no notify). | Same policy as `recordFileLoad` per Phase 3.1 §3.8 — frequent enough that notify spam is worse than silent drop; surfaces in `/audit`. |
| 3.10 | **`spillIfLarge` default threshold 10 KB.** Tunable via `opts.thresholdBytes`. | Round number, slightly above typical-paragraph length, fits in most terminal viewports. |
| 3.11 | **Activator lands `/memory recall` second-level autocomplete + artifact URI rendering** as a tiny follow-up inside Phase 4 since the new drawer kind needs surface. | Closes Phase 3.1 issue #73's parallel gap for the new kind. |

## 4 Architecture

```
                    Otto runtime (pi-coding-agent)
   ┌────────────────────────────────────────────────────────────────────┐
   │  ExtensionAPI: on/off, registerCommand, registerTool               │
   └─────┬────────┬────────────┬─────────────────────────┬──────────────┘
         │        │            │                         │
   ┌─────▼─┐ ┌────▼──┐ ┌──────▼──────────────┐  ┌──────▼───────────┐
   │vault  │ │memory │ │coworker-artifacts/  │  │coworker-         │
   │       │ │       │ │index.ts (NEW)       │  │scratchpad/       │
   │       │ │exports│ │                     │  │index.ts (extend) │
   │       │ │getMem │ │ • session_start:    │  │                  │
   │       │ │Record │ │   createArtifacts   │  │ • adds           │
   │       │ │er()   │ │   Bundle()          │  │   getArtifact    │
   │       │ │       │ │ • exports           │  │   Store cross-   │
   │       │ │       │ │   getArtifactStore()│  │   import         │
   │       │ │       │ │ • registerCommand   │  │ • adds onArti-   │
   │       │ │       │ │   /artifacts        │  │   factCreate     │
   │       │ │       │ │ • registerTool      │  │   closure        │
   │       │ │       │ │   list_artifacts    │  │ • passes         │
   │       │ │       │ │   open_artifact     │  │   getArtifact    │
   │       │ │       │ │ • session_shutdown  │  │   Store +        │
   │       │ │       │ └──┬──────────────────┘  │   onArtifact     │
   │       │ │       │    │                     │   Create to mgr  │
   └───────┘ └───────┘    │                     └──────────────────┘
                          │
                          ▼
            ┌──────────────────────────────────┐
            │ @otto/coworker-artifacts (NEW)   │
            │                                  │
            │ • types/errors                   │
            │ • slug derivation + collision    │
            │ • DirSnapshot (mtime+size diff)  │
            │ • ArtifactStore (the class)      │
            │ • resolveArtifactUri()           │
            │ • renderReadme() pure fn         │
            └───────────┬──────────────────────┘
                        │
                        ▼
        <workspace>/.otto/artifacts/<slug>/
          report.md          ← primary file (markdown)
          metadata.json      ← stable metadata, atomic writes
          provenance.json    ← append-only TurnEntry[]
          README.md          ← deterministic re-render

   Cross-pillar wiring (one-way):
     scratchpad kernel  → otto.artifact.create / spillIfLarge
       ↳ artifact_create event over NDJSON
         ↳ ScratchpadManager.onArtifactCreate(drawer, scratchpadName)
           ↳ scratchpad activator closure → getMemoryRecorder()
             ↳ recorder.recordArtifact({slug, kind, uri, ...})
               ↳ kind:'artifact' drawer in Layer B (SQLite)
                 ↳ /memory recall finds it
```

**Activation order indifference:** All three coworker bundles construct stateless or workspace-scoped state inside their `session_start` handlers. The scratchpad activator's `onArtifactCreate` closure calls `getArtifactStore()` and `getMemoryRecorder()` *lazily* on each event, so the activator load order doesn't matter — by the time a cell runs, all `session_start`s have fired.

**Failure isolation:** Each activator catches around its bundle construction (Phase 3.1 §3.5 policy). If artifacts fails, scratchpad's cell-bound `otto.artifact.create` returns an `ArtifactsUnavailable`-shaped error; the cell surfaces it but the kernel doesn't crash. Memory + vault keep working.

## 5 Module responsibilities

### 5.1 Package `@otto/coworker-artifacts`

| Module | Surface |
|---|---|
| `types.ts` | `ArtifactKind = 'report'`; `ArtifactHandle = {slug, kind, name, dir, uri, primaryPath, metadataPath, provenancePath}`; `ArtifactMetadata = {_schema:1, slug, kind, name, created_at, last_updated_at, turn_count, primary_file, uri}`; `TurnEntry = {_schema:1, ts, action: 'create'|'update', turn_id, agent_turn_id?, user_prompt, scratchpad_name?, files_touched: string[]}`; `Provenance = TurnEntry[]`; `DirSnapshot = Map<string, {mtimeNs, sizeBytes}>`; `FileWrite = {path: string, content: string}`; `ResolvedArtifactUri = {slug, dir, primaryPath, metadataPath, provenancePath, readmePath}`. |
| `errors.ts` | `ArtifactNotFound(slug)`, `ArtifactKindRejected(kind)`, `ArtifactUriMalformed(uri, reason)`, `ArtifactSlugCollision(base, attempts)`. Pattern matches Phase 3 errors taxonomy. |
| `slug.ts` | `deriveSlug(name: string): string` — kebab-case, lowercase, ASCII-only, max 64 chars, regex `[a-z0-9][a-z0-9-]*[a-z0-9]\|[a-z0-9]`. `nextCollisionSlug(base: string, taken: Set<string>): string` — `-2`, `-3`, up to `-100` then throws `ArtifactSlugCollision`. Pure functions, no I/O. |
| `dir-snapshot.ts` | `takeSnapshot(dir: string): DirSnapshot` — sync fs walk; nanosecond mtime via `stat`, byte size. `diffSnapshots(before, after): {added: string[], modified: string[], removed: string[]}`. Used to compute `files_touched` for update entries. |
| `readme-renderer.ts` | `renderReadme(metadata: ArtifactMetadata, provenance: Provenance, fileStats: {path: string, sizeBytes: number}[]): string` — deterministic markdown. Pure fn; same inputs → byte-identical output. |
| `artifact-store.ts` | Class `ArtifactStore`. Constructor: `{workspaceDir: string, now?: () => string}`. Methods: `create(kind, name): Promise<ArtifactHandle>`; `update(handle, files: FileWrite[]): Promise<{files_touched: string[]}>`; `recordTurn(handle, entry: Omit<TurnEntry, '_schema'\|'ts'\|'files_touched'> & {files_touched?: string[]}): Promise<void>`; `list(): Promise<ArtifactHandle[]>`; `get(slug): Promise<ArtifactHandle \| null>`; `remove(slug, confirm: true): Promise<void>`. Atomic writes (`tmp + rename`); 0o700 dir / 0o600 files. README re-renders on every metadata-bumping call. |
| `resolve-uri.ts` | `resolveArtifactUri(uri: string, workspaceDir: string): ResolvedArtifactUri`. Validates `^artifact://([a-z0-9][a-z0-9-]*[a-z0-9]\|[a-z0-9])$` and rejects `..`, leading/trailing dashes, length > 64. |
| `index.ts` | Barrel. |
| `*.test.ts` + `tests/artifacts-integration.test.ts` (or `src/artifacts-integration.test.ts` per Phase 3 Task 21 convention) | Unit + cross-package integration. |

### 5.2 Extension `src/resources/extensions/coworker-artifacts/`

| Module | Surface |
|---|---|
| `extension-manifest.json` | `{id:'coworker-artifacts', tier:'bundled', provides:{commands:['artifacts'], tools:['list_artifacts','open_artifact'], hooks:['session_start','session_shutdown']}}`. |
| `artifacts-singleton.ts` | `createArtifactsBundle({workspaceDir}): Promise<ArtifactsBundle>` returns `{store, workspaceDir, dispose}`. `dispose()` is a no-op in v1 but kept for symmetry. |
| `index.ts` | Default-export `coworkerArtifactsExtension(api: ExtensionAPI): void`. `session_start`: try/catch around `createArtifactsBundle`; on success set module-scope `activeStore = bundle.store`; on failure notify + `unavailable=true`. Exports `getArtifactStore(): ArtifactStore \| null`. Registers `list_artifacts` + `open_artifact` tools (TypeBox schemas; bundle-gated like memory). Registers `/artifacts` command with `getArgumentCompletions` for subcommands (`list`, `show`, `remove`). `session_shutdown`: dispose, clear activeStore. |
| `list-tool.ts` | `runListArtifacts(store): Promise<{markdown: string; artifacts: Array<{slug, kind, name, created_at, last_updated_at, turn_count, uri}>}>`. Reads `store.list()`; formats markdown table. |
| `open-tool.ts` | `runOpenArtifact(store, {slug}): Promise<{markdown: string}>`. Reads primary file + last 5 provenance entries; renders markdown showing content + lineage tail. |
| `artifacts-command.ts` | `runArtifactsCommand(store, argv): Promise<{message: string}>`. Subcommands: `list` (table), `show <slug>` (cat primary + provenance tail), `remove <slug> --confirm` (recursive delete with audit). Mirrors `runMemoryCommand` shape from Phase 3 Task 16. |
| `*.test.ts` | Per module + integration in package. |

### 5.3 Cross-pillar additions

| File | Change |
|---|---|
| `packages/coworker-scratchpad/src/kernel-protocol.ts` | Add `ArtifactCreateRequest` (kernel → manager), `ArtifactCreateResponse` (manager → kernel), `ArtifactUpdateRequest` / `ArtifactUpdateResponse`, `ArtifactCreateEvent` (kernel → manager event broadcast after success). New types + serialization. |
| `packages/coworker-scratchpad/src/kernel-entry.ts` | Add `otto.artifact.create(kind, name): Promise<ArtifactHandleProxy>` and `otto.artifact.spillIfLarge(value, opts?): Promise<ArtifactHandleProxy \| null>`. `create` sends `ArtifactCreateRequest` over stdout; awaits response; returns proxy. `spillIfLarge` serializes value (default JSON.stringify or stringify-able fallback); if bytes > threshold, calls `create + update` internally. |
| `packages/coworker-scratchpad/src/child-process-runtime.ts` | Add `onArtifactCreate?: (event: ArtifactCreateEvent) => void` option. Handle incoming `ArtifactCreateRequest` / `ArtifactUpdateRequest` from kernel by calling injected `artifactStoreCallable` callbacks. |
| `packages/coworker-scratchpad/src/scratchpad-manager.ts` | Add `getArtifactStore?: () => ArtifactStore \| null` and `onArtifactCreate?: (drawer: ArtifactCreateDrawer, scratchpadName: string) => void` to `ScratchpadManagerOptions`. Inside `spawnRuntime`: convert manager-level `onArtifactCreate` to runtime-level fan-out (closure-bound to scratchpad name, mirroring Phase 3 Task 19's onDataLoad pattern). Construct artifact-RPC handlers that read `getArtifactStore()` lazily and route to it. |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Inside `getManager`: add `getArtifactStore: getArtifactStore` import + `onArtifactCreate: (drawer, name) => { const rec = getMemoryRecorder(); if (rec) void rec.recordArtifact({...}).catch(() => {}); }`. New cross-import: `import { getArtifactStore } from '../coworker-artifacts/index.js'`. |
| `packages/coworker-memory/src/memory-recorder.ts` | Add `recordArtifact({scratchpadName, slug, kind, uri, turnId, room?}): Promise<Drawer>` method. Writes `kind:'artifact'` drawer with content = `JSON.stringify({slug, kind, uri})`; room = scratchpadName; metadata `{turn_id, scratchpad}`. Mirrors `recordFileLoad`. |
| `packages/coworker-memory/src/types.ts` | Add `'artifact'` to `DRAWER_KINDS` literal union. |
| `packages/coworker-memory/src/migrations/002-artifact-kind.sql` | Drop + recreate `drawers` CHECK constraint to include `'artifact'`. SQLite can't ALTER constraints; the migration is a table-rebuild (CREATE TABLE drawers_new, INSERT FROM drawers, DROP drawers, RENAME). Trigger + FTS table preserved. |
| `packages/coworker-memory/src/local-sqlite-backend.ts` | Open path: run migration 001 if user_version=0, run migration 002 if user_version=1, set user_version=2. Existing test fixtures recreated from scratch — no migration path testing needed for v1 since v1 was never released. |
| `src/resources/extensions/coworker-memory/recall-tool.ts` (small touch) | When `recall` returns a `kind:'artifact'` drawer, the markdown rendering already shows snippet — no change needed; the URI is in the content. The `/memory recall` slash command also surfaces it cleanly. **No code change**; this row exists only to confirm the integration works. |

## 6 On-disk layout

```
<workspace>/.otto/artifacts/<slug>/
  report.md         ← primary file (UTF-8 markdown)
  metadata.json     ← single source of truth
  provenance.json   ← append-only TurnEntry[]
  README.md         ← deterministic re-render
```

Modes: dir `0o700`; files `0o600` (matches memory + vault).

### 6.1 `metadata.json`

```json
{
  "_schema": 1,
  "slug": "rca-load-balancer-503",
  "kind": "report",
  "name": "RCA: load balancer 503",
  "created_at": "2026-06-02T14:32:00Z",
  "last_updated_at": "2026-06-02T15:18:00Z",
  "turn_count": 3,
  "primary_file": "report.md",
  "uri": "artifact://rca-load-balancer-503"
}
```

Atomic write (`tmp + rename`). `turn_count` = `provenance.length` (denormalized for cheap `list` rendering).

### 6.2 `provenance.json`

```json
[
  {
    "_schema": 1,
    "ts": "2026-06-02T14:32:00Z",
    "action": "create",
    "turn_id": "turn-abc",
    "agent_turn_id": "agent-xyz",
    "user_prompt": "draft the RCA from yesterday's cells",
    "scratchpad_name": "p1-incident",
    "files_touched": ["report.md"]
  }
]
```

`files_touched` derived from `DirSnapshot` diff between before/after the operation. Atomic write per append (full file rewrite — bounded by turn_count; no streaming append).

### 6.3 `README.md`

Deterministic re-render via `renderReadme(metadata, provenance, fileStats)`. Format:

```markdown
# <name>

**Kind:** <kind>
**URI:** `artifact://<slug>`
**Created:** <created_at> (turn `<first turn_id>`)
**Last updated:** <last_updated_at> (turn `<last turn_id>`)
**Turns:** <turn_count>

## Files

- `<path>` — <human-size>

## Provenance

| # | ts | action | turn | prompt |
|---|---|---|---|---|
| 1 | … | create | … | … |
```

Idempotent: same inputs → byte-identical output. Re-rendered on every `create`, `update`, `recordTurn`.

### 6.4 URI shape

`artifact://<slug>` where `<slug>` matches `^[a-z0-9][a-z0-9-]*[a-z0-9]$\|^[a-z0-9]$`. `resolveArtifactUri` validates the regex AND rejects path-traversal (`..`), length > 64. Examples:

- `artifact://rca-load-balancer-503` ✅
- `artifact://x` ✅
- `artifact://Datadog Notes` ❌
- `artifact://../escape` ❌

## 7 Lifecycle (per Otto session)

```
1. Extension load (manifest order): vault, memory, artifacts, scratchpad.
   Each registers commands/tools. No bundles yet.

2. session_start: each calls its own create*Bundle. activeRecorder + activeStore set.

3. Agent runs cell:
   cell calls otto.artifact.create('report', 'RCA: load balancer 503')
   → kernel sends ArtifactCreateRequest over stdout (NDJSON)
   → manager's RPC handler calls getArtifactStore()?.create('report', '...')
   → store derives slug, writes metadata + empty primary + initial provenance + README
   → manager replies ArtifactCreateResponse {slug, uri, primaryPath, ...} over stdin
   → kernel resolves cell's promise with ArtifactHandleProxy
   → manager also broadcasts ArtifactCreateEvent → ScratchpadManager.onArtifactCreate fires
   → scratchpad activator closure:
       getMemoryRecorder()?.recordArtifact({slug, kind, uri, scratchpadName, turnId:''}).catch(()=>{})
   → kind:'artifact' drawer lands in Layer B with content JSON.stringify({slug, kind, uri})

   cell calls handle.update([{path:'report.md', content:'...'}])
   → kernel sends ArtifactUpdateRequest
   → manager → store.update(handle, files):
       takeSnapshot(dir) BEFORE
       write each FileWrite atomically
       takeSnapshot(dir) AFTER
       diffSnapshots → files_touched
       atomic bump metadata (last_updated_at, turn_count++)
       re-render README
       (provenance NOT auto-appended by update — caller calls recordTurn separately,
        but a no-arg update typically pairs with a recordTurn — see §8 for the
        agreed call sequence)
   → manager replies ArtifactUpdateResponse {files_touched}
   → kernel resolves

4. /artifacts list
   → activator handler → store.list() → format markdown table → ctx.ui.notify

5. /memory recall load balancer
   → memory's runRecall → finds kind:'artifact' drawer
   → snippet shows {slug, kind, uri}; drawer:// citation present

6. /artifacts show rca-load-balancer-503
   → activator handler → store.get('rca-load-balancer-503') → read primary + tail provenance
   → render markdown to ctx.ui.notify

7. session_shutdown: each bundle disposes; activeStore + activeRecorder cleared.
```

**Why `update` doesn't auto-call `recordTurn`:** the cell may update the file without it being a meaningful "turn" (e.g., a programmatic batch write inside one prompt). The kernel binding's `handle.update(files)` calls `recordTurn` automatically with a synthesized entry, but the package-level `ArtifactStore.update` does not. This separation lets internal-test code update without polluting provenance.

## 8 Call sequence — kernel binding semantics

```typescript
// cell code:
const a = await otto.artifact.create('report', 'RCA: load balancer 503');
//   → kernel: ArtifactCreateRequest
//   → manager: store.create(...) + recordTurn({action:'create', user_prompt, ...})
//   → kernel: ArtifactCreateResponse, returns handle proxy

await a.update([{path: 'report.md', content: '# RCA\n\n…'}]);
//   → kernel: ArtifactUpdateRequest
//   → manager: store.update(handle, files) + recordTurn({action:'update', user_prompt, ...})
//   → kernel: ArtifactUpdateResponse, returns {files_touched}

// later (same cell or another):
const b = await otto.artifact.spillIfLarge(largeJson, {thresholdBytes: 4096});
//   if largeJson serialized exceeds threshold:
//     internally: otto.artifact.create('report', autogenName) + update + recordTurn
//     returns handle proxy
//   else:
//     returns null (cell can still return the value normally)
```

The `user_prompt` field on auto-`recordTurn` calls is filled from the activator's `pendingPrompt` capture (the same one memory uses in `before_agent_start`). If `pendingPrompt` is unset, the entry records `user_prompt: ''` and `turn_id: ''` (graceful degradation, mirrors Phase 3.1 §3.6).

## 9 Error policy

| Failure | Policy | Surface |
|---|---|---|
| `createArtifactsBundle` throws on `session_start` | Catch, `unavailable=true`, `ctx.ui.notify('artifacts unavailable: <msg>', 'warning')`, skip registration | One-time warning |
| Cell calls `otto.artifact.create` when store is null | Kernel returns rejection; cell sees `ArtifactsUnavailable: artifacts pillar not active` | Cell error in TUI; chat continues |
| `store.create` collision after 100 retries | Throws `ArtifactSlugCollision(base, attempts)`; kernel propagates to cell | Cell error |
| `store.update` writes a file but metadata bump fails partway | Atomic write of `tmp + rename` for each file ensures partial state never visible. metadata.json bump uses same. README re-render last; if it fails, file content + metadata are persisted, README is stale (acceptable; deterministic re-render means next save fixes it) | Cell sees error message; user can `/artifacts show` to see actual content |
| `resolveArtifactUri` rejects | Throws `ArtifactUriMalformed(uri, reason)` | Caller handles |
| `recordArtifact` throws in `onArtifactCreate` callback | Silent swallow (per Phase 3.1 §3.8 policy) | None |
| `list_artifacts` / `open_artifact` LLM tools when store is null | Return `{content:[{type:'text', text:'artifacts unavailable'}], details:{error:'unavailable'}}` (matches Phase 3.1 hotfix shape) | Model sees the error |
| `/artifacts <subcommand>` when store is null | `ctx.ui.notify('artifacts unavailable.', 'warning')` | User-visible warning |

## 10 Edge cases

| Case | Handling |
|---|---|
| Slug collision on `create('report', 'RCA')` (already exists) | `nextCollisionSlug('rca', existing)` → `rca-2`, `rca-3`, … up to `rca-100`; then `ArtifactSlugCollision`. |
| User runs `/artifacts remove <slug>` without `--confirm` | Throws usage error; no deletion. |
| User runs `/artifacts show <missing>` | Returns `ArtifactNotFound(slug)`; handler notifies `(no artifact: <slug>)`. |
| `provenance.json` malformed on read | Treat as empty provenance; next write replaces. Audit log records the recovery. |
| `metadata.json` missing but directory exists (manual mkdir) | Treat as `ArtifactNotFound`; surface as a warning in `list()`. |
| Two cells in different scratchpads create artifacts with same `name` | Slug collision suffixing handles it transparently. Concurrent `mkdir` race: rely on `mkdir({recursive: false})` failing the second writer; retry with next suffix. |
| Workspace switch mid-session (Otto doesn't currently support this) | Out of scope. |
| `spillIfLarge` with non-serializable value | Falls back to `String(value)`; if that exceeds threshold, still spills. |
| `recordTurn` called before `create` (impossible via kernel binding; possible via direct package API) | Throws `ArtifactNotFound`. |
| Memory recall returns `kind:'artifact'` drawer; user wants content | `/artifacts show <slug>` — Phase 4 requires the user to follow the URI manually. v2 could auto-resolve `drawer://...` in recall output to artifact content. |
| Disk full during update | `writeFileSync` throws; partial writes prevented by `tmp + rename`. Error propagates to cell. |

## 11 Persistence triggers

| Write | Triggered by | Lands at |
|---|---|---|
| Initial artifact creation | cell `otto.artifact.create()` | `<slug>/{report.md, metadata.json, provenance.json, README.md}` |
| File update | cell `handle.update(files)` | `<slug>/{file paths}` + metadata bump + README re-render |
| Provenance append | kernel binding auto-call to `recordTurn` per `create`/`update` | `<slug>/provenance.json` |
| Audit | every create/update/remove/recordTurn | `~/.otto/audit.jsonl` (`producer:'artifacts'`) — same shared file as memory + vault |
| Memory drawer | scratchpad activator's `onArtifactCreate` closure | `<workspace>/.otto/memory/layer-b.db` (`kind:'artifact'`) |

## 12 Milestone

When this phase merges:

1. **Cell creates artifact end-to-end**: `await otto.artifact.create('report', 'RCA: load balancer 503')` returns a handle proxy; `await handle.update([{path:'report.md', content:'…'}])` writes the file; directory + metadata + provenance + README all present and well-formed.
2. **URI resolution works**: `resolveArtifactUri('artifact://rca-load-balancer-503', cwd)` returns canonical paths.
3. **`/artifacts list`** in the TUI shows the artifact in a markdown table.
4. **`/artifacts show rca-load-balancer-503`** prints the report body and the provenance tail.
5. **`list_artifacts` and `open_artifact` LLM tools** are model-callable.
6. **`/memory recall load balancer`** returns a `kind:'artifact'` drawer with the URI.
7. **`spillIfLarge` honors threshold**: 11KB string → spills + returns handle; 1KB string → returns null.
8. **Init failure** of artifacts pillar leaves memory + vault + scratchpad operational.
9. **Smoke checklist** runs end-to-end in TUI (per Phase 3.1 PENDING-placeholder convention, the user fills in the verified-live line).

## 13 Errors

| Type | Carries |
|---|---|
| `ArtifactNotFound` | `slug` |
| `ArtifactKindRejected` | `kind` |
| `ArtifactUriMalformed` | `uri`, `reason` |
| `ArtifactSlugCollision` | `base`, `attempts` |

Pattern matches Phase 3 Task 1 + Phase 2 vault error taxonomies.

## 14 Out-of-scope (recap)

- Workbook (xlsx), dataset (parquet/duckdb) artifact kinds — Phase 4.5 or later.
- HTML / PDF rendering — Phase 6+.
- `<workspace>/.otto/artifacts/_index.json` aggregate index — add when listing slows.
- Generic command-bus URL-scheme registry — not Phase 4.
- UUID ids + slug rename — YAGNI.
- Automatic post-cell spill — cells must opt in via `spillIfLarge`.
- Tree-style provenance with explicit `parentTurnIds`.
- Cross-workspace artifact browsing.
- Persona Handlebars artifact templates (parent §2.3 mentions; Phase 6).

## 15 Testing strategy

### 15.1 Unit (per package module)

- `slug.test.ts`: derivation + collision suffix exhaustion.
- `dir-snapshot.test.ts`: snapshot before/after; added/modified/removed diff.
- `resolve-uri.test.ts`: happy path + path-traversal rejection + length + bad chars.
- `readme-renderer.test.ts`: deterministic output (same inputs → identical bytes); covers create-only and create+updates rendering.
- `errors.test.ts`: each error carries its field.
- `artifact-store.test.ts`: create + update + recordTurn + list + get + remove. Atomic write verified by interrupting and confirming no partial state. Slug collision retry. Concurrent `create` calls (sequential — Phase 4 store doesn't guarantee concurrent safety).
- `index.test.ts` (barrel) + `*-tool.test.ts` (extension) following Phase 3 patterns.

### 15.2 Cross-package integration

`packages/coworker-artifacts/src/artifacts-integration.test.ts` (in `src/`, not `tests/`, per Phase 3 Task 21 convention):
- Activator session_start; cell-simulated `store.create` + `store.update`; `/artifacts list` returns the artifact; `/memory recall <query>` returns the kind:'artifact' drawer; `session_shutdown` clean.

### 15.3 Cross-cutting

`npm run test:unit:compiled` glob extended (one new line: `dist-test/src/resources/extensions/coworker-artifacts/*.test.js`). Same hygiene policy as Phase 3.1 Task 6.

### 15.4 Live TUI

Smoke checklist `docs/superpowers/notes/2026-06-02-phase-4-artifacts-smoke.md` (new) with PENDING placeholder for the human walkthrough. Steps:

1. Fresh workspace; `/artifacts list` reports empty.
2. `/sp new test`, attach, run cell:
   ```js
   const a = await otto.artifact.create('report', 'test');
   await a.update([{path: 'report.md', content: '# hello\n'}]);
   return a.uri;
   ```
3. Confirm cell returns `artifact://test`.
4. `/artifacts list` shows the artifact.
5. `/artifacts show test` prints `# hello`.
6. `cat <workspace>/.otto/artifacts/test/{metadata.json, provenance.json, README.md}`.
7. `/memory recall hello` finds the kind:'artifact' drawer.
8. Restart Otto; `/artifacts list` still shows the artifact (persistence).
9. `spillIfLarge` test: cell with 11KB string → spills; cell with 1KB → returns null.

## 16 Migration story

This is the **first time** `coworker-memory` ships a SQL migration beyond the initial schema. The pattern:

```typescript
// LocalSqliteBackend.open()
const userVersion = db.pragma('user_version', {simple: true}) as number;
const migrationsDir = path.join(__dirname, 'migrations');
const migrations = [
  {version: 1, file: '001-init.sql'},
  {version: 2, file: '002-artifact-kind.sql'},
];
for (const m of migrations) {
  if (userVersion < m.version) {
    db.exec(readFileSync(path.join(migrationsDir, m.file), 'utf8'));
    // each migration file ends with `PRAGMA user_version = N;`
  }
}
```

Migration 002 (table-rebuild for new CHECK constraint):

```sql
-- packages/coworker-memory/src/migrations/002-artifact-kind.sql
BEGIN TRANSACTION;
CREATE TABLE drawers_new (
  id TEXT PRIMARY KEY,
  wing TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('turn','paste','file_load','ticket','email','rca','note','artifact')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT REFERENCES drawers_new(id) ON DELETE SET NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT INTO drawers_new SELECT * FROM drawers;
DROP TABLE drawers;
ALTER TABLE drawers_new RENAME TO drawers;
-- triggers + FTS table rebuilt:
DROP TRIGGER IF EXISTS drawers_ai;
DROP TRIGGER IF EXISTS drawers_ad;
DROP TRIGGER IF EXISTS drawers_au;
-- (recreate triggers + indexes from 001-init.sql)
PRAGMA user_version = 2;
COMMIT;
```

Existing v1-only databases auto-migrate on next `open()`. No user action required.

## 17 Roadmap update

Phase 4 entry in `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` flips to COMPLETE; note Phase 5 unblocked (depends on Phase 3 + Phase 4 per roadmap). Phase 5's scope (Layer C, ACC, Cerebellum, Consolidator, daily digest) all reference artifacts now; Phase 4 closing them is the gating event.

## Appendix A — file change summary

| Path | Action | LOC estimate |
|---|---|---|
| `packages/coworker-artifacts/package.json` | Modify (add deps: `@otto/coworker-utils`, `uuid` if used for slug fallback; otherwise none new) | +5 |
| `packages/coworker-artifacts/src/types.ts` | NEW | ~80 |
| `packages/coworker-artifacts/src/errors.ts` | NEW | ~50 |
| `packages/coworker-artifacts/src/errors.test.ts` | NEW | ~50 |
| `packages/coworker-artifacts/src/slug.ts` | NEW | ~50 |
| `packages/coworker-artifacts/src/slug.test.ts` | NEW | ~70 |
| `packages/coworker-artifacts/src/dir-snapshot.ts` | NEW | ~70 |
| `packages/coworker-artifacts/src/dir-snapshot.test.ts` | NEW | ~80 |
| `packages/coworker-artifacts/src/resolve-uri.ts` | NEW | ~50 |
| `packages/coworker-artifacts/src/resolve-uri.test.ts` | NEW | ~60 |
| `packages/coworker-artifacts/src/readme-renderer.ts` | NEW | ~80 |
| `packages/coworker-artifacts/src/readme-renderer.test.ts` | NEW | ~70 |
| `packages/coworker-artifacts/src/artifact-store.ts` | NEW | ~250 |
| `packages/coworker-artifacts/src/artifact-store.test.ts` | NEW | ~200 |
| `packages/coworker-artifacts/src/artifacts-integration.test.ts` | NEW (cross-package end-to-end) | ~150 |
| `packages/coworker-artifacts/src/index.ts` | NEW (barrel) | ~15 |
| `packages/coworker-artifacts/src/index.test.ts` | NEW (spot-check) | ~30 |
| `packages/coworker-memory/src/types.ts` | Modify (add `'artifact'` to DRAWER_KINDS) | +1 |
| `packages/coworker-memory/src/migrations/002-artifact-kind.sql` | NEW | ~40 |
| `packages/coworker-memory/src/local-sqlite-backend.ts` | Modify (migration loop) | +20 |
| `packages/coworker-memory/src/local-sqlite-backend.test.ts` | Modify (add migration test) | +30 |
| `packages/coworker-memory/src/memory-recorder.ts` | Modify (add `recordArtifact`) | +30 |
| `packages/coworker-memory/src/memory-recorder.test.ts` | Modify (test recordArtifact) | +40 |
| `packages/coworker-scratchpad/src/kernel-protocol.ts` | Modify (ArtifactCreate{Request,Response,Event}, ArtifactUpdate{Request,Response}) | +60 |
| `packages/coworker-scratchpad/src/kernel-entry.ts` | Modify (`otto.artifact` binding) | +120 |
| `packages/coworker-scratchpad/src/child-process-runtime.ts` | Modify (handle artifact RPC + onArtifactCreate option) | +60 |
| `packages/coworker-scratchpad/src/scratchpad-manager.ts` | Modify (getArtifactStore + onArtifactCreate options + spawn-time fan-out) | +50 |
| `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` | Modify (test onArtifactCreate fan-out) | +60 |
| `src/resources/extensions/coworker-artifacts/extension-manifest.json` | NEW | ~15 |
| `src/resources/extensions/coworker-artifacts/artifacts-singleton.ts` | NEW | ~50 |
| `src/resources/extensions/coworker-artifacts/artifacts-singleton.test.ts` | NEW | ~50 |
| `src/resources/extensions/coworker-artifacts/index.ts` | NEW (activator) | ~150 |
| `src/resources/extensions/coworker-artifacts/index.test.ts` | NEW | ~150 |
| `src/resources/extensions/coworker-artifacts/list-tool.ts` | NEW | ~50 |
| `src/resources/extensions/coworker-artifacts/list-tool.test.ts` | NEW | ~50 |
| `src/resources/extensions/coworker-artifacts/open-tool.ts` | NEW | ~50 |
| `src/resources/extensions/coworker-artifacts/open-tool.test.ts` | NEW | ~50 |
| `src/resources/extensions/coworker-artifacts/artifacts-command.ts` | NEW | ~80 |
| `src/resources/extensions/coworker-artifacts/artifacts-command.test.ts` | NEW | ~100 |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Modify (artifact cross-import + onArtifactCreate closure) | +30 |
| `src/resources/extensions/coworker-scratchpad/index.test.ts` | Modify (closure shape tests) | +60 |
| `package.json` | Modify (add coworker-artifacts test glob to test:unit:compiled) | +1 |
| `docs/superpowers/notes/2026-06-02-phase-4-artifacts-smoke.md` | NEW | ~80 |
| `docs/superpowers/notes/2026-06-02-coworker-phase-4-human-tests.md` | NEW | ~300 |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Modify (Phase 4 COMPLETE entry) | +20 |

Total new/modified: ~45 files, ~2,800 LOC delta net.

## Appendix B — task ordering (informs the plan)

Phase 3 + 3.1 confirmed the bottom-up pattern works. Same shape:

1. Package types + errors + deps.
2. `slug.ts` (pure fn + test).
3. `dir-snapshot.ts` (pure fn + test).
4. `resolve-uri.ts` (pure fn + test).
5. `readme-renderer.ts` (pure fn + test).
6. `ArtifactStore` class with full TDD (atomic writes, slug collision, README re-render).
7. Public barrel.
8. Memory migration 002 + recordArtifact method + types update.
9. Scratchpad kernel-protocol + kernel-entry `otto.artifact` binding.
10. Scratchpad child-process-runtime + manager `onArtifactCreate` + `getArtifactStore` options.
11. Extension scaffold + activator + tools + slash command.
12. Scratchpad extension cross-import + closure wiring.
13. Cross-package integration test.
14. Test-glob hygiene.
15. Smoke checklist + human-test plan.
16. Roadmap update + branch-level review.

~16 atomic commits, smallest-blast-radius first. Final integration test (step 13) is the goal-backward verification target. Live TUI smoke walk (step 15) is the user's manual gate.

---

## Self-review

**Placeholder scan:** No `TBD`, `TODO`, `???`, or incomplete sections. Every locked decision has a rationale. Every module has a defined surface.

**Internal consistency check:**
- `ArtifactKind` is `'report'` only — consistent across §1, §3.1, §5.1 types, §13 errors.
- `DRAWER_KINDS` addition (`'artifact'`) reflected in §3.7 + §5.3 migration + §10 edge cases.
- `onArtifactCreate` closure pattern in §4, §5.3, §7, §15.2 all match.
- `spillIfLarge` threshold default 10 KB in §3.10; example in §15.4 step 9 uses 11 KB / 1 KB which straddles correctly.
- Append-only provenance §3.5 + §6.2 + §10 (no edits) — consistent.
- Error policy §9 inherits Phase 3.1 §3.5/3.8 patterns explicitly.

**Scope check:** One phase. Markdown-only kind. No xlsx/HTML/PDF. ~45 files, ~2.8K LOC — comparable to Phase 3 (50 files, ~3K) and Phase 3.1 (12 files, ~700). Single implementation plan.

**Ambiguity check:**
- "files_touched derived from DirSnapshot diff" — explicit in §6.2 + §7 + §11; not ambiguous.
- "spillIfLarge returns handle proxy or null" — explicit in §8.
- "update doesn't auto-call recordTurn" at package level, but kernel binding does — clarified in §7 footnote.
- "activation order indifference" — explicit mechanism in §4.

No drift detected.

---

## Execution Handoff

Spec complete. Next step: invoke `superpowers:writing-plans` skill to produce the executable Phase 4 plan from this spec.
