# Otto Co-Worker Phase 1d2 — Kernel-State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `kernel.db` and `namespace.json` real so a NOC analyst's `globalThis` state and DuckDB tables survive Otto exit and cold→warm re-spawn.

**Architecture:** Six additive pieces over 1d. (1) New `namespace-codec.ts` (pure v8-inside-JSON-envelope encoder/decoder, unit-testable in isolation). (2) Three new NDJSON frame types in `kernel-protocol.ts` (`SnapshotRequest`/`SnapshotResult`, `StartupErrorEvent`, `RecoveryNote`) plus `ReadyEvent.recovery_notes`. (3) `kernel-entry.ts` learns `argv[3] = scratchpadDir`: opens `<dir>/kernel.db` as `otto.duckdb` (DuckDBInstance), restores `<dir>/namespace.json` into the vm sandbox, handles `{type:'snapshot'}` by sync-writing namespace.json itself. (4) `ChildProcessRuntime` gains a `scratchpadDir` ctor option, a `snapshot()` method that never throws, a `recoveryNotes` getter, and a `startup_error` event that rejects `start()`. (5) `ScratchpadManager` threads `scratchpadDir` into spawn, replaces every `runtime.dispose()` eviction with `snapshotThenDispose`, grows `meta.json` to schema v2 with six new optional fields (`last_snapshot_cell_id`, `last_snapshot_at`, `namespace_skipped`, `recovery_notes[]` capped at 20, `kernel_db`, `namespace`), and computes `cells-since-snapshot` divergence on every fresh spawn. (6) `CellArchive` exposes `get lastId()`. Backward compat: every `ChildProcessRuntime` constructed without `scratchpadDir` (every existing 1a–1d test) behaves exactly as before — kernel emits the legacy `ready` event, `otto.duckdb` is undefined, `snapshot()` resolves immediately with `{ok:true, skipped:[]}`.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+. Runtime: `node:v8` (`serialize`/`deserialize` already in the stdlib), `@duckdb/node-api` (already a root dep). `node:test` + `node:assert/strict`. Builds on 1d (data libs + cells.jsonl + full meta.json) and 1c2 (ScratchpadManager + scratchpad-lock).

**Spec reference:** `docs/superpowers/specs/2026-05-31-coworker-phase-1d2-kernel-persistence-design.md` (the brainstorm spec — read this before implementing).
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4, §3.3, §3.4, §3.4c, §3.5, §8 (Phase 1 milestone).

**Locked decisions (do not re-litigate):**
1. **Serialization = v8 inside a JSON envelope.** `namespace.json = { schema_version, snapshot_b64, skipped[], ts }`. Captures Date / Map / Set / typed arrays / BigInt; non-serializable values land in `skipped[]` with `{key, ctor, reason}`.
2. **Cell-facing DuckDB surface = `otto.duckdb`** (pre-opened `DuckDBInstance`). The 1d `DuckDB` namespace binding stays for `:memory:` use.
3. **Snapshot triggers = spec-aligned** (§3.5): idle eviction + LRU eviction + `disposeAll`. No per-cell snapshots.
4. **Recovery = best-effort + divergence recorded in meta.json.** kernel.db open failure is the only hard fail; namespace.json missing/corrupt → cold-start with a recovery note.
5. **Kernel owns its own state-file disk I/O** (`kernel.db`, `namespace.json`); parent owns `meta.json`, `cells.jsonl`, and `lock.json`. Snapshot is parent-triggered via NDJSON; kernel writes the file sync before ACK.

**Known intentional gaps (deferred to 1e or later):**
- `/sp save`, `/sp` slash commands, TUI banner rendering of `recovery_notes` → 1e.
- Cell-tree projection / `/sp fork` branching → 1e.
- Output-spill of large stdout to `artifact://` → Phase 3 / 1e.
- Atomic-rename pattern for `namespace.json` writes → 1e+.
- `sql.js` fallback engine (Risk #1) → separate phase.

---

## Scope

**In scope (1d2):**
- `packages/coworker-scratchpad/src/namespace-codec.ts` — NEW: encode/decode v8-inside-JSON envelope.
- `kernel-protocol.ts` — `SnapshotRequest`, `SnapshotResult`, `StartupErrorEvent`, `RecoveryNote`, `SkippedKey`; `ReadyEvent.recovery_notes?`.
- `kernel-entry.ts` — accept `argv[3]`; open `kernel.db` as `otto.duckdb`; restore namespace; handle `{type:'snapshot'}`.
- `child-process-runtime.ts` — `scratchpadDir?` opt; `snapshot()`; `recoveryNotes` getter; `startup_error` → reject `start()`.
- `cell-archive.ts` — `get lastId()` getter (already tracked internally).
- `scratchpad-manager.ts` — thread `scratchpadDir`; `snapshotThenDispose`; meta v2 fields + recovery_notes ingest + FIFO cap; cells-since-snapshot divergence on fresh spawn.
- `index.ts` — re-export new types.

**Explicitly NOT in scope:** see "Known intentional gaps" above.

---

## Canonical commands

Same harness as 1a–1d. Single-file test from repo root:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<FILE>.test.ts
```

Build the package / run the gates:

```bash
npm run build:coworker-scratchpad
npm run test:packages
npm run verify:workspace-coverage
```

> **Prerequisite:** the kernel imports `@otto/coworker-utils` at runtime — if a test errors with "Cannot find module '@otto/coworker-utils'", run `npm run build:coworker-utils` once.
>
> **Flake watch (from 1c2):** the eviction tests in `scratchpad-manager.test.ts` are timing-sensitive. Run the file 3–5× in a loop after Task 5 (`for i in 1 2 3 4 5; do ... || break; done`).

---

## File structure

```
packages/coworker-scratchpad/src/
  namespace-codec.ts          ← Create: encode/decode v8-inside-JSON envelope (Task 1)
  namespace-codec.test.ts     ← Create: roundtrip + skipped[] + corrupt-envelope (Task 1)
  kernel-protocol.ts          ← Modify: new frame types + ReadyEvent.recovery_notes (Task 2)
  kernel-protocol.test.ts     ← Create: type-guard tests (Task 2)
  cell-archive.ts             ← Modify: expose `get lastId()` (Task 2)
  cell-archive.test.ts        ← Modify: assert lastId behavior (Task 2)
  kernel-entry.ts             ← Modify: argv[3], otto.duckdb open, namespace restore (Task 3)
  child-process-runtime.ts    ← Modify: scratchpadDir + recoveryNotes + startup_error (Task 3-4)
  child-process-runtime.test.ts ← Modify: persistence + snapshot tests (Task 3-4)
  scratchpad-manager.ts       ← Modify: scratchpadDir wiring + snapshotThenDispose
                                          + writeMeta v2 + recovery_notes ingest (Task 5)
  scratchpad-manager.test.ts  ← Modify: cold→warm restore + divergence + recovery (Task 5)
  index.ts                    ← Modify: re-export new types (Task 6)
```

Six tasks. Task 1 ships the pure codec (no I/O, no vm — fastest TDD). Task 2 adds the protocol types and the `CellArchive.lastId` getter — both small additive surface. Task 3 wires the **load** half (kernel opens `otto.duckdb`, restores namespace.json on spawn, parent observes recoveryNotes, startup_error rejects start). Task 4 wires the **save** half (parent triggers `snapshot()`, kernel sync-writes namespace.json, ACKs). Task 5 is the manager integration: `snapshotThenDispose` in every eviction path, meta.json schema v2, cells-since-snapshot divergence on fresh spawn. Task 6 wires the barrel and runs the full gates.

---

## Task 1: `namespace-codec` — v8-inside-JSON envelope

Pure module — no I/O, no `node:vm` — so the round-trip is unit-testable in isolation. This module is the only place that knows the envelope shape; kernel-entry and tests both go through it.

**Files:**
- Create: `packages/coworker-scratchpad/src/namespace-codec.ts`
- Create: `packages/coworker-scratchpad/src/namespace-codec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/namespace-codec.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAMESPACE_SCHEMA_VERSION,
  encodeNamespace,
  decodeNamespace,
} from './namespace-codec.js';

