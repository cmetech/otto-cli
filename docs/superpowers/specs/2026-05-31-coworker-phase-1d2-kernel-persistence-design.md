# Otto Co-Worker Phase 1d2 — Kernel-State Persistence Design

**Status:** Approved (brainstorm 2026-05-31)
**Date:** 2026-05-31
**Author:** brainstorm session with Corey
**Phase:** 1d2 — kernel-state persistence half of the scratchpad pillar (deferred from 1d)
**Branch:** `feat/coworker-phase-0` (1d2 lands here; full Phase 1 ships before merging to `main`)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4, §3.3, §3.4, §3.4c, §3.5, §8 (Phase 1 milestone)
**Prior plan:** `docs/superpowers/plans/2026-05-31-coworker-phase-1d-data-libs-cell-archive.md` (1d, completed)

---

## 1. Goal

Make a NOC analyst's scratchpad state survive Otto exit. After 1d2, a cell that does

```ts
const con = await otto.duckdb.connect();
await con.run(`CREATE TABLE servers AS SELECT * FROM read_csv_auto('.otto/inputs/cmdb_q4.csv')`);
globalThis.notes = { loaded_at: new Date(), source: 'cmdb_q4.csv' };
```

can be followed — after a full `disposeAll()` and a fresh `ScratchpadManager` on the same `root` — by

```ts
const con = await otto.duckdb.connect();
const rows = await con.runAndReadAll('SELECT COUNT(*) FROM servers');
console.log(globalThis.notes.source); // 'cmdb_q4.csv'
```

without re-running the load cell. This closes the explicit 1c2/1d gap captured by the `re-warms a cold kernel with an empty globalThis` test.

## 2. Scope

**In scope (1d2):**
- `kernel.db` on-disk DuckDB instance, pre-opened at kernel startup, bound as `otto.duckdb` (DuckDBInstance).
- `namespace.json` snapshot/restore for user-added `globalThis` keys (v8 inside JSON envelope).
- Snapshot triggers: idle eviction, LRU eviction, `disposeAll` — spec-faithful (§3.5).
- Best-effort crash recovery on attach; divergence recorded in `meta.json`.
- `kernel-entry` accepts an optional `argv[3] = scratchpadDir`; backward-compat preserved for ChildProcessRuntime tests that don't pass one.
- NDJSON protocol additions: `SnapshotRequest`/`SnapshotResult`, `StartupErrorEvent`, `ReadyEvent.recovery_notes`.
- `meta.json` schema v1 → v2 with six new optional fields.

**Out of scope (deferred):**
- `/sp save` slash command, `/sp` surface generally → **1e**.
- TUI banner rendering of `recovery_notes` → **1e**.
- Cell-tree projection / `/sp fork` branching of `cells.jsonl` → **1e**.
- Output spill of large cell stdout to `artifact://` → Phase 3 / 1e.
- Risk #1 fallback to `sql.js` — 1d2 surfaces a clean `startup_error` if `@duckdb/node-api` open fails; it does not add an alternative engine.
- Per-cell snapshot policy — explicitly rejected during brainstorm in favor of the spec-aligned idle/dispose policy.
- `attached_sessions[]` removal on `/sp detach` — **1e**.

## 3. Locked decisions (brainstorm 2026-05-31)

1. **Serialization fidelity = v8 inside JSON envelope.** `namespace.json` is JSON-shaped (`{ schema_version, snapshot_b64, skipped[], ts }`) with the user-state payload as a base64-encoded `v8.serialize()` buffer. Captures Date / Map / Set / typed arrays / BigInt without lossy JSON.stringify. Non-serializable values (DuckDB connections, polars DataFrames, etc.) land in `skipped[]` with `{key, ctor, reason}` and are recorded — never silently dropped.
2. **kernel.db cell surface = `otto.duckdb` pre-opened `DuckDBInstance`.** The existing `DuckDB` namespace binding (1d) is retained for `:memory:` use. Cells reach the durable on-disk instance via `await otto.duckdb.connect()` — clear distinction between ephemeral and persistent.
3. **Snapshot triggers = spec-aligned (§3.5).** Snapshots fire on idle eviction (warm→cold), LRU eviction, and `disposeAll`. No per-cell snapshotting. Justification: DuckDB writes are continuously durable; JS-side `globalThis` state is the only thing that can be lost on crash, and the heavy state lives in DuckDB.
4. **Crash recovery = best-effort + divergence recorded in `meta.json`.** Missing/corrupt `namespace.json` → cold-start globalThis with pre-bound libs only, append `{kind:'namespace-absent'}` or `{kind:'namespace-corrupt'}` to `recovery_notes[]`. Trailing-corrupt `cells.jsonl` line → tolerated (already handled by `CellArchive.scan`). `kernel.db` open failure = hard fail (cannot safely diverge from durable tables; surfaces as `startup_error` event and rejects the `ChildProcessRuntime.start()` promise).

