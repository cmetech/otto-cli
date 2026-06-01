# Otto Co-Worker Phase 1a — Collector Facade + FileCollector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the scratchpad's data-ingestion layer — a generic `CollectorRegistry` plus the v1 `FileCollector` that enumerates, opens, and watches files under `<workspace>/.otto/inputs/` — so later Phase 1 sub-plans (the kernel subprocess) can bind `otto.collectors`.

**Architecture:** The collector facade types already exist as interfaces in `@otto/coworker-types` (`Collector`, `CollectorRegistry`, `DataSource`, `DataSourceRef`, `CollectorCapabilities`). This sub-plan ships their concrete implementations inside `@otto/coworker-scratchpad`: a kind detector, the `FileCollector`, and the `DefaultCollectorRegistry`. No subprocess, no DuckDB, no heavy deps — this slice is pure data access and is independently testable. It is the first of ~5 Phase 1 sub-plans (1a: this; 1b: kernel subprocess + NDJSON; 1c: ScratchpadManager pool/locks; 1d: DuckDB + namespace + cells persistence; 1e: `/sp` commands + tool surface + MIME bundle).

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+, `node:test` + `node:assert/strict`. `chokidar@^5` (already a root dependency) for file watching. Imports cross workspace packages via `@otto/coworker-types`.

**Spec reference:** `otto-cli/docs/superpowers/specs/2026-05-30-otto-coworker-design.md` — §2.4 "Collector facade", §3.3 on-disk layout (`<workspace>/.otto/inputs/`), Phase 1 row in §8.

---

## Canonical commands

This repo has **no `tsx`**. Run a single package `.ts` test from the repo root with Node's native type-stripping plus the repo's `.js→.ts` resolver (verified working on Node v22.22.3):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<FILE>.test.ts
```

Build the package:

```bash
npm run build:coworker-scratchpad
```

Run the workspace-package test gate (compiles, then runs every linkable package's tests):

```bash
npm run test:packages
```

> Note: a bare `npm install` fails on the pre-existing `scripts/install.js` postinstall EACCES (copying `rg` into `~/.otto/agent/bin`). It is unrelated to this work; use `npm install --ignore-scripts` when a dependency change requires an install. The `@otto/coworker-*` workspace symlinks and `chokidar` are already present in root `node_modules`, so no install is strictly required for this sub-plan.

---

## File structure

```
packages/coworker-scratchpad/
  package.json                 ← Modify: declare workspace + chokidar deps (Task 1)
  src/
    detect-kind.ts             ← Create: extension → DataKind mapping (Task 2)
    detect-kind.test.ts        ← Create (Task 2)
    file-collector.ts          ← Create: FileCollector implements Collector (Task 3)
    file-collector.test.ts     ← Create (Task 3)
    collector-registry.ts      ← Create: DefaultCollectorRegistry implements CollectorRegistry (Task 4)
    collector-registry.test.ts ← Create (Task 4)
    index.ts                   ← Modify: replace `export {}` barrel with real exports (Task 5)
    index.test.ts              ← Delete: phase-0 empty-barrel smoke test, superseded (Task 5)
```

Each file has one responsibility: `detect-kind` is the pure ext→kind function, `file-collector` is the filesystem-backed `Collector`, `collector-registry` is the generic registry. The barrel re-exports them.

---

## Task 1: Declare package dependencies

**Files:**
- Modify: `packages/coworker-scratchpad/package.json`

- [ ] **Step 1: Add dependencies block**

Edit `packages/coworker-scratchpad/package.json`. After the `"otto"` block and before `"main"`, insert a `"dependencies"` block, and keep everything else unchanged:

```json
{
  "name": "@otto/coworker-scratchpad",
  "version": "0.0.1",
  "description": "Otto co-worker package: coworker-scratchpad",
  "type": "module",
  "otto": {
    "linkable": true,
    "scope": "@otto",
    "name": "coworker-scratchpad"
  },
  "dependencies": {
    "@otto/coworker-types": "*",
    "@otto/coworker-utils": "*",
    "chokidar": "^5.0.0"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:publish": "tsc -p tsconfig.publish.json"
  },
  "files": ["dist"]
}
```

- [ ] **Step 2: Refresh workspace links (scripts skipped to avoid the known postinstall EACCES)**

Run: `npm install --ignore-scripts`
Expected: completes without error; `node_modules/@otto/coworker-types`, `@otto/coworker-utils`, and `chokidar` resolve.

Verify: `node -e "require.resolve('chokidar'); console.log('ok')"` prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add packages/coworker-scratchpad/package.json package-lock.json
git commit -m "build(coworker-scratchpad): declare types/utils/chokidar deps"
```

