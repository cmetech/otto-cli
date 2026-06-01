# Otto Co-Worker Phase 1d — Pre-Bound Data Libs + `cells.jsonl` Archive + Full `meta.json` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scratchpad cells *useful* (pre-bound data libraries in the kernel) and *auditable* (durable append-only Layer-D `cells.jsonl` history + a complete `meta.json`), without yet adding kernel-state persistence (that is 1d2).

**Architecture:** Three additive pieces over the 1c2 `ScratchpadManager` + 1b/1c kernel. (1) A new `kernel-bindings.ts` imports the data libs once and exposes them as a record that `kernel-entry.ts` spreads into the persistent `vm` sandbox — so every cell sees `polars`, `DuckDB`, `ExcelJS`, `dateFns`, `lodash`, `zod`, `axios`. (2) A new `CellArchive` class owns one scratchpad's `cells.jsonl` (header line + append-only entries with a linear `id`/`parentId` chain; it scans the existing file on construction so ids/links survive re-attach). (3) `ScratchpadManager` gains `runCell(name, code)` — the single funnel that get-or-attaches the kernel, runs the cell, appends to that scratchpad's `CellArchive`, and rewrites the full `meta.json`. The raw `ChildProcessRuntime` stays generic and untouched.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+. New runtime deps (root `package.json`): `nodejs-polars`, `exceljs`, `date-fns`, `lodash`, `zod`, `axios`; `@duckdb/node-api` is already a root dep. `node:test` + `node:assert/strict`. Builds on 1b's kernel + 1c2's `ScratchpadManager`/`scratchpad-lock`.

**Spec reference:** `otto-cli/docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (line 298 pre-bound bindings `polars`/`DuckDB`/`ExcelJS`/`date-fns`/`lodash`/`zod`/`axios` + `otto.*`), §3.3 (on-disk layout — `cells.jsonl`, `meta.json` = `name, created_at, last_used, attached_sessions[], lock_holder, size_bytes`), §3.4 (cell history = JSONL append-only with `id`/`parentId`), §3.4c (schema versioning: JSONL first-line header `{type:"header",version:N}`; JSON files top-level `schema_version`), §8 line 813 (Phase 1 milestone: "loads CSV via FileCollector, queries with polars/DuckDB").

**Design decisions (resolved in brainstorm — 2026-05-31):**
1. **Phase 1 slice split:** 1d = data-libs binding + `cells.jsonl` + full `meta.json`; **1d2** = `kernel.db` (DuckDB on-disk) + `namespace.json` snapshot/restore + snapshot triggers + crash recovery. This plan is **1d only**.
2. **`cells.jsonl` owner = `ScratchpadManager.runCell(name, code)`.** The manager owns the on-disk dir, so it owns the archive. `getOrAttach` still returns the raw runtime for direct access; only cells routed through `runCell` are recorded. `ChildProcessRuntime` stays generic (workspace-only).
3. **Full `meta.json` now (all three growth fields):** optional `sessionId?` manager-ctor arg → `attached_sessions[]` (added-on-attach, deduped, never auto-removed in this slice — detach is 1e); `last_used` updated on each `runCell`; `size_bytes` = sum of scratchpad-dir file sizes recomputed on each meta write. `lock_holder` is already satisfied by the separate `lock.json` (1c2), so it is **not** duplicated into `meta.json`.
4. **DuckDB binds as an in-memory-capable lib here.** Pointing it at an on-disk `kernel.db` is 1d2; this slice only proves the binding is present and usable.
5. **`cells.jsonl` is a linear chain in 1d** (`parentId` = previous entry's `id`, `null` for the first). Cell-tree navigation / `/sp fork` branching is 1e.

**Known intentional gaps (deferred):**
- No kernel-state persistence: a cold→warm re-spawn still starts with an empty `globalThis` (1c2 gap, closed in **1d2**).
- `stdout` is stored inline in `cells.jsonl`; output-spill to `artifact://` (the otto-artifacts pillar) is later. Entries are not size-capped in 1d.
- `attached_sessions` is append-only here; removal on `/sp detach` is **1e**.

---

## Scope