## 4. Architecture

Five additive pieces over the 1d code.

### 4.1 `kernel-entry.ts` accepts `argv[3] = scratchpadDir`

```
argv[2] = workspace (unchanged)
argv[3] = scratchpadDir (NEW, optional)
```

When `argv[3]` is set, `main()` does the following BEFORE the NDJSON read loop, in order:

1. Attempt `DuckDBInstance.create(<dir>/kernel.db)`.
   - Success → assign `sandbox.otto.duckdb = <instance>`.
   - Throw → emit `{type:'event', event:'startup_error', kind:'duckdb_open', error:{name,message}}` then `process.exit(1)`. The parent rejects the ready promise with a tagged error.
2. Read `<dir>/namespace.json`. The recovery_notes collected here piggyback on the `ready` frame:
   - Missing → push `{kind:'namespace-absent'}`.
   - Read/parse fails → push `{kind:'namespace-corrupt', message}`.
   - Decode succeeds → `v8.deserialize(Buffer.from(snapshot_b64, 'base64'))` returns a `Record<string, unknown>`; for each `[key, value]`, mutate the live sandbox: `sandbox[key] = value`. (The sandbox object IS the vm globalThis; direct property assignment is observed by subsequent `vm.runInContext` calls.)
   - Decode throws → push `{kind:'namespace-corrupt', message}`.
3. Emit `{type:'event', event:'ready', recovery_notes:[...]}`.

When `argv[3]` is absent (every existing 1a–1d test), main() emits a plain `ready` event and `otto.duckdb` is undefined — cells that try to use it get a clean `Cannot read properties of undefined (reading 'connect')` from V8. Existing tests are unaffected.

### 4.2 Snapshot request — parent-driven, kernel-side sync

Two new NDJSON frame types:

```ts
// kernel-protocol.ts additions
type SnapshotRequest = { id: number; type: 'snapshot' };
type SnapshotResult =
  | { id: number; type: 'snapshot_result'; ok: true; skipped: SkippedKey[]; snapshotted_at: string }
  | { id: number; type: 'snapshot_result'; ok: false; error: { name: string; message: string } };

type SkippedKey = { key: string; ctor: string | null; reason: string };

type StartupErrorEvent = { type: 'event'; event: 'startup_error'; kind: string; error: { name: string; message: string } };
type ReadyEvent = { type: 'event'; event: 'ready'; recovery_notes?: RecoveryNote[] };
type RecoveryNote =
  | { kind: 'namespace-absent' }
  | { kind: 'namespace-corrupt'; message: string }
  | { kind: 'cells-since-snapshot'; n: number }; // emitted by parent, not kernel
```

Kernel-side handler on receipt of `{type:'snapshot'}`:

1. Enumerate `Object.keys(sandbox)`. The **skip set** (known-bound names that must never be persisted):
   ```
   otto, console, progress,
   setTimeout, clearTimeout, setInterval, clearInterval,
   polars, DuckDB, ExcelJS, dateFns, lodash, zod, axios
   ```
2. For each remaining key, attempt `v8.serialize({ [key]: sandbox[key] })`.
   - Success → include in the survivor record.
   - Throw → push `{key, ctor: sandbox[key]?.constructor?.name ?? null, reason: err.message}` into `skipped[]`.
3. `v8.serialize(survivors)` → `Buffer.toString('base64')` → wrap in envelope:
   ```json
   { "schema_version": 1, "snapshot_b64": "...", "skipped": [...], "ts": "..." }
   ```
4. `writeFileSync(<dir>/namespace.json, JSON.stringify(envelope))` — synchronous so the file is flushed before the ACK.
5. Reply `{id, type:'snapshot_result', ok:true, skipped, snapshotted_at: ISO}`.
6. On any failure (e.g. dir vanished) → reply `{id, type:'snapshot_result', ok:false, error}`.

`scratchpadDir` absent → the request resolves immediately with `{ok:true, skipped:[], snapshotted_at: ISO}` without touching disk. Keeps the parent's snapshot call site uniform.