---

## Task 2: Kind detector

Maps a file path or `file://` URI to one of the six v1 `DataKind`s the FileCollector supports. Unsupported extensions return `null` so the collector can skip them.

**Files:**
- Create: `packages/coworker-scratchpad/src/detect-kind.ts`
- Test: `packages/coworker-scratchpad/src/detect-kind.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/detect-kind.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectKind, FILE_COLLECTOR_KINDS } from './detect-kind.js';

describe('detectKind', () => {
  it('maps each supported extension to its DataKind', () => {
    assert.equal(detectKind('/x/cmdb.csv'), 'csv');
    assert.equal(detectKind('/x/report.xlsx'), 'xlsx');
    assert.equal(detectKind('/x/data.json'), 'json');
    assert.equal(detectKind('/x/big.parquet'), 'parquet');
    assert.equal(detectKind('/x/notes.txt'), 'txt');
    assert.equal(detectKind('/x/README.md'), 'md');
  });

  it('is case-insensitive on the extension', () => {
    assert.equal(detectKind('/x/CMDB.CSV'), 'csv');
  });

  it('handles file:// URIs and strips query/hash', () => {
    assert.equal(detectKind('file:///workspace/.otto/inputs/a.csv'), 'csv');
    assert.equal(detectKind('file:///x/a.json?v=2#top'), 'json');
  });

  it('returns null for unsupported or extensionless paths', () => {
    assert.equal(detectKind('/x/report.pdf'), null);
    assert.equal(detectKind('/x/Makefile'), null);
    assert.equal(detectKind('/x/archive.tar.gz'), null);
  });

  it('exposes the supported kinds as a stable list', () => {
    assert.deepEqual([...FILE_COLLECTOR_KINDS].sort(), ['csv', 'json', 'md', 'parquet', 'txt', 'xlsx']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/detect-kind.test.ts`
Expected: FAIL — cannot find module `./detect-kind.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/detect-kind.ts`:

```typescript
import type { DataKind } from '@otto/coworker-types';

const EXT_TO_KIND: Record<string, DataKind> = {
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.json': 'json',
  '.parquet': 'parquet',
  '.txt': 'txt',
  '.md': 'md',
};

// The six file kinds FileCollector enumerates. (DataKind also includes
// rest/mcp-resource/acp-stream, which belong to future non-file collectors.)
export const FILE_COLLECTOR_KINDS: readonly DataKind[] = ['csv', 'xlsx', 'json', 'parquet', 'txt', 'md'];

export function detectKind(pathOrUri: string): DataKind | null {
  const clean = pathOrUri.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = clean.slice(dot).toLowerCase();
  return EXT_TO_KIND[ext] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/detect-kind.test.ts`
Expected: PASS — `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/detect-kind.ts packages/coworker-scratchpad/src/detect-kind.test.ts
git commit -m "feat(coworker-scratchpad): add file-kind detector"
```

---

## Task 3: FileCollector

Implements the `Collector` interface against the filesystem. Enumerates supported files under `<workspace>/.otto/inputs/` (recursively), opens them as a `DataSource` whose `load()` returns parsed JSON, text strings, or raw `Buffer`s by kind, and watches a single file for changes via chokidar.