**In scope (1d):**
- `kernel-bindings.ts` — imports the 7 data libs and exposes `buildDataLibBindings()` returning a `Record<string, unknown>`.
- `kernel-entry.ts` — spread those bindings into the persistent `vm` sandbox.
- Root `package.json` — add the 6 missing deps.
- `cell-archive.ts` — `CellArchive` class + `CellEntry` type + `CELLS_SCHEMA_VERSION`.
- `scratchpad-manager.ts` — `runCell(name, code, opts?)`; `sessionId?` ctor option; per-entry `CellArchive`; full-`meta.json` writer (`last_used`, `attached_sessions`, `size_bytes`, `schema_version`).
- Barrel exports for the new surface.

**Explicitly deferred (NOT in 1d):** `kernel.db` / `namespace.json` snapshot+restore / snapshot triggers / crash recovery → **1d2**. `/sp` commands, cell-tree projection, `/sp fork`, output-spill → **1e**.

---

## Canonical commands

Same harness as 1a–1c2. Run a single package `.ts` test from the repo root:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<FILE>.test.ts
```

Build the package / run the gates:

```bash
npm run build:coworker-scratchpad
npm run test:packages
npm run verify:workspace-coverage
```

> **Prerequisite (unchanged):** the kernel imports `@otto/coworker-utils` at runtime — if a test errors with "Cannot find module '@otto/coworker-utils'", run `npm run build:coworker-utils` once.
>
> **New in 1d — native addons:** `nodejs-polars` and `@duckdb/node-api` ship native binaries. After Task 1's `npm install`, if a data-libs cell errors with a load/ABI error, that is Risk #1/#2 from the spec — record it and fall back per the spec (`sql.js` for DuckDB). Do **not** silence it.

---

## File structure

```
packages/coworker-scratchpad/src/
  kernel-bindings.ts            ← Create: import + expose the 7 data libs (Task 1)
  kernel-bindings.test.ts       ← Create: assert all 7 keys present (Task 1)
  kernel-entry.ts               ← Modify: spread data-lib bindings into sandbox (Task 1)
  cell-archive.ts               ← Create: cells.jsonl writer (Task 2)
  cell-archive.test.ts          ← Create: archive tests (Task 2)
  scratchpad-manager.ts         ← Modify: runCell + sessionId + full meta.json (Task 3)
  scratchpad-manager.test.ts    ← Modify: cells + meta tests (Task 3)
  index.ts                      ← Modify: export CellArchive surface (Task 4)
<repo root>/package.json        ← Modify: add 6 deps (Task 1)
```

Four tasks: Task 1 installs + binds the data libs (proved via a real kernel cell per lib). Task 2 is the standalone `CellArchive` (testable in isolation). Task 3 funnels cells through the manager and grows `meta.json`. Task 4 wires the barrel and runs the gates.

---

## Task 1: Install + pre-bind the data libraries

Make every cell see `polars`, `DuckDB`, `ExcelJS`, `dateFns`, `lodash`, `zod`, `axios`.

**Files:**
- Modify: `<repo root>/package.json`
- Create: `packages/coworker-scratchpad/src/kernel-bindings.ts`
- Create: `packages/coworker-scratchpad/src/kernel-bindings.test.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-entry.ts`

- [ ] **Step 1: Install the dependencies**

Run from the repo root:

```bash
npm install nodejs-polars exceljs date-fns lodash zod axios
npm install -D @types/lodash
```

Expected: `package.json` `dependencies` now lists `nodejs-polars`, `exceljs`, `date-fns`, `lodash`, `zod`, `axios` (alongside the existing `@duckdb/node-api`), `devDependencies` lists `@types/lodash`, and `package-lock.json` is updated. If `nodejs-polars` or DuckDB fails to build a native binary, STOP and report (Risk #1/#2) — do not proceed.

- [ ] **Step 2: Write the failing test**

Create `packages/coworker-scratchpad/src/kernel-bindings.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDataLibBindings } from './kernel-bindings.js';