describe('namespace-codec', () => {
  it('round-trips primitives and plain objects', () => {
    const { envelope } = encodeNamespace({ x: 1, s: 'hi', o: { a: [1, 2, 3] } }, () => 0);
    assert.equal(envelope.schema_version, NAMESPACE_SCHEMA_VERSION);
    assert.equal(typeof envelope.snapshot_b64, 'string');
    assert.deepEqual(envelope.skipped, []);
    const { values, skipped } = decodeNamespace(JSON.stringify(envelope));
    assert.equal(values.x, 1);
    assert.equal(values.s, 'hi');
    assert.deepEqual(values.o, { a: [1, 2, 3] });
    assert.deepEqual(skipped, []);
  });

  it('round-trips Date / Map / Set / BigInt with type identity preserved', () => {
    const m = new Map<string, number>([['a', 1], ['b', 2]]);
    const s = new Set<number>([10, 20, 30]);
    const d = new Date(1717180800000);
    const big = 9007199254740993n; // > Number.MAX_SAFE_INTEGER
    const { envelope } = encodeNamespace({ m, s, d, big }, () => 0);
    const { values } = decodeNamespace(JSON.stringify(envelope));
    assert.ok(values.m instanceof Map);
    assert.equal((values.m as Map<string, number>).get('b'), 2);
    assert.ok(values.s instanceof Set);
    assert.equal((values.s as Set<number>).has(20), true);
    assert.ok(values.d instanceof Date);
    assert.equal((values.d as Date).getTime(), 1717180800000);
    assert.equal(values.big, 9007199254740993n);
  });

  it('records non-serializable values in skipped[] without aborting', () => {
    // A function is not v8-serializable.
    const fn = (): number => 1;
    const { envelope, skipped } = encodeNamespace({ ok: 1, badFn: fn }, () => 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].key, 'badFn');
    assert.equal(skipped[0].ctor, 'Function');
    assert.match(skipped[0].reason, /./); // non-empty reason
    assert.deepEqual(envelope.skipped, skipped);
    const { values } = decodeNamespace(JSON.stringify(envelope));
    assert.equal(values.ok, 1);
    assert.equal('badFn' in values, false);
  });

  it('encodes ts from the injected clock', () => {
    const { envelope } = encodeNamespace({ x: 1 }, () => 1717180800000);
    assert.equal(envelope.ts, new Date(1717180800000).toISOString());
  });

  it('decodeNamespace throws on a wrong schema_version', () => {
    const bad = JSON.stringify({ schema_version: 99, snapshot_b64: 'AAAA', skipped: [], ts: '...' });
    assert.throws(() => decodeNamespace(bad), /schema_version/);
  });

  it('decodeNamespace throws on a malformed envelope (not JSON)', () => {
    assert.throws(() => decodeNamespace('{not json'), /./);
  });

  it('decodeNamespace throws on a base64 payload that is not a valid v8 buffer', () => {
    const bad = JSON.stringify({
      schema_version: NAMESPACE_SCHEMA_VERSION,
      snapshot_b64: Buffer.from('not-a-v8-buffer').toString('base64'),
      skipped: [],
      ts: '2026-05-31T00:00:00.000Z',
    });
    assert.throws(() => decodeNamespace(bad), /./);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/namespace-codec.test.ts`
Expected: FAIL — cannot find module `./namespace-codec.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/coworker-scratchpad/src/namespace-codec.ts`:

```typescript
import { serialize, deserialize } from 'node:v8';

export const NAMESPACE_SCHEMA_VERSION = 1;

export interface SkippedKey {
  key: string;
  ctor: string | null;
  reason: string;
}

export interface NamespaceEnvelope {
  schema_version: number;
  snapshot_b64: string;
  skipped: SkippedKey[];
  ts: string;
}

export interface EncodeResult {
  envelope: NamespaceEnvelope;
  skipped: SkippedKey[];
}

export interface DecodeResult {
  values: Record<string, unknown>;
  skipped: SkippedKey[];
}

function ctorName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const c = (value as { constructor?: { name?: string } }).constructor;
  return c?.name ?? null;
}

export function encodeNamespace(
  values: Record<string, unknown>,
  now: () => number,
): EncodeResult {
  const survivors: Record<string, unknown> = {};
  const skipped: SkippedKey[] = [];
  for (const key of Object.keys(values)) {
    const value = values[key];
    try {
      // Probe by serializing a single-key wrapper. Cheaper than per-key buffers
      // because the survivors map is re-serialized once below.
      serialize({ [key]: value });
      survivors[key] = value;
    } catch (err) {
      skipped.push({
        key,
        ctor: ctorName(value),
        reason: (err as Error).message,
      });
    }
  }
  const snapshot_b64 = serialize(survivors).toString('base64');
  const envelope: NamespaceEnvelope = {
    schema_version: NAMESPACE_SCHEMA_VERSION,
    snapshot_b64,
    skipped,
    ts: new Date(now()).toISOString(),
  };
  return { envelope, skipped };
}

export function decodeNamespace(json: string): DecodeResult {
  const parsed = JSON.parse(json) as Partial<NamespaceEnvelope>;
  if (parsed.schema_version !== NAMESPACE_SCHEMA_VERSION) {
    throw new Error(
      `namespace-codec: unsupported schema_version ${String(parsed.schema_version)} (expected ${NAMESPACE_SCHEMA_VERSION})`,
    );
  }
  if (typeof parsed.snapshot_b64 !== 'string') {
    throw new Error('namespace-codec: missing snapshot_b64');
  }
  const buf = Buffer.from(parsed.snapshot_b64, 'base64');
  const values = deserialize(buf) as Record<string, unknown>;
  return { values, skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/namespace-codec.test.ts`
Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/namespace-codec.ts packages/coworker-scratchpad/src/namespace-codec.test.ts
git commit -m "feat(coworker-scratchpad): namespace-codec — v8-inside-JSON envelope with skipped[]"
```

---

## Task 2: Protocol type additions + `CellArchive.lastId`

Two small additive changes that the later tasks depend on. Bundled because each is tiny and they have no shared logic with each other.

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-protocol.ts`
- Create: `packages/coworker-scratchpad/src/kernel-protocol.test.ts`
- Modify: `packages/coworker-scratchpad/src/cell-archive.ts`
- Modify: `packages/coworker-scratchpad/src/cell-archive.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/coworker-scratchpad/src/kernel-protocol.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDataLoadEvent,
  isProgressEvent,
  isStartupErrorEvent,
  isSnapshotResult,
  type KernelFrame,
} from './kernel-protocol.js';

describe('kernel-protocol type guards (1d2 additions)', () => {
  it('isStartupErrorEvent recognises the startup_error event', () => {
    const f: KernelFrame = {
      type: 'event',
      event: 'startup_error',
      kind: 'duckdb_open',
      error: { name: 'Error', message: 'cannot open db' },
    };
    assert.equal(isStartupErrorEvent(f), true);
    assert.equal(isDataLoadEvent(f), false);
    assert.equal(isProgressEvent(f), false);
  });

  it('isSnapshotResult recognises a successful snapshot_result', () => {
    const f: KernelFrame = {
      id: 1,
      type: 'snapshot_result',
      ok: true,
      skipped: [],
      snapshotted_at: '2026-05-31T00:00:00.000Z',
    };
    assert.equal(isSnapshotResult(f), true);
  });

  it('isSnapshotResult recognises a failed snapshot_result', () => {
    const f: KernelFrame = {
      id: 1,
      type: 'snapshot_result',
      ok: false,
      error: { name: 'Error', message: 'disk full' },
    };
    assert.equal(isSnapshotResult(f), true);
  });

  it('a ready event may carry recovery_notes', () => {
    const f: KernelFrame = {
      type: 'event',
      event: 'ready',
      recovery_notes: [{ kind: 'namespace-absent' }],
    };
    assert.equal(f.type, 'event');
    if (f.type === 'event' && f.event === 'ready') {
      assert.equal(f.recovery_notes?.[0]?.kind, 'namespace-absent');
    }
  });
});
```

Then append to the existing `packages/coworker-scratchpad/src/cell-archive.test.ts` (inside the existing `describe('CellArchive', …)` block, after the last `it(...)` and before the closing `});`):

```typescript
  it('exposes lastId — null before any append, the most recent id after', () => {
    const a = new CellArchive(dir, () => 0);
    assert.equal(a.lastId, null);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    assert.equal(a.lastId, 1);
    a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(a.lastId, 2);
    // re-attach preserves it
    const a2 = new CellArchive(dir, () => 0);
    assert.equal(a2.lastId, 2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-protocol.test.ts packages/coworker-scratchpad/src/cell-archive.test.ts`
Expected: FAIL — `isStartupErrorEvent` / `isSnapshotResult` are not exported; `archive.lastId` is not a public property.

- [ ] **Step 3: Extend `kernel-protocol.ts`**

In `packages/coworker-scratchpad/src/kernel-protocol.ts`, at the top of the file (below the leading `// NDJSON wire protocol …` comment), add a re-export of `SkippedKey` so both the codec and the protocol agree on one canonical shape:

```typescript
export type { SkippedKey } from './namespace-codec.js';
import type { SkippedKey } from './namespace-codec.js';
```

Then, after the existing `ResultResponse` line and before `DataLoadDrawer`, add the new request/response shapes:

```typescript
// 1d2 — snapshot request/response. Parent triggers, kernel sync-writes
// <scratchpadDir>/namespace.json and ACKs. Parent records the result into
// meta.json before disposing the kernel.
export interface SnapshotRequest {
  id: number;
  type: 'snapshot';
}
export interface SnapshotResultOk {
  id: number;
  type: 'snapshot_result';
  ok: true;
  skipped: SkippedKey[];
  snapshotted_at: string;
}
export interface SnapshotResultErr {
  id: number;
  type: 'snapshot_result';
  ok: false;
  error: { name: string; message: string };
}
export type SnapshotResult = SnapshotResultOk | SnapshotResultErr;

export type RecoveryNote =
  | { kind: 'namespace-absent' }
  | { kind: 'namespace-corrupt'; message: string }
  | { kind: 'cells-since-snapshot'; n: number }
  | { kind: 'snapshot-failed'; message: string };
```

Replace `export type KernelRequest = RunRequest;` with:

```typescript
export type KernelRequest = RunRequest | SnapshotRequest;
```

Add `recovery_notes?` to `ReadyEvent`:

```typescript
export interface ReadyEvent {
  type: 'event';
  event: 'ready';
  recovery_notes?: RecoveryNote[];
}
```

Add the new event interface and extend `KernelEvent`:

```typescript
export interface StartupErrorEvent {
  type: 'event';
  event: 'startup_error';
  kind: string;
  error: { name: string; message: string };
}
export type KernelEvent = ReadyEvent | DataLoadEvent | ProgressEvent | StartupErrorEvent;
```

Replace `export type KernelFrame = ResultResponse | KernelEvent;` with:

```typescript
export type KernelFrame = ResultResponse | KernelEvent | SnapshotResult;
```

Append two new type guards at the bottom of the file:

```typescript
export function isStartupErrorEvent(frame: KernelFrame): frame is StartupErrorEvent {
  return frame.type === 'event' && frame.event === 'startup_error';
}

export function isSnapshotResult(frame: KernelFrame): frame is SnapshotResult {
  return frame.type === 'snapshot_result';
}
```

- [ ] **Step 4: Extend `cell-archive.ts`**

In `packages/coworker-scratchpad/src/cell-archive.ts`, after the `append(...)` method and before the closing `}` of the class, add:

```typescript
  get lastId(): number | null {
    return this.lastId_;
  }
```

Rename the private field `lastId` to `lastId_` so the getter doesn't shadow it. Apply these renames in the file:

(a) In the constructor body, change:
```typescript
    const { nextId, lastId } = this.scan();
    this.nextId = nextId;
    this.lastId = lastId;
```
to:
```typescript
    const { nextId, lastId } = this.scan();
    this.nextId = nextId;
    this.lastId_ = lastId;
```

(b) In the class field declarations at the top, change:
```typescript
  private lastId: number | null;
```
to:
```typescript
  private lastId_: number | null;
```

(c) Inside `append`, change `parentId: this.lastId` to `parentId: this.lastId_` and `this.lastId = id` to `this.lastId_ = id`.

The result: the public `get lastId()` returns the same value `parentId` chains from. The 1d behavior is unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-protocol.test.ts packages/coworker-scratchpad/src/cell-archive.test.ts`
Expected: PASS — `# pass 5` for `cell-archive.test.ts` (4 existing + 1 new), `# pass 4` for `kernel-protocol.test.ts`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-protocol.ts packages/coworker-scratchpad/src/kernel-protocol.test.ts packages/coworker-scratchpad/src/cell-archive.ts packages/coworker-scratchpad/src/cell-archive.test.ts
git commit -m "feat(coworker-scratchpad): protocol types for snapshot/startup_error/recovery; CellArchive.lastId"
```

---

## Task 3: The **load** half — `scratchpadDir`, `otto.duckdb`, namespace restore on spawn

After this task, a runtime constructed with `scratchpadDir` opens `<dir>/kernel.db` (binding `otto.duckdb`) and restores `<dir>/namespace.json` into the vm sandbox; `runtime.recoveryNotes` reflects what the kernel saw; `start()` rejects when `kernel.db` open fails. Without `scratchpadDir`, behavior is unchanged.

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-entry.ts`
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to the end of `packages/coworker-scratchpad/src/child-process-runtime.test.ts`, after its final `});`. Add `encodeNamespace` + `existsSync` + `writeFileSync` imports to the top of the file if not already present (top imports already cover `mkdtemp`/`mkdir`/`writeFile`/`rm`, `tmpdir`, `join`, `ChildProcessRuntime`):

At the top of the file, extend the imports so they include:

```typescript
import { existsSync, writeFileSync } from 'node:fs';
import { encodeNamespace } from './namespace-codec.js';
```

Then append:

```typescript
describe('ChildProcessRuntime — persistence (1d2)', () => {
  let ws: string;
  let sp: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-pers-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    sp = await mkdtemp(join(tmpdir(), 'cpr-pers-sp-'));
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
    await rm(sp, { recursive: true, force: true });
  });

  it('binds otto.duckdb as a DuckDBInstance when scratchpadDir is set', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const { value } = await rt.runCell(
      'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (42)"); const r = await c.runAndReadAll("SELECT x FROM t"); return r.getRows().length;',
    );
    assert.equal(value, 1);
    assert.equal(existsSync(join(sp, 'kernel.db')), true);
  });

  it('DuckDB table survives dispose + fresh runtime on the same scratchpadDir', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    await rt.runCell(
      'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (1),(2),(3)");',
    );
    await rt.dispose();

    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const { value } = await rt.runCell(
      'const c = await otto.duckdb.connect(); const r = await c.runAndReadAll("SELECT COUNT(*) AS n FROM t"); return Number(r.getRows()[0][0]);',
    );
    assert.equal(value, 3);
  });

  it('restores globalThis from a pre-written namespace.json (Date + Map roundtrip)', async () => {
    const m = new Map<string, number>([['a', 1], ['b', 2]]);
    const d = new Date(1717180800000);
    const { envelope } = encodeNamespace({ m, d, n: 42 }, () => 0);
    writeFileSync(join(sp, 'namespace.json'), JSON.stringify(envelope));

    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const a = (await rt.runCell('return globalThis.n;')).value;
    const b = (await rt.runCell('return globalThis.m.get("b");')).value;
    const c = (await rt.runCell('return globalThis.d instanceof Date && globalThis.d.getTime();')).value;
    assert.equal(a, 42);
    assert.equal(b, 2);
    assert.equal(c, 1717180800000);
    assert.deepEqual(rt.recoveryNotes, []);
  });

  it('records namespace-absent in recoveryNotes when namespace.json is missing', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    assert.deepEqual(rt.recoveryNotes, [{ kind: 'namespace-absent' }]);
  });

  it('records namespace-corrupt in recoveryNotes when namespace.json is malformed', async () => {
    writeFileSync(join(sp, 'namespace.json'), '{not json');
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    assert.equal(rt.recoveryNotes.length, 1);
    assert.equal(rt.recoveryNotes[0].kind, 'namespace-corrupt');
  });

  it('legacy mode (no scratchpadDir) leaves otto.duckdb undefined and emits no recovery notes', async () => {
    rt = new ChildProcessRuntime({ workspace: ws });
    await rt.start();
    const v = (await rt.runCell('return typeof otto.duckdb;')).value;
    assert.equal(v, 'undefined');
    assert.deepEqual(rt.recoveryNotes, []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: FAIL — `scratchpadDir` option does not exist; `recoveryNotes` getter is missing; `otto.duckdb` is undefined even when `scratchpadDir` is set.

- [ ] **Step 3: Wire `scratchpadDir` into the spawn args**

In `packages/coworker-scratchpad/src/child-process-runtime.ts`:

(a) Add the new option. In `ChildProcessRuntimeOptions` (after `entryPath?: string;`):

```typescript
  scratchpadDir?: string;
```

(b) Add the import for the new event guard. At the top, replace:

```typescript
import { isDataLoadEvent, isProgressEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame } from './kernel-protocol.js';
```

with:

```typescript
import { isDataLoadEvent, isProgressEvent, isStartupErrorEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame, RecoveryNote } from './kernel-protocol.js';
```

(c) Add a private field to track recovery notes (after `private restartsSinceSuccess = 0;`):

```typescript
  private recoveryNotes_: RecoveryNote[] = [];
```

(d) Add the public getter (anywhere reasonable; place after `get hasActiveCell`):

```typescript
  get recoveryNotes(): readonly RecoveryNote[] {
    return this.recoveryNotes_;
  }
```

(e) Modify `spawnChild()` to forward `scratchpadDir` as `argv[3]`. Replace:

```typescript
    const child = spawn(
      process.execPath,
      [...kernelExecArgv(), entry, this.options.workspace],
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
    ) as unknown as ChildProcessWithoutNullStreams;
```

with:

```typescript
    const args = [...kernelExecArgv(), entry, this.options.workspace];
    if (this.options.scratchpadDir !== undefined) args.push(this.options.scratchpadDir);
    const child = spawn(
      process.execPath,
      args,
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
    ) as unknown as ChildProcessWithoutNullStreams;
```

(f) In `readLoop`, extract `recovery_notes` from the ready event and handle `startup_error`. Locate:

```typescript
        if (frame.type === 'event') {
          if (frame.event === 'ready') {
            this.childReady = true;
            this.resolveReady();
          }
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          else if (isProgressEvent(frame)) this.resetInactivity();
          continue;
        }
```

Replace with:

```typescript
        if (frame.type === 'event') {
          if (frame.event === 'ready') {
            if (frame.recovery_notes) this.recoveryNotes_ = [...frame.recovery_notes];
            this.childReady = true;
            this.resolveReady();
          }
          else if (isStartupErrorEvent(frame)) {
            const err = new Error(frame.error.message);
            err.name = `startup_error/${frame.kind}`;
            this.rejectReady(err);
          }
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          else if (isProgressEvent(frame)) this.resetInactivity();
          continue;
        }
```

- [ ] **Step 4: Teach `kernel-entry.ts` to read `argv[3]`**

In `packages/coworker-scratchpad/src/kernel-entry.ts`:

(a) Extend the imports at the top (replace the `import process, { argv, stdin, stdout } from 'node:process';` line — keep it; add this BELOW the existing imports):

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';
import { decodeNamespace } from './namespace-codec.js';
import type { RecoveryNote } from './kernel-protocol.js';
```

(b) After the `const workspace = argv[2] ?? process.cwd();` line, add:

```typescript
const scratchpadDir: string | undefined = argv[3];
```

(c) The `sandbox` literal needs `otto` to be an object whose `duckdb` field can be assigned later (it currently spreads `{ collectors: ottoCollectors }` immutably). Refactor: build `otto` as a named record, mutate `otto.duckdb` after the DuckDB open, then spread `otto` into the sandbox. Replace:

```typescript
const sandbox: Record<string, unknown> = {
  otto: { collectors: ottoCollectors },
  ...buildDataLibBindings(),
  // Timers are not part of a fresh vm context; bind the host ones so async cells
  // (await new Promise((r) => setTimeout(r, ...))) and progress() heartbeats work.
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
const context = vm.createContext(sandbox);
```

with:

```typescript
const otto: Record<string, unknown> = { collectors: ottoCollectors };
const sandbox: Record<string, unknown> = {
  otto,
  ...buildDataLibBindings(),
  // Timers are not part of a fresh vm context; bind the host ones so async cells
  // (await new Promise((r) => setTimeout(r, ...))) and progress() heartbeats work.
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
const context = vm.createContext(sandbox);
```

(d) Replace the body of `main()`. Find:

```typescript
async function main(): Promise<void> {
  send({ type: 'event', event: 'ready' });
  for await (const raw of readNdjson(stdin)) {
    if (trace) process.stderr.write(`[kernel←] ${JSON.stringify(raw)}\n`);
    const req = raw as KernelRequest;
    if (req.type !== 'run') continue;
    let res: ResultResponse;
    try {
      const { value, stdout: out } = await runCell(req.code);
      res = { id: req.id, type: 'result', ok: true, value: toSerializable(value), stdout: out };
    } catch (err) {
      const e = err as Error;
      res = {
        id: req.id,
        type: 'result',
        ok: false,
        error: { name: e.name, message: e.message, stack: e.stack },
      };
    }
    send(res);
  }
}
```

Replace with:

```typescript
async function openKernelDb(dir: string): Promise<void> {
  try {
    const instance = await DuckDBInstance.create(join(dir, 'kernel.db'));
    otto.duckdb = instance;
  } catch (err) {
    const e = err as Error;
    send({
      type: 'event',
      event: 'startup_error',
      kind: 'duckdb_open',
      error: { name: e.name, message: e.message },
    });
    process.exit(1);
  }
}

function restoreNamespace(dir: string): RecoveryNote[] {
  const path = join(dir, 'namespace.json');
  if (!existsSync(path)) return [{ kind: 'namespace-absent' }];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return [{ kind: 'namespace-corrupt', message: (err as Error).message }];
  }
  try {
    const { values } = decodeNamespace(raw);
    for (const key of Object.keys(values)) sandbox[key] = values[key];
    return [];
  } catch (err) {
    return [{ kind: 'namespace-corrupt', message: (err as Error).message }];
  }
}

function writeNamespaceSnapshot(dir: string): { skipped: SkippedKey[]; snapshotted_at: string } {
  // Enumerate live globalThis additions, excluding the known-bound surface.
  const live: Record<string, unknown> = {};
  for (const key of Object.keys(sandbox)) {
    if (KNOWN_BOUND_KEYS.has(key)) continue;
    live[key] = sandbox[key];
  }
  const { envelope, skipped } = encodeNamespace(live, () => Date.now());
  writeFileSync(join(dir, 'namespace.json'), JSON.stringify(envelope));
  return { skipped, snapshotted_at: envelope.ts };
}

async function main(): Promise<void> {
  const recoveryNotes: RecoveryNote[] = [];
  if (scratchpadDir !== undefined) {
    await openKernelDb(scratchpadDir);
    recoveryNotes.push(...restoreNamespace(scratchpadDir));
  }
  send({ type: 'event', event: 'ready', recovery_notes: recoveryNotes });

  for await (const raw of readNdjson(stdin)) {
    if (trace) process.stderr.write(`[kernel←] ${JSON.stringify(raw)}\n`);
    const req = raw as KernelRequest;
    if (req.type === 'snapshot') {
      if (scratchpadDir === undefined) {
        send({ id: req.id, type: 'snapshot_result', ok: true, skipped: [], snapshotted_at: new Date().toISOString() });
        continue;
      }
      try {
        const { skipped, snapshotted_at } = writeNamespaceSnapshot(scratchpadDir);
        send({ id: req.id, type: 'snapshot_result', ok: true, skipped, snapshotted_at });
      } catch (err) {
        const e = err as Error;
        send({ id: req.id, type: 'snapshot_result', ok: false, error: { name: e.name, message: e.message } });
      }
      continue;
    }
    if (req.type !== 'run') continue;
    let res: ResultResponse;
    try {
      const { value, stdout: out } = await runCell(req.code);
      res = { id: req.id, type: 'result', ok: true, value: toSerializable(value), stdout: out };
    } catch (err) {
      const e = err as Error;
      res = {
        id: req.id,
        type: 'result',
        ok: false,
        error: { name: e.name, message: e.message, stack: e.stack },
      };
    }
    send(res);
  }
}
```

(e) The new code above references `join` (path module), `writeFileSync` (fs), `encodeNamespace`, `SkippedKey`, and `KNOWN_BOUND_KEYS`. Extend the imports at the top to add `join` and `writeFileSync`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
```

And add `encodeNamespace` + `SkippedKey` to the existing namespace-codec / protocol imports (already added above, just include `encodeNamespace`):

```typescript
import { encodeNamespace, decodeNamespace } from './namespace-codec.js';
import type { RecoveryNote, SkippedKey } from './kernel-protocol.js';
```

(f) Define `KNOWN_BOUND_KEYS` near the top of the file (after the `const scratchpadDir = ...` line):

```typescript
const KNOWN_BOUND_KEYS = new Set([
  'otto',
  'console',
  'progress',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'polars',
  'DuckDB',
  'ExcelJS',
  'dateFns',
  'lodash',
  'zod',
  'axios',
]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: PASS — all prior `child-process-runtime` tests + the six new `persistence (1d2)` tests green (`# fail 0`). First run may be slow while the DuckDB native addon opens the on-disk file.

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-entry.ts packages/coworker-scratchpad/src/child-process-runtime.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "feat(coworker-scratchpad): kernel opens kernel.db + restores namespace.json on spawn"
```

---

## Task 4: The **save** half — `snapshot()` + startup_error reject path

After Task 3 the kernel can already handle a `{type:'snapshot'}` request (the handler was added because it lives in the same `main()` body). What's missing on the parent side: a `snapshot()` method on `ChildProcessRuntime` that sends the request, waits for the matching `snapshot_result`, and never throws. And the `startup_error → rejectReady` path needs a test that proves it.

**Files:**
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a second new `describe` block to the end of `packages/coworker-scratchpad/src/child-process-runtime.test.ts`, after the persistence block. Add `readFileSync` to the `import { existsSync, writeFileSync } from 'node:fs';` line so it reads:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
```

Then append:

```typescript
describe('ChildProcessRuntime — snapshot() (1d2)', () => {
  let ws: string;
  let sp: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-snap-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    sp = await mkdtemp(join(tmpdir(), 'cpr-snap-sp-'));
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
    await rm(sp, { recursive: true, force: true });
  });

  it('snapshot() writes namespace.json from live globalThis state and returns ok', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    await rt.runCell('globalThis.cnt = 7; globalThis.who = "noc"; globalThis.when = new Date(0);');
    const res = await rt.snapshot();
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual(res.skipped, []);
      assert.ok(typeof res.snapshotted_at === 'string');
    }
    const envelope = JSON.parse(readFileSync(join(sp, 'namespace.json'), 'utf8'));
    assert.equal(envelope.schema_version, 1);
    assert.equal(typeof envelope.snapshot_b64, 'string');
    // Round-trip in a fresh runtime: globalThis.cnt comes back as 7.
    await rt.dispose();
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const back = (await rt.runCell('return [globalThis.cnt, globalThis.who, globalThis.when.getTime()];')).value;
    assert.deepEqual(back, [7, 'noc', 0]);
  });

  it('snapshot() records non-serializable values in skipped[]', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    // A function on globalThis is not v8-serializable.
    await rt.runCell('globalThis.fn = function bad() { return 1; }; globalThis.ok = 1;');
    const res = await rt.snapshot();
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.skipped.length, 1);
      assert.equal(res.skipped[0].key, 'fn');
      assert.equal(res.skipped[0].ctor, 'Function');
    }
  });

  it('snapshot() on a legacy runtime (no scratchpadDir) is a no-op and resolves ok', async () => {
    rt = new ChildProcessRuntime({ workspace: ws });
    await rt.start();
    const res = await rt.snapshot();
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.skipped, []);
  });

  it('snapshot() on a disposed runtime resolves with ok:false (does NOT throw)', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    await rt.dispose();
    const res = await rt.snapshot();
    assert.equal(res.ok, false);
  });

  it('start() rejects with a startup_error/duckdb_open tagged error when kernel.db cannot be opened', async () => {
    // Point scratchpadDir at a file (not a dir) so DuckDBInstance.create(join(file,"kernel.db")) fails.
    const blocker = join(sp, 'blocker');
    writeFileSync(blocker, 'x');
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: blocker, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await assert.rejects(rt.start(), (e: Error) => /startup_error\/duckdb_open/.test(e.name) || /duckdb/i.test(e.message));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: FAIL — `rt.snapshot` is not a function.

- [ ] **Step 3: Add `snapshot()` to `ChildProcessRuntime`**

In `packages/coworker-scratchpad/src/child-process-runtime.ts`:

(a) Extend the runtime-side frame typing. At the top, where `KernelFrame` and related types are imported, replace:

```typescript
import { isDataLoadEvent, isProgressEvent, isStartupErrorEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame, RecoveryNote } from './kernel-protocol.js';
```

with:

```typescript
import { isDataLoadEvent, isProgressEvent, isStartupErrorEvent, isSnapshotResult } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame, RecoveryNote, SnapshotResult } from './kernel-protocol.js';
```

(b) Add a private map for pending snapshots. Next to `private readonly pending = new Map<number, Pending>();`, add:

```typescript
  private readonly pendingSnapshots = new Map<number, (res: SnapshotResult) => void>();
```

(c) Handle the snapshot frame in `readLoop`. Find the section that processes non-event frames:

```typescript
        const p = this.pending.get(frame.id);
        if (!p) continue;
```

Replace with:

```typescript
        if (isSnapshotResult(frame)) {
          const resolver = this.pendingSnapshots.get(frame.id);
          if (resolver) {
            this.pendingSnapshots.delete(frame.id);
            resolver(frame);
          }
          continue;
        }
        const p = this.pending.get(frame.id);
        if (!p) continue;
```

(d) Implement the public method. Add it after `cancel()`:

```typescript
  async snapshot(): Promise<SnapshotResult> {
    if (this.disposed) {
      return { id: 0, type: 'snapshot_result', ok: false, error: { name: 'RuntimeDisposed', message: 'runtime disposed' } };
    }
    if (!this.alive || !this.child) {
      return { id: 0, type: 'snapshot_result', ok: false, error: { name: 'RuntimeDead', message: 'kernel is not alive' } };
    }
    const id = this.nextId++;
    const result = new Promise<SnapshotResult>((resolve) => {
      this.pendingSnapshots.set(id, resolve);
    });
    try {
      await this.ready;
      const child = this.child;
      if (!child) {
        this.pendingSnapshots.delete(id);
        return { id, type: 'snapshot_result', ok: false, error: { name: 'RuntimeDead', message: 'kernel died before snapshot' } };
      }
      await writeNdjson(child.stdin, { id, type: 'snapshot' });
    } catch (err) {
      this.pendingSnapshots.delete(id);
      const e = err as Error;
      return { id, type: 'snapshot_result', ok: false, error: { name: e.name, message: e.message } };
    }
    return result;
  }
```

(e) Clear pending snapshots when the kernel dies. In `failAllPending()`, after the `this.pending.clear();` line, add:

```typescript
    for (const resolve of this.pendingSnapshots.values()) {
      resolve({ id: 0, type: 'snapshot_result', ok: false, error: { name: err.name, message: err.message } });
    }
    this.pendingSnapshots.clear();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: PASS — all prior tests + the new `snapshot() (1d2)` block green (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/child-process-runtime.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "feat(coworker-scratchpad): ChildProcessRuntime.snapshot() + startup_error rejection"
```

---

## Task 5: `ScratchpadManager` integration — `snapshotThenDispose` + meta.json v2 + divergence

Wire everything through the manager: `scratchpadDir` flows into the spawned runtime, eviction always snapshots first, `meta.json` grows to schema v2, and a fresh spawn computes `cells-since-snapshot` divergence and ingests `runtime.recoveryNotes` into the on-disk `recovery_notes[]` (FIFO capped at 20).

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`. Confirm the file's existing imports cover `existsSync` and `readFileSync` (Task 3 of the 1d plan added `readFileSync`); if they don't, ensure they do.

```typescript
describe('ScratchpadManager (kernel persistence — 1d2)', () => {
  let ws: string;
  let rt: string;
  let m: ScratchpadManager;

  const readMeta = (root: string, name: string): any =>
    JSON.parse(readFileSync(join(root, name, 'meta.json'), 'utf8'));
  const writeMeta = (root: string, name: string, patch: Record<string, unknown>): void => {
    const path = join(root, name, 'meta.json');
    const cur = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...cur, ...patch }, null, 2));
  };

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'spm4-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    rt = await mkdtemp(join(tmpdir(), 'spm4-root-'));
  });
  afterEach(async () => {
    await m?.disposeAll();
    await rm(ws, { recursive: true, force: true });
    await rm(rt, { recursive: true, force: true });
  });

  it('cold→warm restores globalThis after disposeAll on the same root', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'globalThis.x = 1; globalThis.y = { nested: true };');
    await m.disposeAll();

    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    const res = await m.runCell('a', 'return [globalThis.x, globalThis.y?.nested];');
    assert.deepEqual(res.value, [1, true]);
  });

  it('cold→warm restores a DuckDB table after disposeAll', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (1),(2),(3)");');
    await m.disposeAll();

    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    const res = await m.runCell('a', 'const c = await otto.duckdb.connect(); const r = await c.runAndReadAll("SELECT COUNT(*) AS n FROM t"); return Number(r.getRows()[0][0]);');
    assert.equal(res.value, 3);
  });

  it('stamps last_snapshot_cell_id == archive.lastId after eviction', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'globalThis.x = 1;'); // id 1
    await m.runCell('a', 'globalThis.x = 2;'); // id 2
    await m.disposeAll(); // triggers snapshotThenDispose
    const meta = readMeta(rt, 'a');
    assert.equal(meta.schema_version, 2);
    assert.equal(meta.last_snapshot_cell_id, 2);
    assert.ok(typeof meta.last_snapshot_at === 'string');
    assert.equal(meta.kernel_db.present, true);
    assert.equal(meta.namespace.present, true);
  });

  it('records namespace-absent when re-attaching to a dir whose namespace.json was deleted', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'globalThis.x = 1;');
    await m.disposeAll();
    // Simulate corruption / loss between sessions.
    rmSync(join(rt, 'a', 'namespace.json'));

    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    const res = await m.runCell('a', 'return typeof globalThis.x;');
    assert.equal(res.value, 'undefined');
    const meta = readMeta(rt, 'a');
    assert.ok(Array.isArray(meta.recovery_notes));
    assert.equal(meta.recovery_notes.some((n: { kind: string }) => n.kind === 'namespace-absent'), true);
  });

  it('records cells-since-snapshot when the on-disk archive is ahead of last_snapshot_cell_id', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;'); // id 1
    await m.runCell('a', 'return 2;'); // id 2
    await m.disposeAll(); // snapshot stamps last_snapshot_cell_id = 2
    // Simulate two crash-survivor cells appended after the last snapshot.
    writeMeta(rt, 'a', { last_snapshot_cell_id: 0 });

    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 99;'); // forces attach → recovery_notes computed
    const meta = readMeta(rt, 'a');
    const note = meta.recovery_notes.find((n: { kind: string; n?: number }) => n.kind === 'cells-since-snapshot');
    assert.ok(note);
    assert.equal(note.n, 2);
  });

  it('FIFO-caps recovery_notes at 20', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    // Seed 25 prior notes.
    const seeded = Array.from({ length: 25 }, (_, i) => ({ at: new Date(i).toISOString(), kind: 'namespace-absent' }));
    writeMeta(rt, 'a', { recovery_notes: seeded });
    await m.disposeAll();

    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;'); // attach adds at least one new note (cells-since-snapshot may not fire)
    const meta = readMeta(rt, 'a');
    assert.ok(meta.recovery_notes.length <= 20, `expected <= 20, got ${meta.recovery_notes.length}`);
    // Oldest dropped: the first seed (epoch 0) should be gone.
    assert.equal(meta.recovery_notes.some((n: { at?: string }) => n.at === new Date(0).toISOString()), false);
  });

  it('records snapshot-failed when the runtime snapshot returns ok:false', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    // Force the snapshot to fail: kill the runtime's child process before disposeAll calls snapshot().
    const entry = (m as unknown as { entries: Map<string, { runtime: { dispose: () => Promise<void> } | null }> }).entries.get('a')!;
    await entry.runtime!.dispose();
    entry.runtime = null;
    // disposeAll on a cold entry won't snapshot; instead force a snapshot via a fresh warm cycle that then dies.
    // Simpler: directly assert the manager handles ok:false by stubbing snapshotThenDispose's input.
    // We approximate via the public surface: re-warm then dispose with a killed child.
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    const live = await m.getOrAttach('a');
    // Kill the kernel out from under the manager. The next snapshot() resolves ok:false.
    await live.dispose();
    await m.disposeAll(); // should append a 'snapshot-failed' note for 'a', and not throw.
    const meta = readMeta(rt, 'a');
    const note = meta.recovery_notes.find((n: { kind: string }) => n.kind === 'snapshot-failed');
    assert.ok(note, 'expected a snapshot-failed recovery note');
  });
});
```

Add `writeFileSync` and `rmSync` to the existing `node:fs` import in `scratchpad-manager.test.ts` if not present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: FAIL — `scratchpadDir` not threaded into the runtime; no `last_snapshot_cell_id`; `meta.schema_version === 1`; no `recovery_notes[]`.

- [ ] **Step 3: Thread `scratchpadDir` into `spawnRuntime` and pass schema bump**

In `packages/coworker-scratchpad/src/scratchpad-manager.ts`:

(a) Replace the `META_SCHEMA_VERSION = 1` constant near the top:

```typescript
const META_SCHEMA_VERSION = 2;
const MAX_RECOVERY_NOTES = 20;
```

(b) Add a `currentName: string | null` field threaded through the spawn so `spawnRuntime` can include the scratchpad dir. Simpler: change `spawnRuntime` to take a `name` argument. Replace:

```typescript
  private async spawnRuntime(): Promise<ChildProcessRuntime> {
    const rt = new ChildProcessRuntime({ workspace: this.workspace, ...this.runtimeOptions });
    await rt.start();
    return rt;
  }
```

with:

```typescript
  private async spawnRuntime(name: string): Promise<ChildProcessRuntime> {
    const rt = new ChildProcessRuntime({
      workspace: this.workspace,
      scratchpadDir: this.dirFor(name),
      ...this.runtimeOptions,
    });
    await rt.start();
    return rt;
  }
```

(c) Update the two call sites of `spawnRuntime()` to pass the name.

In `getOrAttach`, replace:

```typescript
      existing.runtime = await this.spawnRuntime(); // cold -> warm; empty globalThis (1d gap)
```

with:

```typescript
      existing.runtime = await this.spawnRuntime(name); // cold -> warm; namespace restored from disk (1d2)
      this.ingestRecoveryNotesOnAttach(name, existing);
```

In `attachUnmanaged`, replace:

```typescript
    let runtime: ChildProcessRuntime;
    try {
      runtime = await this.spawnRuntime();
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    this.entries.set(name, { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now) });
    return runtime;
```

with:

```typescript
    let runtime: ChildProcessRuntime;
    try {
      runtime = await this.spawnRuntime(name);
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    const entry: Entry = { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now) };
    this.entries.set(name, entry);
    this.ingestRecoveryNotesOnAttach(name, entry);
    return runtime;
```

- [ ] **Step 4: Implement `snapshotThenDispose`, `applySnapshotToMeta`, and `ingestRecoveryNotesOnAttach`**

Still in `packages/coworker-scratchpad/src/scratchpad-manager.ts`, add these private methods anywhere inside the class (a natural spot is after `writeMeta`):

```typescript
  private appendRecoveryNotes(name: string, notes: RecoveryNote[]): void {
    if (notes.length === 0) return;
    const path = this.metaPath(name);
    if (!existsSync(path)) return; // no meta yet; nothing to attach notes to
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      // corrupt meta -> we'll rewrite below
    }
    const prior = Array.isArray(cur.recovery_notes) ? (cur.recovery_notes as RecoveryNoteEntry[]) : [];
    const stamped: RecoveryNoteEntry[] = notes.map((n) => ({ at: new Date(this.now()).toISOString(), ...n }));
    const merged = [...prior, ...stamped];
    cur.recovery_notes = merged.slice(Math.max(0, merged.length - MAX_RECOVERY_NOTES));
    writeFileSync(path, JSON.stringify(cur, null, 2));
  }

  private applySnapshotToMeta(name: string, entry: Entry, res: Extract<SnapshotResult, { ok: true }>): void {
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    cur.last_snapshot_cell_id = entry.archive.lastId;
    cur.last_snapshot_at = res.snapshotted_at;
    cur.namespace_skipped = res.skipped;
    cur.namespace = { present: true, schema_version: 1 };
    cur.kernel_db = { present: existsSync(join(this.dirFor(name), 'kernel.db')), path: 'kernel.db' };
    writeFileSync(path, JSON.stringify(cur, null, 2));
  }

  private async snapshotThenDispose(name: string, entry: Entry): Promise<void> {
    if (!entry.runtime) return;
    const res = await entry.runtime.snapshot();
    if (res.ok) {
      this.applySnapshotToMeta(name, entry, res);
    } else {
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: res.error.message }]);
    }
    await entry.runtime.dispose();
    entry.runtime = null; // cold; lock RETAINED (Model A)
  }

  private ingestRecoveryNotesOnAttach(name: string, entry: Entry): void {
    const notes: RecoveryNote[] = [...entry.runtime!.recoveryNotes];
    // Divergence: compare archive.lastId to last_snapshot_cell_id on disk.
    const path = this.metaPath(name);
    if (existsSync(path)) {
      try {
        const cur = JSON.parse(readFileSync(path, 'utf8')) as { last_snapshot_cell_id?: unknown };
        const last = cur.last_snapshot_cell_id;
        const archiveId = entry.archive.lastId;
        if (typeof last === 'number' && typeof archiveId === 'number' && archiveId > last) {
          notes.push({ kind: 'cells-since-snapshot', n: archiveId - last });
        }
      } catch {
        // ignore; covered by the namespace-corrupt note path
      }
    }
    this.appendRecoveryNotes(name, notes);
  }
```

(b) Add the imports / type aliases at the top of the file. Extend the protocol import:

```typescript
import type { RecoveryNote, SnapshotResult } from './kernel-protocol.js';
```

And add a tiny on-disk-shape type below the other interfaces:

```typescript
type RecoveryNoteEntry = RecoveryNote & { at: string };
```

- [ ] **Step 5: Replace eviction call sites with `snapshotThenDispose`**

Still in `scratchpad-manager.ts`:

(a) In `evictLruIfNeeded()`, replace:

```typescript
      await victim.runtime!.dispose();
      victim.runtime = null; // cold; lock RETAINED (Model A)
```

with:

```typescript
      // The map key for the LRU victim is needed for snapshotThenDispose; find it now.
      let victimName: string | null = null;
      for (const [n, e] of this.entries) { if (e === victim) { victimName = n; break; } }
      if (victimName === null) break; // defensive; should be impossible
      await this.snapshotThenDispose(victimName, victim);
```

(b) In `evictIdle()`, replace:

```typescript
      if (e.lastUsedAt <= cutoff) {
        await e.runtime.dispose();
        e.runtime = null; // cold; lock RETAINED (Model A)
      }
```

with:

```typescript
      if (e.lastUsedAt <= cutoff) {
        // Find the name for this entry to feed snapshotThenDispose.
        let entryName: string | null = null;
        for (const [n, ent] of this.entries) { if (ent === e) { entryName = n; break; } }
        if (entryName !== null) await this.snapshotThenDispose(entryName, e);
      }
```

(c) In `disposeAll()`, replace:

```typescript
    for (const [name, e] of this.entries) {
      await e.runtime?.dispose();
      releaseLock(this.dirFor(name)); // release lock; leave meta.json (durable)
    }
```

with:

```typescript
    for (const [name, e] of this.entries) {
      if (e.runtime) await this.snapshotThenDispose(name, e);
      releaseLock(this.dirFor(name)); // release lock; leave meta.json (durable)
    }
```

- [ ] **Step 6: Update `writeMeta` to bump schema and stamp `kernel_db.present` / `namespace.present`**

Still in `scratchpad-manager.ts`, in `writeMeta`, replace the final `meta` literal:

```typescript
    const meta = {
      name,
      created_at,
      last_used: nowIso,
      attached_sessions,
      size_bytes: this.dirSize(dir),
      schema_version: META_SCHEMA_VERSION,
    };
    writeFileSync(path, JSON.stringify(meta, null, 2));
```

with this version, which also preserves the v2 fields written by `applySnapshotToMeta` / `appendRecoveryNotes`:

```typescript
    let prevExtras: Record<string, unknown> = {};
    if (existsSync(path)) {
      try {
        const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        for (const k of ['last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes']) {
          if (k in prev) prevExtras[k] = prev[k];
        }
      } catch {
        // corrupt meta -> drop extras
      }
    }
    const meta = {
      name,
      created_at,
      last_used: nowIso,
      attached_sessions,
      size_bytes: this.dirSize(dir),
      schema_version: META_SCHEMA_VERSION,
      ...prevExtras,
      kernel_db: { present: existsSync(join(dir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dir, 'namespace.json')), schema_version: 1 },
    };
    writeFileSync(path, JSON.stringify(meta, null, 2));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: PASS — all prior `scratchpad-manager` tests + the new `kernel persistence — 1d2` block green (`# fail 0`). Then run it 3–5× for the flake watch:

```bash
for i in 1 2 3 4 5; do node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts || break; done
```

- [ ] **Step 8: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "feat(coworker-scratchpad): ScratchpadManager snapshotThenDispose + meta.json v2 + divergence"
```

---

## Task 6: Barrel exports + full gates

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`

- [ ] **Step 1: Extend the barrel**

In `packages/coworker-scratchpad/src/index.ts`, extend the kernel-protocol re-export block. Replace:

```typescript
export {
  isDataLoadEvent,
  isProgressEvent,
  type RunRequest,
  type KernelRequest,
  type ResultOk,
  type ResultErr,
  type ResultResponse,
  type DataLoadDrawer,
  type ReadyEvent,
  type DataLoadEvent,
  type ProgressEvent,
  type KernelEvent,
  type KernelFrame,
} from './kernel-protocol.js';
```

with:

```typescript
export {
  isDataLoadEvent,
  isProgressEvent,
  isStartupErrorEvent,
  isSnapshotResult,
  type RunRequest,
  type SnapshotRequest,
  type KernelRequest,
  type ResultOk,
  type ResultErr,
  type ResultResponse,
  type SnapshotResultOk,
  type SnapshotResultErr,
  type SnapshotResult,
  type SkippedKey,
  type RecoveryNote,
  type StartupErrorEvent,
  type DataLoadDrawer,
  type ReadyEvent,
  type DataLoadEvent,
  type ProgressEvent,
  type KernelEvent,
  type KernelFrame,
} from './kernel-protocol.js';
```

Append at the end of the file:

```typescript
export {
  NAMESPACE_SCHEMA_VERSION,
  encodeNamespace,
  decodeNamespace,
  type NamespaceEnvelope,
  type EncodeResult,
  type DecodeResult,
} from './namespace-codec.js';
```

- [ ] **Step 2: Build the package**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0; emits `dist/namespace-codec.*` (new), updates `dist/kernel-protocol.*`, `dist/kernel-entry.*`, `dist/child-process-runtime.*`, `dist/scratchpad-manager.*`, `dist/cell-archive.*`, `dist/index.*`. Fix any reported type error before proceeding — do not silence it.

- [ ] **Step 3: Run the workspace-package test gate**

Run: `npm run test:packages`
Expected: passes; `@otto/coworker-scratchpad` now reports **12** test files (the 11 from 1d + `namespace-codec.test.ts` + `kernel-protocol.test.ts` — note `kernel-protocol.test.ts` is new in this phase, so the count is 13; expected: 13 test files). Zero failures.

- [ ] **Step 4: Verify workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.`

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export namespace-codec + protocol additions from barrel"
```

---

## Self-Review

**1. Spec coverage (§3, §4, §5, §6, §8 of the brainstorm spec):**
- §3.1 v8-inside-JSON envelope → Task 1 (`namespace-codec.ts`, encode/decode), Task 3 (kernel-entry uses `decodeNamespace` on startup), Task 4 (kernel-entry uses `encodeNamespace` in the snapshot handler). ✓
- §3.2 `otto.duckdb` pre-opened `DuckDBInstance` → Task 3 Step 4 (`openKernelDb` in kernel-entry). ✓
- §3.3 Spec-aligned snapshot triggers (idle + LRU + disposeAll) → Task 5 Step 5 (`evictLruIfNeeded`, `evictIdle`, `disposeAll` all route to `snapshotThenDispose`). ✓
- §3.4 Best-effort recovery + meta.json divergence → Task 3 (kernel collects notes), Task 5 (`ingestRecoveryNotesOnAttach`, `cells-since-snapshot` divergence, FIFO cap at 20). ✓
- §3.5 Kernel owns its own state-file disk I/O → Task 3 Step 4 (kernel writes namespace.json inside `writeNamespaceSnapshot`). ✓
- §4.1 argv[3] = scratchpadDir → Task 3 Step 3(e), Step 4(b). ✓
- §4.2 NDJSON snapshot request/response → Task 2 types, Task 3 kernel handler, Task 4 runtime `snapshot()`. ✓
- §4.3 `scratchpadDir` opt, `snapshot()` method, `recoveryNotes` getter, `startup_error` → Task 3 + Task 4. ✓
- §4.4 `ScratchpadManager` integration (`snapshotThenDispose`, cold→warm passes scratchpadDir, `ingestRecoveryNotesOnAttach`) → Task 5. ✓
- §4.5 `CellArchive.lastId` → Task 2. ✓
- §4.6 `namespace-codec.ts` → Task 1. ✓
- §5 `meta.json` schema v2 with the six new fields + FIFO cap at 20 + forward-preserves unknown fields → Task 5 Step 4 + Step 6 + Step 7. ✓
- §6 failure-mode table — all rows mapped to a recovery note kind: namespace-absent (Task 3), namespace-corrupt (Task 3), snapshot-failed (Task 5), cells-since-snapshot (Task 5), namespace_skipped (Task 4 → Task 5 applies to meta). DuckDB hard fail → Task 4 Step 1 startup_error test. trailing-corrupt cells.jsonl → already covered by 1d's CellArchive.scan. ✓
- §8 test plan — Task 1 covers codec roundtrip; Task 2 covers protocol guards + lastId; Task 3 covers live-kernel DuckDB persistence and namespace restore; Task 4 covers snapshot() and startup_error; Task 5 covers cold→warm restore, divergence, FIFO cap, snapshot-failed; Task 6 covers backward compat (via the existing 1d tests staying green under the full test gate). ✓

**2. Placeholder scan:** No TBD / TODO / "add error handling" / "similar to" / "implement later". Every step's code block is complete; every run step shows the exact command + expected output. ✓

**3. Type consistency:**
- `SkippedKey { key, ctor, reason }` — single canonical definition in `namespace-codec.ts` (Task 1). `kernel-protocol.ts` (Task 2 Step 3) re-exports it from there, so `SnapshotResult.skipped` and `encodeNamespace`'s return are the same nominal type. The Task 6 barrel re-exports it via `kernel-protocol`. No type-checker collision. ✓
- `RecoveryNote` — defined in `kernel-protocol.ts` (Task 2), consumed by `kernel-entry.ts` (Task 3 Step 4), `child-process-runtime.ts` (Task 3 Step 3, Task 4 Step 3), `scratchpad-manager.ts` (Task 5). All call sites match the discriminated union. The on-disk shape `RecoveryNoteEntry` (`RecoveryNote & { at: string }`) is local to `scratchpad-manager.ts`. ✓
- `SnapshotResult` — defined in `kernel-protocol.ts` (Task 2), consumed by `child-process-runtime.ts` (Task 4) and `scratchpad-manager.ts` (Task 5). `applySnapshotToMeta` narrows to `Extract<SnapshotResult, { ok: true }>` which matches `SnapshotResultOk`. ✓
- `ScratchpadManagerOptions.runtimeOptions` already exists from 1c2 and now (via Task 5 Step 3) the manager forces `scratchpadDir = this.dirFor(name)` on every spawn. If a caller passes a `runtimeOptions.scratchpadDir`, it's overridden by the manager — documented by the test `cold→warm` + `DuckDB persistence` which never pass it. ✓
- `Entry.archive` and `archive.lastId` — `lastId` is exposed in Task 2; used by Task 5's `applySnapshotToMeta` and `ingestRecoveryNotesOnAttach`. ✓
- `now()` plumbing — `CellArchive`, `writeMeta`, `appendRecoveryNotes`, and `applySnapshotToMeta` all use `this.now()` (or accept it from the manager); test 5 controls timestamps where they matter (FIFO cap, divergence). ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-coworker-phase-1d2-kernel-persistence.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints for review.

Which approach?