**Files:**
- Create: `packages/coworker-scratchpad/src/file-collector.ts`
- Test: `packages/coworker-scratchpad/src/file-collector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/file-collector.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileCollector } from './file-collector.js';

let workspace: string;
let inputs: string;

async function collectRefs(it: AsyncIterable<{ uri: string; kind: string; bytes?: number; metadata: unknown }>) {
  const out = [];
  for await (const ref of it) out.push(ref);
  return out;
}

describe('FileCollector', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'fc-ws-'));
    inputs = join(workspace, '.otto', 'inputs');
    await mkdir(inputs, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('describe() advertises file:// support, the six kinds, watching, no streaming', () => {
    const fc = new FileCollector({ workspace });
    const cap = fc.describe();
    assert.deepEqual(cap.supports_uris, ['file://*']);
    assert.deepEqual([...cap.supports_kinds].sort(), ['csv', 'json', 'md', 'parquet', 'txt', 'xlsx']);
    assert.equal(cap.supports_streaming, false);
    assert.equal(cap.supports_watching, true);
  });

  it('list() yields refs only for supported files, recursively, skipping unsupported', async () => {
    await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n1,2\n');
    await writeFile(join(inputs, 'notes.txt'), 'hi');
    await writeFile(join(inputs, 'ignore.pdf'), 'x');
    await mkdir(join(inputs, 'nested'), { recursive: true });
    await writeFile(join(inputs, 'nested', 'data.json'), '{"k":1}');

    const fc = new FileCollector({ workspace });
    const refs = await collectRefs(fc.list());
    const byKind = Object.fromEntries(refs.map((r) => [r.kind, r]));

    assert.deepEqual(Object.keys(byKind).sort(), ['csv', 'json', 'txt']);
    assert.equal(byKind.csv.collector, 'file');
    assert.equal(byKind.csv.uri, pathToFileURL(join(inputs, 'cmdb.csv')).href);
    assert.equal(byKind.csv.bytes, 8);
    assert.deepEqual(byKind.csv.metadata, {});
    assert.equal(typeof byKind.csv.modified, 'string');
  });

  it('list() honors the limit option', async () => {
    await writeFile(join(inputs, 'a.csv'), 'x');
    await writeFile(join(inputs, 'b.csv'), 'x');
    await writeFile(join(inputs, 'c.csv'), 'x');
    const fc = new FileCollector({ workspace });
    const refs = await collectRefs(fc.list({ limit: 2 }));
    assert.equal(refs.length, 2);
  });

  it('list() yields nothing when the inputs dir does not exist', async () => {
    await rm(inputs, { recursive: true, force: true });
    const fc = new FileCollector({ workspace });
    const refs = await collectRefs(fc.list());
    assert.deepEqual(refs, []);
  });

  it('open().load() parses JSON, returns text as string, and binary as Buffer', async () => {
    await writeFile(join(inputs, 'd.json'), '{"hello":"world"}');
    await writeFile(join(inputs, 'd.csv'), 'a,b\n1,2\n');
    await writeFile(join(inputs, 'd.parquet'), Buffer.from([0x50, 0x41, 0x52, 0x31]));
    const fc = new FileCollector({ workspace });

    const byKind = Object.fromEntries((await collectRefs(fc.list())).map((r) => [r.kind, r]));

    const json = await (await fc.open(byKind.json as never)).load();
    assert.deepEqual(json, { hello: 'world' });

    const csv = await (await fc.open(byKind.csv as never)).load();
    assert.equal(csv, 'a,b\n1,2\n');

    const parquet = await (await fc.open(byKind.parquet as never)).load();
    assert.ok(Buffer.isBuffer(parquet));
    assert.deepEqual(parquet, Buffer.from([0x50, 0x41, 0x52, 0x31]));
  });

  it('watch() invokes onChange when the file is modified and unsubscribe stops it', async () => {
    const file = join(inputs, 'live.csv');
    await writeFile(file, 'v1');
    const fc = new FileCollector({ workspace });
    const ref = (await collectRefs(fc.list()))[0];

    const changed = new Promise<void>((resolve) => {
      const unsub = fc.watch(ref as never, () => {
        unsub();
        resolve();
      });
      // Give chokidar a moment to register before mutating.
      setTimeout(() => void writeFile(file, 'v2-longer'), 300);
    });

    await changed; // test times out (and fails) if onChange never fires
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/file-collector.test.ts`
Expected: FAIL — cannot find module `./file-collector.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/file-collector.ts`:

```typescript
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { watch as chokidarWatch } from 'chokidar';
import type {
  Collector,
  CollectorCapabilities,
  DataSource,
  DataSourceRef,
  ListOpts,
  Unsubscribe,
} from '@otto/coworker-types';
import { detectKind, FILE_COLLECTOR_KINDS } from './detect-kind.js';

const TEXT_KINDS = new Set(['csv', 'txt', 'md']);

export interface FileCollectorOptions {
  /** Absolute path to the workspace root. inputs/ resolves to <workspace>/.otto/inputs. */
  workspace: string;
}

export class FileCollector implements Collector {
  readonly id = 'file';
  readonly kind = 'file' as const;
  private readonly inputsDir: string;

  constructor(opts: FileCollectorOptions) {
    this.inputsDir = join(opts.workspace, '.otto', 'inputs');
  }

  describe(): CollectorCapabilities {
    return {
      supports_uris: ['file://*'],
      supports_kinds: [...FILE_COLLECTOR_KINDS],
      supports_streaming: false,
      supports_watching: true,
    };
  }

  async *list(opts?: ListOpts): AsyncIterable<DataSourceRef> {
    let remaining = opts?.limit ?? Number.POSITIVE_INFINITY;
    if (remaining <= 0) return;
    const prefixDir = opts?.prefix ? join(this.inputsDir, opts.prefix) : this.inputsDir;
    for await (const abs of walk(this.inputsDir)) {
      if (opts?.prefix && !abs.startsWith(prefixDir)) continue;
      const kind = detectKind(abs);
      if (!kind) continue;
      const st = await stat(abs);
      yield {
        collector: this.id,
        uri: pathToFileURL(abs).href,
        kind,
        bytes: st.size,
        modified: st.mtime.toISOString(),
        metadata: {},
      };
      remaining -= 1;
      if (remaining <= 0) return;
    }
  }

  async open(ref: DataSourceRef): Promise<DataSource> {
    const abs = fileURLToPath(ref.uri);
    const kind = ref.kind;
    return {
      ref,
      async load(): Promise<Buffer | string | object> {
        if (kind === 'json') {
          return JSON.parse(await readFile(abs, 'utf8')) as object;
        }
        if (TEXT_KINDS.has(kind)) {
          return readFile(abs, 'utf8');
        }
        return readFile(abs); // Buffer for xlsx/parquet
      },
    };
  }

  watch(ref: DataSourceRef, onChange: (ref: DataSourceRef) => void): Unsubscribe {
    const abs = fileURLToPath(ref.uri);
    const watcher = chokidarWatch(abs, { ignoreInitial: true });
    const handler = async (): Promise<void> => {
      try {
        const st = await stat(abs);
        onChange({ ...ref, bytes: st.size, modified: st.mtime.toISOString() });
      } catch {
        onChange(ref);
      }
    };
    watcher.on('change', () => void handler());
    watcher.on('add', () => void handler());
    return () => {
      void watcher.close();
    };
  }
}

async function* walk(dir: string): AsyncIterable<string> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // inputs/ may not exist yet — yield nothing
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/file-collector.test.ts`
Expected: PASS — `# pass 6`, `# fail 0`. (The `watch()` test may take ~0.5s.)

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/file-collector.ts packages/coworker-scratchpad/src/file-collector.test.ts
git commit -m "feat(coworker-scratchpad): add FileCollector over .otto/inputs"
```

---

## Task 4: DefaultCollectorRegistry

The generic registry the kernel will hold. `register`/`list`/`get` are a thin `Map`. `resolve(uri)` finds the collector whose `supports_uris` patterns match the URI, then scans that collector's `list()` for the matching ref — using only the public `Collector` interface, so future collectors need no registry changes.

**Files:**
- Create: `packages/coworker-scratchpad/src/collector-registry.ts`
- Test: `packages/coworker-scratchpad/src/collector-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/collector-registry.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DefaultCollectorRegistry, uriMatchesPattern } from './collector-registry.js';
import { FileCollector } from './file-collector.js';