describe('kernel-bindings', () => {
  it('exposes all seven pre-bound data libraries', () => {
    const b = buildDataLibBindings();
    for (const key of ['polars', 'DuckDB', 'ExcelJS', 'dateFns', 'lodash', 'zod', 'axios']) {
      assert.ok(key in b, `missing binding: ${key}`);
      assert.notEqual(b[key], undefined, `binding is undefined: ${key}`);
    }
  });

  it('binds usable shapes (polars.DataFrame, zod.string, dateFns.format)', () => {
    const b = buildDataLibBindings() as Record<string, any>;
    assert.equal(typeof b.polars.DataFrame, 'function');
    assert.equal(typeof b.zod.string, 'function');
    assert.equal(typeof b.dateFns.format, 'function');
    assert.equal(typeof b.lodash.chunk, 'function');
    assert.equal(typeof b.axios.get, 'function');
    assert.equal(typeof b.ExcelJS.Workbook, 'function');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-bindings.test.ts`
Expected: FAIL — cannot find module `./kernel-bindings.js`.

- [ ] **Step 4: Write the bindings module**

Create `packages/coworker-scratchpad/src/kernel-bindings.ts`:

```typescript
import pl from 'nodejs-polars';
import ExcelJS from 'exceljs';
import lodash from 'lodash';
import axios from 'axios';
import { z } from 'zod';
import * as dateFns from 'date-fns';
import * as DuckDB from '@duckdb/node-api';

/**
 * The data libraries pre-bound into every scratchpad cell's vm sandbox.
 * DuckDB is bound as an in-memory-capable lib here; on-disk kernel.db wiring is 1d2.
 */
export function buildDataLibBindings(): Record<string, unknown> {
  return {
    polars: pl,
    DuckDB,
    ExcelJS,
    dateFns,
    lodash,
    zod: z,
    axios,
  };
}
```

> **Note on import styles:** `lodash`/`exceljs`/`axios` are CJS default imports (rely on `esModuleInterop`, already on for this package since 1b imports work the same way). `date-fns` and `@duckdb/node-api` are namespace imports. If the strip-types loader rejects a default import at runtime, switch that one to `import * as X` and read `X.default ?? X` — but try the above first.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-bindings.test.ts`
Expected: PASS — `# pass 2`, `# fail 0`.

- [ ] **Step 6: Wire the bindings into the kernel sandbox**

In `packages/coworker-scratchpad/src/kernel-entry.ts`, add the import after the existing imports (after the `import type ... kernel-protocol.js` line):

```typescript
import { buildDataLibBindings } from './kernel-bindings.js';
```

Then change the `sandbox` declaration (currently the object literal starting `const sandbox: Record<string, unknown> = {`) to spread the data libs in. Replace:

```typescript
const sandbox: Record<string, unknown> = {
  otto: { collectors: ottoCollectors },
  // Timers are not part of a fresh vm context; bind the host ones so async cells
  // (await new Promise((r) => setTimeout(r, ...))) and progress() heartbeats work.
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
```

with:

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
```

- [ ] **Step 7: Add a real-kernel data-libs test**

Append this test file `packages/coworker-scratchpad/src/kernel-bindings.test.ts` is unit-level; now prove the libs work *inside a live kernel*. Append a new `describe` block to the **end** of `packages/coworker-scratchpad/src/child-process-runtime.test.ts`, after its final `});`:

```typescript
describe('data-lib bindings inside a live kernel', () => {
  let ws: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-libs-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
  });

  it('polars / lodash / zod / date-fns / exceljs / axios / DuckDB are bound', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, inactivityTimeoutMs: 20_000, cellTimeoutMs: 20_000 });
    await rt.start();
    assert.equal((await rt.runCell('return polars.DataFrame({ a: [1, 2, 3] }).height;')).value, 3);
    assert.equal((await rt.runCell('return lodash.chunk([1, 2, 3, 4], 2).length;')).value, 2);
    assert.equal((await rt.runCell('return zod.string().parse("hi");')).value, 'hi');
    assert.equal((await rt.runCell('return dateFns.format(new Date(0), "yyyy");')).value, '1970');
    assert.equal((await rt.runCell('const wb = new ExcelJS.Workbook(); wb.addWorksheet("s"); const buf = await wb.xlsx.writeBuffer(); return buf.byteLength > 0;')).value, true);
    assert.equal((await rt.runCell('return typeof axios.get;')).value, 'function');
    assert.equal((await rt.runCell('return typeof DuckDB.DuckDBInstance;')).value, 'function');
  });
});
```

> This block reuses the imports already at the top of `child-process-runtime.test.ts` (`describe`/`it`/`beforeEach`/`afterEach`, `assert`, `mkdtemp`/`mkdir`/`rm`, `tmpdir`, `join`, and `ChildProcessRuntime`). If any of those is not already imported there, add it to the existing import block — do not duplicate import statements.

- [ ] **Step 8: Run the kernel data-libs test**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: PASS — all prior tests plus the new `data-lib bindings inside a live kernel` suite green (`# fail 0`). First run may be slow while native addons load.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json packages/coworker-scratchpad/src/kernel-bindings.ts packages/coworker-scratchpad/src/kernel-bindings.test.ts packages/coworker-scratchpad/src/kernel-entry.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "feat(coworker-scratchpad): pre-bind polars/duckdb/exceljs/date-fns/lodash/zod/axios into the kernel"
```

---

## Task 2: `CellArchive` — append-only `cells.jsonl` writer

A standalone, dependency-free Layer-D writer. `cells.jsonl` lives at `<dir>/cells.jsonl`: a first-line schema header, then one JSON object per cell. On construction it scans any existing file so `id`/`parentId` continue across re-attach.

**Files:**
- Create: `packages/coworker-scratchpad/src/cell-archive.ts`
- Create: `packages/coworker-scratchpad/src/cell-archive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/cell-archive.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CellArchive, CELLS_SCHEMA_VERSION } from './cell-archive.js';