### 4.3 `ChildProcessRuntime` changes

New optional construction field `scratchpadDir?: string`, threaded into `spawn(...)` args. New method:

```ts
async snapshot(): Promise<SnapshotResult>
```

- Sends a `{type:'snapshot'}` frame with a fresh id and resolves with the matching `snapshot_result`.
- **Never throws** — failures are reported via `ok:false`, so eviction never blocks on snapshot failure. The parent decides what to record.
- On a disposed/dead runtime → resolves with `{ok:false, error:{name:'RuntimeDisposed', message:'...'}}` (does not throw).

The `readLoop` learns one new event (`startup_error` → reject the ready promise with `Error` tagged `startup_error/<kind>`) and extracts `recovery_notes` from the `ready` event so the parent can observe them via a new readonly getter:

```ts
get recoveryNotes(): readonly RecoveryNote[] // empty until ready resolves
```

### 4.4 `ScratchpadManager` integration

The cold→warm path in `getOrAttach` passes `scratchpadDir = this.dirFor(name)` to `spawnRuntime`. Eviction paths swap `await runtime.dispose()` for:

```ts
private async snapshotThenDispose(name: string, entry: Entry): Promise<void> {
  if (!entry.runtime) return;
  const res = await entry.runtime.snapshot();
  if (res.ok) {
    this.applySnapshotToMeta(name, entry, res); // last_snapshot_*, namespace_skipped
  } else {
    this.appendRecoveryNote(name, { at: ISO, kind: 'snapshot-failed', message: res.error.message });
  }
  await entry.runtime.dispose();
  entry.runtime = null; // cold; lock RETAINED
}
```

After `spawnRuntime` returns and `ready` resolves — and ONLY on a fresh spawn (i.e. inside `attachUnmanaged` or the cold→warm branch of `getOrAttach`, not on a getOrAttach that found an already-warm entry) — the manager drains `runtime.recoveryNotes` into the on-disk `meta.json` (append + cap at 20) and computes divergence: if the prior `meta.last_snapshot_cell_id` is a number AND `entry.archive.lastId > meta.last_snapshot_cell_id`, append `{kind:'cells-since-snapshot', n: archive.lastId - meta.last_snapshot_cell_id}`. The null check matters: a brand-new scratchpad has never been snapshotted, so the gap is not a divergence — it's just "no snapshot yet."

### 4.5 `CellArchive` — minimal addition

Expose the already-tracked internal:

```ts
get lastId(): number | null
```

Used by the manager to stamp `meta.last_snapshot_cell_id` at the exact moment of snapshot. No behavior change.

### 4.6 `namespace-codec.ts` (new)

Pure module — no I/O, no node:vm — so the round-trip is unit-testable in isolation:

```ts
export const NAMESPACE_SCHEMA_VERSION = 1;
export interface NamespaceEnvelope { schema_version: number; snapshot_b64: string; skipped: SkippedKey[]; ts: string }

export function encodeNamespace(values: Record<string, unknown>, now: () => number): { envelope: NamespaceEnvelope; skipped: SkippedKey[] };
export function decodeNamespace(json: string): { values: Record<string, unknown>; skipped: SkippedKey[] };
```

`encode` produces the envelope and the same `skipped[]` separately so kernel-entry can include it in the `snapshot_result` without re-parsing the envelope. `decode` throws on schema-mismatch / corrupt envelope; the caller (kernel-entry) catches and turns the throw into a `namespace-corrupt` recovery note.

## 5. `meta.json` schema v2

Bump `META_SCHEMA_VERSION` from 1 → 2. The 1d shape stays; six new optional fields are appended:

```jsonc
{
  // v1 fields (unchanged from 1d)
  "name": "p1-1234",
  "created_at": "2026-05-29T10:00:00Z",
  "last_used": "2026-05-31T18:22:01Z",
  "attached_sessions": ["sess-1"],
  "size_bytes": 41284091,
  "schema_version": 2,

  // v2 additions
  "last_snapshot_cell_id": 12,           // entry.archive.lastId at snapshot moment, or null
  "last_snapshot_at": "2026-05-31T18:21:55Z",
  "namespace_skipped": [
    { "key": "duckdbCon", "ctor": "DuckDBConnection", "reason": "not-serializable" }
  ],
  "recovery_notes": [                    // FIFO-capped at 20
    { "at": "2026-05-31T18:25:00Z", "kind": "namespace-absent" },
    { "at": "2026-05-31T18:25:00Z", "kind": "cells-since-snapshot", "n": 4 }
  ],
  "kernel_db": { "present": true, "path": "kernel.db" },
  "namespace": { "present": true, "schema_version": 1 }
}
```