describe('uriMatchesPattern', () => {
  it('matches trailing-wildcard prefixes', () => {
    assert.equal(uriMatchesPattern('file:///x/a.csv', 'file://*'), true);
    assert.equal(uriMatchesPattern('http://x/a', 'file://*'), false);
  });
  it('matches exact patterns without a wildcard', () => {
    assert.equal(uriMatchesPattern('mcp://res', 'mcp://res'), true);
    assert.equal(uriMatchesPattern('mcp://other', 'mcp://res'), false);
  });
});

describe('DefaultCollectorRegistry', () => {
  it('registers, lists, and gets collectors by id', () => {
    const reg = new DefaultCollectorRegistry();
    const fc = new FileCollector({ workspace: '/tmp/x' });
    reg.register(fc);
    assert.equal(reg.get('file'), fc);
    assert.equal(reg.get('nope'), null);
    assert.deepEqual(reg.list().map((c) => c.id), ['file']);
  });

  describe('resolve()', () => {
    let workspace: string;
    let inputs: string;

    beforeEach(async () => {
      workspace = await mkdtemp(join(tmpdir(), 'reg-ws-'));
      inputs = join(workspace, '.otto', 'inputs');
      await mkdir(inputs, { recursive: true });
    });
    afterEach(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it('resolves a known file:// uri to its collector + ref', async () => {
      await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n');
      const reg = new DefaultCollectorRegistry();
      reg.register(new FileCollector({ workspace }));
      const uri = pathToFileURL(join(inputs, 'cmdb.csv')).href;
      const hit = await reg.resolve(uri);
      assert.ok(hit);
      assert.equal(hit.collector.id, 'file');
      assert.equal(hit.ref.uri, uri);
      assert.equal(hit.ref.kind, 'csv');
    });

    it('returns null for an unknown file under a matching collector', async () => {
      const reg = new DefaultCollectorRegistry();
      reg.register(new FileCollector({ workspace }));
      const missing = pathToFileURL(join(inputs, 'absent.csv')).href;
      assert.equal(await reg.resolve(missing), null);
    });

    it('returns null when no collector matches the uri scheme', async () => {
      const reg = new DefaultCollectorRegistry();
      reg.register(new FileCollector({ workspace }));
      assert.equal(await reg.resolve('http://example.com/x.csv'), null);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/collector-registry.test.ts`
Expected: FAIL — cannot find module `./collector-registry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/collector-registry.ts`:

```typescript
import type { Collector, CollectorRegistry, DataSourceRef } from '@otto/coworker-types';

export function uriMatchesPattern(uri: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return uri.startsWith(pattern.slice(0, -1));
  return uri === pattern;
}

export class DefaultCollectorRegistry implements CollectorRegistry {
  private readonly collectors = new Map<string, Collector>();

  register(collector: Collector): void {
    this.collectors.set(collector.id, collector);
  }

  list(): Collector[] {
    return [...this.collectors.values()];
  }

  get(id: string): Collector | null {
    return this.collectors.get(id) ?? null;
  }

  async resolve(uri: string): Promise<{ collector: Collector; ref: DataSourceRef } | null> {
    for (const collector of this.collectors.values()) {
      const patterns = collector.describe().supports_uris;
      if (!patterns.some((p) => uriMatchesPattern(uri, p))) continue;
      for await (const ref of collector.list()) {
        if (ref.uri === uri) return { collector, ref };
      }
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/collector-registry.test.ts`
Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/collector-registry.ts packages/coworker-scratchpad/src/collector-registry.test.ts
git commit -m "feat(coworker-scratchpad): add DefaultCollectorRegistry with uri resolve"
```

---

## Task 5: Wire the barrel, retire the empty-barrel smoke test, verify build + gate

The phase-0 `index.test.ts` asserts the barrel is empty (`Object.keys(mod) === []`). That assertion is now false, so delete it — the three new test files provide real coverage and keep the workspace-coverage gate green.

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`
- Delete: `packages/coworker-scratchpad/src/index.test.ts`

- [ ] **Step 1: Replace the barrel**

Overwrite `packages/coworker-scratchpad/src/index.ts` with:

```typescript
export { detectKind, FILE_COLLECTOR_KINDS } from './detect-kind.js';
export { FileCollector, type FileCollectorOptions } from './file-collector.js';
export { DefaultCollectorRegistry, uriMatchesPattern } from './collector-registry.js';
```

- [ ] **Step 2: Delete the obsolete smoke test**

Run: `git rm packages/coworker-scratchpad/src/index.test.ts`
Expected: file removed.

- [ ] **Step 3: Build the package (type-checks the cross-package imports)**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0, emits `packages/coworker-scratchpad/dist/index.js` + `.d.ts` for each module.

- [ ] **Step 4: Run the workspace-package test gate**

Run: `npm run test:packages`
Expected: passes; `@otto/coworker-scratchpad` now reports 3 test files run (detect-kind, file-collector, collector-registry) with zero failures, and `verify-workspace-coverage` still reports `All 15 linkable packages have test coverage.`

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export collector facade from barrel"
```

---

## Self-Review

**1. Spec coverage (§2.4 collector facade):**
- `Collector` / `CollectorRegistry` / `DataSource` / `DataSourceRef` / `CollectorCapabilities` — implemented as `FileCollector` + `DefaultCollectorRegistry` (interfaces pre-exist in `@otto/coworker-types`). ✓
- v1 `FileCollector` watches `<workspace>/.otto/inputs/` recursively, supports csv/xlsx/json/parquet/txt/md, uses chokidar — Tasks 2–3. ✓ (Spec also lists the `inputs/` location in §3.3.)
- `otto.collectors.list()` / single-tool enumeration — the registry surfaces `list()` and `resolve()`; binding into `otto.collectors` happens in sub-plan 1b (kernel), out of scope here. ✓ (deferred, noted)
- Layer-B `data_load` drawer on cell load — belongs to the kernel + memory contract (sub-plan 1b + Phase 3), out of scope here. ✓ (deferred, noted)
- Future `ServiceNow`/`MCP`/`ACP` collectors — facade is generic; `resolve()` uses only the public interface, so no rewrite needed. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `detectKind` / `FILE_COLLECTOR_KINDS` defined in Task 2 are imported unchanged in Task 3 and re-exported in Task 5. `FileCollector` / `FileCollectorOptions` defined in Task 3 are imported in Task 4's tests and re-exported in Task 5. `uriMatchesPattern` / `DefaultCollectorRegistry` defined in Task 4 are re-exported in Task 5. `DataKind`, `Collector`, `CollectorRegistry`, `DataSource`, `DataSourceRef`, `CollectorCapabilities`, `ListOpts`, `Unsubscribe` all come from `@otto/coworker-types` with the signatures shown in the spec. ✓

**Deferred to later Phase 1 sub-plans (intentionally out of scope for 1a):** kernel subprocess + NDJSON protocol (1b), `otto.collectors` cell binding + Layer-B `data_load` drawer (1b), ScratchpadManager pool/LRU/locks/heartbeat (1c), DuckDB `kernel.db` + `namespace.json` + `cells.jsonl` persistence (1d), `/sp` slash commands + `scratchpad` tool + MIME bundle output (1e).