let dir: string;
const lines = (p: string): string[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
const cellsPath = (): string => join(dir, 'cells.jsonl');

describe('CellArchive', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cells-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a schema header once, then a first entry with id 1 / parentId null', () => {
    const a = new CellArchive(dir, () => 1000);
    const e = a.append({ code: 'return 1;', ok: true, value: 1, stdout: '' });
    assert.equal(e.id, 1);
    assert.equal(e.parentId, null);
    const ls = lines(cellsPath());
    assert.deepEqual(JSON.parse(ls[0]), { type: 'header', version: CELLS_SCHEMA_VERSION });
    const rec = JSON.parse(ls[1]);
    assert.equal(rec.id, 1);
    assert.equal(rec.ok, true);
    assert.equal(rec.value, 1);
    assert.equal(rec.ts, new Date(1000).toISOString());
  });

  it('chains parentId to the previous entry', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    const second = a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(second.id, 2);
    assert.equal(second.parentId, 1);
  });

  it('records a failed cell with ok:false and an error (no value)', () => {
    const a = new CellArchive(dir, () => 0);
    const e = a.append({ code: 'throw 1', ok: false, error: { name: 'Error', message: 'boom' }, stdout: '' });
    assert.equal(e.ok, false);
    assert.equal(e.error!.message, 'boom');
    assert.equal('value' in e, false);
  });

  it('continues ids across a fresh archive over the same file (re-attach durability)', () => {
    const a1 = new CellArchive(dir, () => 0);
    a1.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1
    a1.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2
    const a2 = new CellArchive(dir, () => 0); // re-attach: scans existing file
    const next = a2.append({ code: 'c', ok: true, value: null, stdout: '' });
    assert.equal(next.id, 3);
    assert.equal(next.parentId, 2);
    assert.equal(lines(cellsPath()).filter((l) => l.includes('"id"')).length, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-archive.test.ts`
Expected: FAIL — cannot find module `./cell-archive.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/coworker-scratchpad/src/cell-archive.ts`:

```typescript
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CELLS_SCHEMA_VERSION = 1;

export interface CellEntry {
  id: number;
  parentId: number | null;
  code: string;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  stdout: string;
  ts: string;
}

export interface AppendInput {
  code: string;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  stdout: string;
}

export class CellArchive {
  private readonly path: string;
  private nextId: number;
  private lastId: number | null;

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    this.path = join(dir, 'cells.jsonl');
    const { nextId, lastId } = this.scan();
    this.nextId = nextId;
    this.lastId = lastId;
  }

  private scan(): { nextId: number; lastId: number | null } {
    if (!existsSync(this.path)) return { nextId: 1, lastId: null };
    let lastId: number | null = null;
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { id?: unknown };
        if (typeof obj.id === 'number') lastId = obj.id;
      } catch {
        // header or corrupt line -> ignore
      }
    }
    return { nextId: (lastId ?? 0) + 1, lastId };
  }

  private ensureHeader(): void {
    if (existsSync(this.path)) return;
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.path, JSON.stringify({ type: 'header', version: CELLS_SCHEMA_VERSION }) + '\n');
  }

  append(input: AppendInput): CellEntry {
    this.ensureHeader();
    const id = this.nextId++;
    const entry: CellEntry = {
      id,
      parentId: this.lastId,
      code: input.code,
      ok: input.ok,
      ...(input.ok ? { value: input.value } : { error: input.error }),
      stdout: input.stdout,
      ts: new Date(this.now()).toISOString(),
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.lastId = id;
    return entry;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-archive.test.ts`
Expected: PASS — `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/cell-archive.ts packages/coworker-scratchpad/src/cell-archive.test.ts
git commit -m "feat(coworker-scratchpad): CellArchive — append-only cells.jsonl with id/parentId chain"
```

---

## Task 3: `ScratchpadManager.runCell` + full `meta.json`

Funnel cells through the manager so they land in `cells.jsonl`, and grow `meta.json` to the full shape.

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Add the failing tests**

Append a new `describe` block to the **end** of `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the existing `describe('ScratchpadManager (idle eviction)', …)` block). It reuses the file's existing imports (`describe`/`it`/`beforeEach`/`afterEach`, `assert`, `mkdtemp`/`mkdir`/`rm`, `existsSync`, `tmpdir`, `join`, `ScratchpadManager`) and adds one new import — add `readFileSync` to the existing `import { existsSync } from 'node:fs';` line so it reads `import { existsSync, readFileSync } from 'node:fs';`:

```typescript
describe('ScratchpadManager (cells + meta)', () => {
  let ws: string;
  let rt: string;
  let m: ScratchpadManager;

  const cellsLines = (root: string, name: string): string[] =>
    readFileSync(join(root, name, 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  const readMeta = (root: string, name: string): any =>
    JSON.parse(readFileSync(join(root, name, 'meta.json'), 'utf8'));

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'spm3-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    rt = await mkdtemp(join(tmpdir(), 'spm3-root-'));
  });
  afterEach(async () => {
    await m?.disposeAll();
    await rm(ws, { recursive: true, force: true });
    await rm(rt, { recursive: true, force: true });
  });

  it('runCell runs the cell and records it to cells.jsonl', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt });
    const res = await m.runCell('a', 'return 6 * 7;');
    assert.equal(res.value, 42);
    const ls = cellsLines(rt, 'a');
    assert.deepEqual(JSON.parse(ls[0]), { type: 'header', version: 1 });
    const rec = JSON.parse(ls[1]);
    assert.equal(rec.id, 1);
    assert.equal(rec.parentId, null);
    assert.equal(rec.ok, true);
    assert.equal(rec.value, 42);
  });

  it('chains a second cell as id 2 / parentId 1', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt });
    await m.runCell('a', 'return 1;');
    await m.runCell('a', 'return 2;');
    const recs = cellsLines(rt, 'a').filter((l) => l.includes('"id"')).map((l) => JSON.parse(l));
    assert.equal(recs[1].id, 2);
    assert.equal(recs[1].parentId, 1);
  });

  it('records a failed cell (ok:false + error) and still rethrows', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt });
    await assert.rejects(() => m.runCell('a', 'throw new Error("boom");'), /boom/);
    const rec = JSON.parse(cellsLines(rt, 'a').filter((l) => l.includes('"id"'))[0]);
    assert.equal(rec.ok, false);
    assert.match(rec.error.message, /boom/);
  });

  it('writes a full meta.json with attached_sessions, last_used, size_bytes', async () => {
    let t = 5000;
    m = new ScratchpadManager({ workspace: ws, root: rt, sessionId: 'sess-1', now: () => t });
    await m.runCell('a', 'return 1;');
    const meta = readMeta(rt, 'a');
    assert.equal(meta.name, 'a');
    assert.ok(meta.created_at);
    assert.equal(meta.last_used, new Date(5000).toISOString());
    assert.deepEqual(meta.attached_sessions, ['sess-1']);
    assert.ok(meta.size_bytes > 0);
    assert.equal(meta.schema_version, 1);
  });

  it('continues cell ids across a fresh manager on the same root', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt });
    await m.runCell('a', 'return 1;'); // id 1
    await m.disposeAll();
    m = new ScratchpadManager({ workspace: ws, root: rt });
    await m.runCell('a', 'return 2;'); // id 2 (archive scanned the existing file)
    const recs = cellsLines(rt, 'a').filter((l) => l.includes('"id"')).map((l) => JSON.parse(l));
    assert.equal(recs.length, 2);
    assert.equal(recs[1].id, 2);
    assert.equal(recs[1].parentId, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: FAIL — `m.runCell` is not a function; `sessionId` option has no effect; `meta.json` lacks the new fields.

- [ ] **Step 3: Update imports + constants**

In `packages/coworker-scratchpad/src/scratchpad-manager.ts`:

(a) Replace the `node:fs` import line:

```typescript
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
```

with:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

(b) Add the `CellArchive` import after the `scratchpad-lock.js` import:

```typescript
import { CellArchive } from './cell-archive.js';
```

(c) Add a meta schema constant next to `DEFAULT_MAX_LIVE` / `DEFAULT_IDLE_MS` / `DEFAULT_SWEEP_MS`:

```typescript
const META_SCHEMA_VERSION = 1;
```

- [ ] **Step 4: Extend options, Entry, and the constructor**

(a) Add `sessionId` to `ScratchpadManagerOptions` (after `runtimeOptions`):

```typescript
export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  idleMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  sessionId?: string;
}
```

(b) Add `archive` to the `Entry` interface:

```typescript
interface Entry {
  runtime: ChildProcessRuntime | null; // null when cold (evicted, lock retained)
  lock: LockInfo;
  lastUsedAt: number;
  archive: CellArchive;
}
```

(c) Add a `sessionId` field and assign it in the constructor. Add the field next to `idleMs`:

```typescript
  protected readonly idleMs: number;
  protected readonly sessionId: string | undefined;