**Migration semantics:** `writeMeta` reads the prior file, preserves unknown fields (forward-compat for future versions), preserves prior `recovery_notes[]` (appends, never replaces, then FIFO-caps at 20), preserves `attached_sessions[]` (dedup), updates `last_used` + `size_bytes` + `kernel_db.present` + `namespace.present` on every write, and writes `schema_version: 2`. A v1 meta on disk loads cleanly: the v2 fields simply default to absent until first snapshot.

## 6. Failure modes and recovery surface

| Scenario | What happens | User-visible signal (via meta.json — 1e renders) |
|---|---|---|
| `kernel.db` corrupt / locked | `kernel-entry` emits `startup_error` and exits(1); `ChildProcessRuntime.start()` rejects with `Error` tagged `startup_error/duckdb_open` | Hard fail to caller; `recovery_notes` not written (manager never owned the entry). Caller surfaces the error. |
| `namespace.json` missing | Kernel cold-starts; `recovery_notes[]` += `{kind:'namespace-absent'}` | "Loaded with empty JS state" |
| `namespace.json` corrupt | Kernel cold-starts; `recovery_notes[]` += `{kind:'namespace-corrupt', message}` | "JS state file was unreadable — N cells of recorded code can be re-executed" |
| `cells.jsonl` trailing-corrupt line | Tolerated by `CellArchive.scan` (already implemented); no recovery note | None |
| Snapshot itself fails (disk full, dir vanished) | `snapshot_result.ok=false`; manager appends `{kind:'snapshot-failed', message}`; dispose proceeds | "Last snapshot did not complete" |
| Cells advanced past last snapshot (mid-session crash) | On attach, manager computes `archive.lastId - meta.last_snapshot_cell_id` and appends `{kind:'cells-since-snapshot', n}` if > 0 | "N cells since snapshot may have lost JS state" |
| Non-serializable globalThis value (DuckDB conn, polars DF) | Skipped at snapshot time; recorded in `meta.namespace_skipped` | "Some values weren't persisted — list of names" |

## 7. File layout (changes)

```
packages/coworker-scratchpad/src/
  kernel-bindings.ts          ← unchanged (1d)
  kernel-entry.ts             ← argv[3]; otto.duckdb open; namespace restore; snapshot handler
  child-process-runtime.ts    ← scratchpadDir option; snapshot(); startup_error; recoveryNotes
  child-process-runtime.test.ts ← live-kernel persistence + snapshot tests
  cell-archive.ts             ← expose `get lastId()`
  scratchpad-manager.ts       ← scratchpadDir wiring; snapshotThenDispose;
                                writeMeta v2 fields; recovery_notes ingest + cap
  scratchpad-manager.test.ts  ← cold→warm restore; eviction snapshot; recovery; divergence
  kernel-protocol.ts          ← Snapshot{Request,Result}; StartupErrorEvent;
                                ReadyEvent.recovery_notes; RecoveryNote; SkippedKey
  namespace-codec.ts          ← NEW: encode/decode + SchemaVersion
  namespace-codec.test.ts     ← NEW: Date/Map/Set/BigInt roundtrip; skipped[]; corrupt envelope
  index.ts                    ← re-export new types
```

## 8. Test plan (TDD per task, one commit per task)

1. **`namespace-codec.test.ts`** — pure unit. Roundtrip plain JSON; roundtrip `Date` (instanceof preserved); roundtrip `Map`/`Set` (size + entries preserved); roundtrip `BigInt`; `skipped[]` populated when a value throws on serialize (use a fake whose `[Symbol.for('nodejs.util.inspect.custom')]` throws or a `WeakRef`); `decode` on a corrupt envelope (mangled base64) throws.
2. **`kernel-protocol.ts`** — type-guard tests for `isSnapshotResult`, `isStartupErrorEvent`, and ready-event with/without `recovery_notes`.
3. **`kernel-entry.ts`** — covered through `child-process-runtime.test.ts`:
   - Spawn with `scratchpadDir` → `await otto.duckdb.connect()` returns a connection; SQL `CREATE TABLE / INSERT` survives a `dispose` + new spawn on the same dir.
   - Spawn with `scratchpadDir`, snapshot user state (`globalThis.x = { d: new Date(0) }`), dispose, re-spawn → `globalThis.x.d instanceof Date && +globalThis.x.d === 0`.
   - Spawn without `scratchpadDir` (every prior test) → all 1a–1d tests stay green; `typeof otto.duckdb === 'undefined'`.
   - `startup_error` on a deliberately bad `kernel.db` path (e.g. point `scratchpadDir` at a read-only `/dev/null/x`) → `start()` rejects with the tagged error.