```

and in the constructor body (after `this.runtimeOptions = options.runtimeOptions ?? {};`):

```typescript
    this.sessionId = options.sessionId;
```

- [ ] **Step 5: Replace `writeMetaIfAbsent` with a full `writeMeta` + add `dirSize`**

Replace the entire `writeMetaIfAbsent` method:

```typescript
  private writeMetaIfAbsent(name: string): void {
    const path = this.metaPath(name);
    if (existsSync(path)) return;
    mkdirSync(this.dirFor(name), { recursive: true });
    writeFileSync(path, JSON.stringify({ name, created_at: new Date(this.now()).toISOString() }, null, 2));
  }
```

with:

```typescript
  private dirSize(dir: string): number {
    let total = 0;
    try {
      for (const f of readdirSync(dir)) {
        try {
          total += statSync(join(dir, f)).size;
        } catch {
          // file vanished between readdir and stat -> skip
        }
      }
    } catch {
      // dir does not exist yet -> 0
    }
    return total;
  }

  private writeMeta(name: string): void {
    const dir = this.dirFor(name);
    const path = this.metaPath(name);
    mkdirSync(dir, { recursive: true });
    const nowIso = new Date(this.now()).toISOString();
    let created_at = nowIso;
    let attached_sessions: string[] = [];
    if (existsSync(path)) {
      try {
        const prev = JSON.parse(readFileSync(path, 'utf8')) as {
          created_at?: string;
          attached_sessions?: string[];
        };
        if (typeof prev.created_at === 'string') created_at = prev.created_at;
        if (Array.isArray(prev.attached_sessions)) attached_sessions = prev.attached_sessions;
      } catch {
        // corrupt meta -> rewrite fresh
      }
    }
    if (this.sessionId && !attached_sessions.includes(this.sessionId)) {
      attached_sessions.push(this.sessionId);
    }
    const meta = {
      name,
      created_at,
      last_used: nowIso,
      attached_sessions,
      size_bytes: this.dirSize(dir),
      schema_version: META_SCHEMA_VERSION,
    };
    writeFileSync(path, JSON.stringify(meta, null, 2));
  }
```

- [ ] **Step 6: Create the archive on attach + add `runCell`**

(a) In `attachUnmanaged`, change the body so it writes full meta and stores an archive on the entry. Replace:

```typescript
    this.writeMetaIfAbsent(name);
    await this.evictLruIfNeeded();
    let runtime: ChildProcessRuntime;
    try {
      runtime = await this.spawnRuntime();
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    this.entries.set(name, { runtime, lock, lastUsedAt: this.now() });
    return runtime;
```

with:

```typescript
    this.writeMeta(name);
    await this.evictLruIfNeeded();
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

(b) Add the `runCell` method immediately after `getOrAttach`:

```typescript
  async runCell(name: string, code: string, opts: AttachOptions = {}): Promise<{ value: unknown; stdout: string }> {
    this.assertNotDisposed();
    const runtime = await this.getOrAttach(name, opts);
    const entry = this.entries.get(name)!;
    entry.lastUsedAt = this.now();
    try {
      const result = await runtime.runCell(code);
      entry.archive.append({ code, ok: true, value: result.value, stdout: result.stdout });
      this.writeMeta(name);
      return result;
    } catch (err) {
      const e = err as Error;
      entry.archive.append({ code, ok: false, error: { name: e.name, message: e.message }, stdout: '' });
      this.writeMeta(name);
      throw err;
    }
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: PASS — `# pass 19`, `# fail 0` (11 core/LRU + 3 idle + 5 cells/meta). Run it 3–5 times (timing-sensitive eviction tests, per the 1c2 flakiness watch):

```bash
for i in 1 2 3 4 5; do node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts || break; done
```

- [ ] **Step 8: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "feat(coworker-scratchpad): ScratchpadManager.runCell records cells.jsonl + full meta.json"
```

---

## Task 4: Export new surface, verify build + gates

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`

- [ ] **Step 1: Extend the barrel**

In `packages/coworker-scratchpad/src/index.ts`, append at the end of the file:

```typescript
export {
  CellArchive,
  CELLS_SCHEMA_VERSION,
  type CellEntry,
  type AppendInput,
} from './cell-archive.js';
export { buildDataLibBindings } from './kernel-bindings.js';
```

- [ ] **Step 2: Build the package**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0; emits `dist/cell-archive.*`, `dist/kernel-bindings.*`, re-emits `dist/kernel-entry.*`, `dist/scratchpad-manager.*`, `dist/index.*`. Fix any reported type error before proceeding — do not silence it.

- [ ] **Step 3: Run the workspace-package test gate**

Run: `npm run test:packages`
Expected: passes; `@otto/coworker-scratchpad` now reports **11** test files (the 9 from 1c2 + `kernel-bindings.test.ts` + `cell-archive.test.ts`) with zero failures.

- [ ] **Step 4: Verify workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.`

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export CellArchive + data-lib bindings from barrel"
```

---

## Self-Review

**1. Spec coverage (§2.4 / §3.3 / §3.4 / §3.4c / §8):**
- Pre-bound `polars`/`DuckDB`/`ExcelJS`/`date-fns`(→`dateFns`)/`lodash`/`zod`/`axios` in every cell — `buildDataLibBindings` spread into the `vm` sandbox (Task 1, tested both as a unit and inside a live kernel). ✓
- `cells.jsonl` append-only with `id`/`parentId` + schema header — `CellArchive` (Task 2, tested: header-once, chain, failed-cell, re-attach id continuity). ✓
- `meta.json` = `name, created_at, last_used, attached_sessions[], size_bytes` (+ `schema_version`) — `writeMeta` (Task 3, tested). `lock_holder` intentionally lives in `lock.json` (1c2), not duplicated. ✓
- Schema versioning — JSONL header `{type:"header",version:1}` (Task 2) + JSON `schema_version:1` (Task 3). ✓
- Phase-1 milestone "loads CSV via FileCollector, queries with polars/DuckDB" — FileCollector (1a) + `otto.collectors` (1b) are bound; polars + DuckDB now bound (Task 1). End-to-end *persistence* of query results to `kernel.db` is 1d2. ✓ (binding half; persistence half deferred by design)
- `kernel.db` / `namespace.json` / snapshot triggers / crash recovery — **out of scope**, listed as 1d2. ✓
- `/sp` commands / cell-tree / `/sp fork` / output-spill — **out of scope**, listed as 1e. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Every code step shows complete code; every run step shows the exact command + expected result. The one import-style caveat in Task 1 Step 4 gives concrete fallback instructions, not a placeholder. ✓

**3. Type consistency:** `buildDataLibBindings(): Record<string, unknown>` is defined in Task 1 and imported by `kernel-entry.ts` (Task 1) + re-exported (Task 4). `CellArchive` / `CellEntry` / `AppendInput` / `CELLS_SCHEMA_VERSION` defined in Task 2, consumed by `scratchpad-manager.ts` (Task 3, `new CellArchive(dir, this.now)` + `.append({ code, ok, value?|error?, stdout })` matching `AppendInput`), re-exported in Task 4. `Entry` gains `archive: CellArchive` (Task 3) and every `entries.set(...)` provides it (only `attachUnmanaged` constructs entries; `getOrAttach`'s cold→warm path mutates `existing.runtime` and reuses the existing `archive`). `ScratchpadManagerOptions.sessionId` (Task 3) is consumed by `writeMeta` and exercised by the Task 3 test that constructs `{ sessionId: 'sess-1' }`. `runCell(name, code, opts?)` returns `{ value, stdout }` (the `ChildProcessRuntime.CellResult` shape). `now()` is threaded into `CellArchive` (`ts`), `writeMeta` (`last_used`/`created_at`), and existing manager bookkeeping. ✓