4. **`child-process-runtime.ts`** — `snapshot()` resolves with `ok:true` after a successful flow; resolves with `ok:false` (does NOT throw) on a dead runtime; `recoveryNotes` populated on ready when the kernel reports them.
5. **`cell-archive.ts`** — extend the existing tests: `archive.lastId === null` for a fresh dir; `=== n` after `n` appends; preserved across a re-construct (existing re-attach test extended).
6. **`scratchpad-manager.test.ts`** — the integration surface:
   - **cold→warm JS-state restore** — `runCell('a', 'globalThis.x = 1')`; force LRU eviction; `runCell('a', 'return globalThis.x')` returns 1.
   - **cold→warm DuckDB restore** — `runCell('a', 'const c=await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (42)")')`; `disposeAll()`; new manager + same root; `runCell('a', '... SELECT x FROM t')` returns 42.
   - **Crash recovery — missing namespace** — after the JS-state restore test above, delete `namespace.json` between dispose and re-attach; re-attach + cell reading `globalThis.x` returns `undefined`; `meta.recovery_notes[]` contains `{kind:'namespace-absent'}`.
   - **Divergence note** — set `meta.last_snapshot_cell_id` to a value below `archive.lastId` before attach; attach; `meta.recovery_notes[]` gains `{kind:'cells-since-snapshot', n:<delta>}`.
   - **Snapshot id stamp** — after a runCell + idle-evict cycle, `meta.last_snapshot_cell_id === archive.lastId at that moment`.
   - **`recovery_notes[]` FIFO cap** — write 25 notes, last 20 are retained, oldest 5 dropped.
   - **Backward compat** — every existing 1d test in `scratchpad-manager.test.ts` continues to pass unmodified.

**Gates:** `npm run build:coworker-scratchpad`, `npm run test:packages`, `npm run verify:workspace-coverage`. Per the 1c2 flakiness watch, run the manager test 3–5× in a loop to confirm no eviction races.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | `@duckdb/node-api` instance open at startup is async and slow on cold disk | `start()` already awaits `ready`; document the first-attach latency; benchmark in the test, do not assert a timing bound |
| 2 | v8.serialize encounters a value Node added in a newer version (Temporal, etc.) and throws | Caught by per-key try/catch → `skipped[]`; never aborts the whole snapshot |
| 3 | `writeFileSync(namespace.json)` is not atomic — power loss mid-write yields a corrupt file | Acceptable in v1 (matches the spec's best-effort posture); the corrupt-file path is exactly what `recovery_notes[]` was designed for. Atomic rename is a 1e or later upgrade. |
| 4 | A user puts a multi-MB object on `globalThis` → every idle snapshot serializes the whole thing | Spec-aligned cadence (idle/dispose only) means this happens at most once per warm-window; if it becomes a problem, add a configurable size cap that skips with `reason:'over-size'` |
| 5 | `kernel.db` left locked after a hard kill | `@duckdb/node-api` uses its own locking; if the next attach fails with a lock error, the user gets a clean `startup_error` — manual cleanup is the v1 answer (1e considers an auto-recover path) |
| 6 | Existing 1a–1d tests construct `ChildProcessRuntime` directly without `scratchpadDir` | `scratchpadDir` is optional; absent → ephemeral mode, no kernel.db, no namespace I/O; existing test fixtures unchanged |

## 10. Out-of-scope deferred items (handed to 1e or later)

- `/sp` slash commands and TUI rendering of `recovery_notes`.
- Cell-tree projection / branching via `cells.jsonl` parentId.
- Output-spill of large cell stdout to `artifact://`.
- `attached_sessions[]` removal on `/sp detach`.
- Atomic-rename pattern for `namespace.json` writes.
- `sql.js` fallback engine for DuckDB Risk #1.
- Explicit `/sp save` trigger.

---

**Next step:** invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-05-31-coworker-phase-1d2-kernel-persistence.md`.
