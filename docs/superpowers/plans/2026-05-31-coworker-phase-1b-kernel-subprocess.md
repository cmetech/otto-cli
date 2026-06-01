# Otto Co-Worker Phase 1b — Kernel Subprocess + NDJSON Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the scratchpad's execution layer — a `node` **child-process kernel** that evaluates "cells" in a persistent `globalThis` namespace, speaks **NDJSON over stdio**, binds `otto.collectors` (the 1a registry) into the cell context, and emits a Layer-B `data_load` event whenever a cell loads data through a collector.

**Architecture:** Two halves talking NDJSON. The **child** (`kernel-entry.ts`) holds a `vm` context that persists across cells, exposes `otto.collectors.{list,open}`, and writes result/event frames to stdout. The **parent** (`child-process-runtime.ts`) spawns the child with a filtered environment + filtered `execArgv`, correlates `run`→`result` frames by id, forwards `data_load` events to an injected callback, and enforces a per-cell wall-clock timeout. The collector facade (`DefaultCollectorRegistry` + `FileCollector`) from sub-plan 1a is reused verbatim — instantiated **inside** the child so filesystem reads happen in the kernel process.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+, `node:vm`, `node:child_process`, `node:test` + `node:assert/strict`. NDJSON via `@otto/coworker-utils` (`writeNdjson`/`readNdjson`, spec §6.3). No DuckDB, no polars, no pool/locks — those are later sub-plans.

**Spec reference:** `otto-cli/docs/superpowers/specs/2026-05-30-otto-coworker-design.md` — §2.4 "`otto-scratchpad` — stateful TypeScript kernel" (ChildProcessRuntime, NDJSON over stdio, persistent globalThis, `otto.collectors` binding, env filtering, `data_load` drawer in the Collector facade subsection), §6.3 "NDJSON over stdio for any subprocess wire protocol".

---

## Scope

**In scope (1b):** the kernel child process; NDJSON request/response/event protocol; persistent `globalThis` namespace across cells; `otto.collectors.{list,open}` cell binding (reusing 1a); `data_load` event emission on collector load; environment + `execArgv` filtering at spawn; a basic per-cell **total wall-clock** timeout (kills the child on expiry).

**Explicitly deferred (NOT in 1b):**
- `ScratchpadManager` pool / LRU eviction / exclusive locks / heartbeat / auto-restart → **1c**
- Two-tier timeout (inactivity + `progress()` heartbeat), cancellation escalation (SIGINT→SIG_IGN→SIGTERM), idle eviction snapshot → **1c**
- DuckDB `kernel.db` persistence, `namespace.json` snapshot/restore, `cells.jsonl` archive → **1d**
- Pre-bound data libs (`polars`, `DuckDB`, `ExcelJS`, `date-fns`, `lodash`, `zod`, `axios`) → **1d**
- Real `MemoryRecorder` / Layer-B SQLite backend wiring (1b only **emits** the `data_load` drawer to an injected `onDataLoad` callback; persistence is Phase 3)
- `data_load` drawer `schema` field + full `rows_loaded` introspection (best-effort only in 1b; real schema arrives with DuckDB in 1d)
- `/sp` slash commands, the `scratchpad` tool surface, MIME bundle output → **1e**

---

## Canonical commands

Same harness as sub-plan 1a. Run a single package `.ts` test from the repo root with Node's type-stripping plus the repo's `.js→.ts` resolver (verified on Node v22.22.3):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<FILE>.test.ts
```

Build the package:

```bash
npm run build:coworker-scratchpad
```

Run the workspace-package test gate (compiles to `dist-test/`, then runs every linkable package's compiled tests):

```bash
npm run test:packages
```

> **Prerequisite for the standalone command:** the child kernel imports `@otto/coworker-utils` at **runtime** (for `writeNdjson`/`readNdjson`). That bare specifier is **not** rewritten by the test loader — it resolves to the package's built `dist`. `@otto/coworker-utils/dist` is already built (Phase 0), but if a kernel test errors with "Cannot find module '@otto/coworker-utils'", run `npm run build:coworker-utils` once. The `test:packages` gate compiles everything, so this only affects the standalone command.

> **No `npm install` needed:** 1a already declared `@otto/coworker-types`, `@otto/coworker-utils`, and `chokidar` in `package.json`. 1b adds no new dependencies.

> **Spawn mechanics (already validated):** the parent resolves the kernel entry next to itself (`kernel-entry.js` if present, else `kernel-entry.ts`) and spawns `process.execPath` with a **filtered** `execArgv` that forwards loader flags (`--import`, `--experimental-strip-types`, …) but drops `--test`. Under the gate this runs compiled `kernel-entry.js` with an empty `execArgv`; under the standalone command it runs `kernel-entry.ts` through the same loader the parent uses. Both paths were verified with a throwaway spike before this plan was written.

---

## File structure

```
packages/coworker-scratchpad/src/
  kernel-protocol.ts          ← Create: NDJSON message types + isDataLoadEvent guard (Task 1)
  kernel-protocol.test.ts     ← Create (Task 1)
  kernel-spawn.ts             ← Create: filterEnv + kernelExecArgv + resolveKernelEntry (Task 2)
  kernel-spawn.test.ts        ← Create (Task 2)
  kernel-entry.ts             ← Create: the child process (vm context, otto.collectors, NDJSON loop) (Task 3)
  kernel-entry.test.ts        ← Create: spawns the entry directly, speaks NDJSON (Task 3)
  child-process-runtime.ts    ← Create: the parent runtime (runCell/dispose/onDataLoad/timeout) (Task 4)
  child-process-runtime.test.ts ← Create (Task 4)
  index.ts                    ← Modify: add the four new exports (Task 5)
```

Each file has one responsibility: `kernel-protocol` is the shared wire vocabulary, `kernel-spawn` is the pure spawn-argument/env logic, `kernel-entry` is the child, `child-process-runtime` is the parent. The barrel re-exports the public surface.

---

## Task 1: Kernel wire protocol

The NDJSON message vocabulary shared by parent and child. Three frame families: a `run` **request** (parent→child), a `result` **response** (child→parent, correlated by `id`), and unsolicited **events** (child→parent: `ready` once at startup, `data_load` per collector load). A type guard lets the parent route `data_load` events.

**Files:**
- Create: `packages/coworker-scratchpad/src/kernel-protocol.ts`
- Test: `packages/coworker-scratchpad/src/kernel-protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/kernel-protocol.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDataLoadEvent } from './kernel-protocol.js';
import type { DataLoadEvent, ReadyEvent, ResultOk } from './kernel-protocol.js';

describe('isDataLoadEvent', () => {
  it('returns true for a data_load event frame', () => {
    const frame: DataLoadEvent = {
      type: 'event',
      event: 'data_load',
      drawer: {
        kind: 'data_load',
        collector: 'file',
        uri: 'file:///x/a.csv',
        bytes: 8,
        rows_loaded: null,
        loaded_at: '2026-05-31T00:00:00.000Z',
        schema: null,
      },
    };
    assert.equal(isDataLoadEvent(frame), true);
  });

  it('returns false for the ready event frame', () => {
    const frame: ReadyEvent = { type: 'event', event: 'ready' };
    assert.equal(isDataLoadEvent(frame), false);
  });

  it('returns false for a result frame', () => {
    const frame: ResultOk = { id: 1, type: 'result', ok: true, value: 42, stdout: '' };
    assert.equal(isDataLoadEvent(frame), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-protocol.test.ts`
Expected: FAIL — cannot find module `./kernel-protocol.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/kernel-protocol.ts`:

```typescript
// NDJSON wire protocol between the scratchpad parent runtime and the kernel child.
// One JSON object per line (\n terminated). See spec §2.4 + §6.3.

export interface RunRequest {
  id: number;
  type: 'run';
  code: string;
}
export type KernelRequest = RunRequest;

export interface ResultOk {
  id: number;
  type: 'result';
  ok: true;
  value: unknown;
  stdout: string;
}
export interface ResultErr {
  id: number;
  type: 'result';
  ok: false;
  error: { name: string; message: string; stack?: string };
}
export type ResultResponse = ResultOk | ResultErr;

// Layer-B drawer payload recorded when a cell loads data through a collector.
// `schema` is always null in Phase 1b; real schema introspection arrives with
// DuckDB in sub-plan 1d.
export interface DataLoadDrawer {
  kind: 'data_load';
  collector: string;
  uri: string;
  bytes: number | null;
  rows_loaded: number | null;
  loaded_at: string;
  schema: null;
}

export interface ReadyEvent {
  type: 'event';
  event: 'ready';
}
export interface DataLoadEvent {
  type: 'event';
  event: 'data_load';
  drawer: DataLoadDrawer;
}
export type KernelEvent = ReadyEvent | DataLoadEvent;

export type KernelFrame = ResultResponse | KernelEvent;

export function isDataLoadEvent(frame: KernelFrame): frame is DataLoadEvent {
  return frame.type === 'event' && frame.event === 'data_load';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-protocol.test.ts`
Expected: PASS — `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-protocol.ts packages/coworker-scratchpad/src/kernel-protocol.test.ts
git commit -m "feat(coworker-scratchpad): add kernel NDJSON wire protocol"
```

---

## Task 2: Spawn arguments + environment filtering

Pure, side-effect-light helpers the parent uses to spawn the child safely:
- `filterEnv` — environment allowlist/denylist at kernel spawn (spec §2.4: allow `PATH`/`HOME`/`TERM`/locale/`NODE_*`, allow-prefixes `LC_`/`XDG_`/`OTTO_` — which covers vault-injected `OTTO_DS_*` — and strip known API keys).
- `kernelExecArgv` — forward only loader-relevant flags (`--import`, `--experimental-strip-types`, …) to the child and **drop `--test`** (otherwise the child, launched under `node --test`, would itself try to run as a test runner).
- `resolveKernelEntry` — pick the kernel entry file that exists next to this module: compiled `kernel-entry.js` (dist / dist-test) or source `kernel-entry.ts` (standalone loader run).

**Files:**
- Create: `packages/coworker-scratchpad/src/kernel-spawn.ts`
- Test: `packages/coworker-scratchpad/src/kernel-spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/kernel-spawn.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { basename, isAbsolute } from 'node:path';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';

describe('filterEnv', () => {
  it('keeps allowlisted vars, allow-prefixed vars, and strips everything else', () => {
    const out = filterEnv({
      PATH: '/usr/bin',
      HOME: '/home/x',
      LC_ALL: 'en_US.UTF-8',
      OTTO_DS_servicenow_prod__token: 'injected',
      NODE_OPTIONS: '--max-old-space-size=512',
      RANDOM_THING: 'nope',
      ANTHROPIC_API_KEY: 'secret',
    });
    assert.equal(out.PATH, '/usr/bin');
    assert.equal(out.HOME, '/home/x');
    assert.equal(out.LC_ALL, 'en_US.UTF-8');
    assert.equal(out.OTTO_DS_servicenow_prod__token, 'injected');
    assert.equal(out.NODE_OPTIONS, '--max-old-space-size=512');
    assert.equal(out.RANDOM_THING, undefined);
    assert.equal(out.ANTHROPIC_API_KEY, undefined);
  });

  it('strips denylisted API keys even though no allow-rule would admit them', () => {
    const out = filterEnv({ OPENAI_API_KEY: 'x', LOOP24_GATEWAY_KEY: 'y' });
    assert.equal(out.OPENAI_API_KEY, undefined);
    assert.equal(out.LOOP24_GATEWAY_KEY, undefined);
  });
});

describe('kernelExecArgv', () => {
  it('forwards loader flags (with their values) and drops --test', () => {
    const out = kernelExecArgv([
      '--import',
      './src/resources/extensions/workflow/tests/resolve-ts.mjs',
      '--experimental-strip-types',
      '--test',
    ]);
    assert.deepEqual(out, [
      '--import',
      './src/resources/extensions/workflow/tests/resolve-ts.mjs',
      '--experimental-strip-types',
    ]);
  });

  it('handles --flag=value form and returns empty for a bare --test', () => {
    assert.deepEqual(kernelExecArgv(['--import=./x.mjs', '--test']), ['--import=./x.mjs']);
    assert.deepEqual(kernelExecArgv(['--test']), []);
  });
});

describe('resolveKernelEntry', () => {
  it('returns an absolute path to a kernel-entry module', () => {
    const entry = resolveKernelEntry();
    assert.equal(isAbsolute(entry), true);
    assert.ok(['kernel-entry.js', 'kernel-entry.ts'].includes(basename(entry)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-spawn.test.ts`
Expected: FAIL — cannot find module `./kernel-spawn.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/kernel-spawn.ts`:

```typescript
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_ALLOW = new Set([
  'PATH', 'HOME', 'TERM', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LANGUAGE', 'PWD', 'USER', 'LOGNAME',
]);
const ENV_ALLOW_PREFIXES = ['LC_', 'XDG_', 'OTTO_', 'NODE_'];
const ENV_DENY = new Set([
  'LOOP24_GATEWAY_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN',
]);

export function filterEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ENV_DENY.has(key)) continue; // denylist overrides any allow-rule
    if (ENV_ALLOW.has(key) || ENV_ALLOW_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
    }
  }
  return out;
}

const FORWARD_FLAGS_WITH_VALUE = new Set([
  '--import', '--loader', '--experimental-loader', '--require', '-r', '--conditions',
]);
const FORWARD_FLAGS_BOOLEAN = new Set([
  '--experimental-strip-types', '--experimental-transform-types', '--no-warnings',
]);

export function kernelExecArgv(execArgv: string[] = process.execArgv): string[] {
  const out: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    const eq = arg.indexOf('=');
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    if (FORWARD_FLAGS_WITH_VALUE.has(flag)) {
      out.push(arg);
      if (eq < 0 && i + 1 < execArgv.length) out.push(execArgv[++i]);
    } else if (FORWARD_FLAGS_BOOLEAN.has(flag)) {
      out.push(arg);
    }
    // Everything else (--test, --watch, --test-*, …) is dropped.
  }
  return out;
}

export function resolveKernelEntry(): string {
  const js = fileURLToPath(new URL('./kernel-entry.js', import.meta.url));
  if (existsSync(js)) return js;
  return fileURLToPath(new URL('./kernel-entry.ts', import.meta.url));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-spawn.test.ts`
Expected: PASS — `# pass 5`, `# fail 0`.

> Note: at this point `kernel-entry.ts` does not exist yet (created in Task 3), so `resolveKernelEntry()` returns the `kernel-entry.ts` candidate path. The test only asserts the basename, so it passes regardless.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-spawn.ts packages/coworker-scratchpad/src/kernel-spawn.test.ts
git commit -m "feat(coworker-scratchpad): add kernel spawn env/argv/entry helpers"
```

---

## Task 3: Kernel entry (the child process)

The child. On startup it constructs the 1a `DefaultCollectorRegistry` with a `FileCollector` over `argv[2]` (the workspace), exposes `otto.collectors.{list,open}` inside a persistent `vm` context, emits a `ready` event, then loops over NDJSON `run` requests on stdin — evaluating each cell's code as an async IIFE (so `return <expr>;` produces the cell's value), capturing `console.log`/`error` as `stdout`, and replying with a `result` frame. When a cell calls `otto.collectors.open(uri).load()`, it emits a `data_load` event before returning the data. Globals assigned in one cell (`globalThis.x = …` or implicit `x = …`) persist into later cells.

**Files:**
- Create: `packages/coworker-scratchpad/src/kernel-entry.ts`
- Test: `packages/coworker-scratchpad/src/kernel-entry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/kernel-entry.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import { resolveKernelEntry, kernelExecArgv, filterEnv } from './kernel-spawn.js';
import type { KernelFrame, ResultResponse } from './kernel-protocol.js';

let workspace: string;
let inputs: string;
let child: ChildProcessWithoutNullStreams;

function startKernel(ws: string): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [...kernelExecArgv(), resolveKernelEntry(), ws],
    { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
  ) as ChildProcessWithoutNullStreams;
}

// Drain frames until `count` result frames have arrived; ignore events.
async function collectResults(c: ChildProcessWithoutNullStreams, count: number): Promise<ResultResponse[]> {
  const results: ResultResponse[] = [];
  for await (const raw of readNdjson(c.stdout)) {
    const frame = raw as KernelFrame;
    if (frame.type === 'result') {
      results.push(frame);
      if (results.length === count) break;
    }
  }
  return results;
}

describe('kernel-entry (child process)', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ke-ws-'));
    inputs = join(workspace, '.otto', 'inputs');
    await mkdir(inputs, { recursive: true });
  });

  afterEach(async () => {
    child?.kill('SIGKILL');
    await rm(workspace, { recursive: true, force: true });
  });

  it('evaluates a cell and returns its value + captured stdout', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: "console.log('hi'); return 1 + 1;" });
    const [res] = await collectResults(child, 1);
    assert.equal(res.ok, true);
    assert.equal((res as { value: unknown }).value, 2);
    assert.equal((res as { stdout: string }).stdout, 'hi');
  });

  it('persists globalThis across cells', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: 'globalThis.counter = 41; return globalThis.counter;' });
    await writeNdjson(child.stdin, { id: 2, type: 'run', code: 'return globalThis.counter + 1;' });
    const results = await collectResults(child, 2);
    assert.equal(results[0].ok, true);
    assert.equal((results[0] as { value: unknown }).value, 41);
    assert.equal((results[1] as { value: unknown }).value, 42);
  });

  it('binds otto.collectors.list() to the workspace inputs dir', async () => {
    await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n1,2\n');
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: 'return (await otto.collectors.list()).map((r) => r.uri);' });
    const [res] = await collectResults(child, 1);
    assert.equal(res.ok, true);
    assert.deepEqual((res as { value: string[] }).value, [pathToFileURL(join(inputs, 'cmdb.csv')).href]);
  });

  it('returns ok:false with the error message when a cell throws', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: "throw new Error('boom');" });
    const [res] = await collectResults(child, 1);
    assert.equal(res.ok, false);
    assert.match((res as { error: { message: string } }).error.message, /boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-entry.test.ts`
Expected: FAIL — the spawned child cannot resolve `./kernel-entry.ts` (module does not exist yet), so no `result` frames arrive and the test errors/times out.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/kernel-entry.ts`:

```typescript
import process, { argv, stdin, stdout } from 'node:process';
import vm from 'node:vm';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import type { DataSource, DataSourceRef } from '@otto/coworker-types';
import { DefaultCollectorRegistry } from './collector-registry.js';
import { FileCollector } from './file-collector.js';
import type { KernelEvent, KernelRequest, ResultResponse } from './kernel-protocol.js';

const workspace = argv[2] ?? process.cwd();
const trace = process.env.OTTO_SCRATCHPAD_IPC_TRACE === '1';

const registry = new DefaultCollectorRegistry();
registry.register(new FileCollector({ workspace }));

function send(frame: KernelEvent | ResultResponse): void {
  if (trace) process.stderr.write(`[kernel→] ${JSON.stringify(frame)}\n`);
  void writeNdjson(stdout, frame);
}

const ottoCollectors = {
  async list(): Promise<DataSourceRef[]> {
    const refs: DataSourceRef[] = [];
    for (const collector of registry.list()) {
      for await (const ref of collector.list()) refs.push(ref);
    }
    return refs;
  },
  async open(uri: string): Promise<DataSource> {
    const hit = await registry.resolve(uri);
    if (!hit) throw new Error(`no collector resolves uri: ${uri}`);
    const source = await hit.collector.open(hit.ref);
    return {
      ref: source.ref,
      async load(): Promise<Buffer | string | object> {
        const value = await source.load();
        send({
          type: 'event',
          event: 'data_load',
          drawer: {
            kind: 'data_load',
            collector: source.ref.collector,
            uri: source.ref.uri,
            bytes: source.ref.bytes ?? null,
            rows_loaded: Array.isArray(value) ? value.length : null,
            loaded_at: new Date().toISOString(),
            schema: null,
          },
        });
        return value;
      },
    };
  },
};

const sandbox: Record<string, unknown> = { otto: { collectors: ottoCollectors } };
const context = vm.createContext(sandbox);

async function runCell(code: string): Promise<{ value: unknown; stdout: string }> {
  const logs: string[] = [];
  sandbox.console = {
    log: (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(' ')),
    error: (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(' ')),
  };
  const wrapped = `(async () => {\n${code}\n})()`;
  const value: unknown = await vm.runInContext(wrapped, context, { filename: 'cell.js' });
  return { value, stdout: logs.join('\n') };
}

function toSerializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { valuePreview: String(value) };
  }
}

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

void main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-entry.test.ts`
Expected: PASS — `# pass 4`, `# fail 0`. (Each test spawns a child; the file takes ~1s.)

> If this fails with "Cannot find module '@otto/coworker-utils'", build it once: `npm run build:coworker-utils` (see the Prerequisite note in Canonical commands), then re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-entry.ts packages/coworker-scratchpad/src/kernel-entry.test.ts
git commit -m "feat(coworker-scratchpad): add kernel child process over NDJSON"
```

---

## Task 4: ChildProcessRuntime (the parent)

The ergonomic parent API the rest of the scratchpad will use. `start()` spawns the child (filtered env + `execArgv`) and resolves once the child's `ready` event arrives. `runCell(code)` sends a `run` request, correlates the matching `result` by `id`, and rejects on a per-cell wall-clock timeout (killing the child). `data_load` events are routed to the injected `onDataLoad` callback (the future `MemoryRecorder` seam). `dispose()` ends stdin and terminates the child.

**Files:**
- Create: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Test: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/child-process-runtime.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChildProcessRuntime } from './child-process-runtime.js';
import type { DataLoadDrawer } from './kernel-protocol.js';

let workspace: string;
let inputs: string;
let runtime: ChildProcessRuntime;

describe('ChildProcessRuntime', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'cpr-ws-'));
    inputs = join(workspace, '.otto', 'inputs');
    await mkdir(inputs, { recursive: true });
  });

  afterEach(async () => {
    await runtime?.dispose();
    await rm(workspace, { recursive: true, force: true });
  });

  it('runs a cell and returns value + stdout after start()', async () => {
    runtime = new ChildProcessRuntime({ workspace });
    await runtime.start();
    const { value, stdout } = await runtime.runCell("console.log('hello'); return 6 * 7;");
    assert.equal(value, 42);
    assert.equal(stdout, 'hello');
  });

  it('rejects with the cell error message when a cell throws', async () => {
    runtime = new ChildProcessRuntime({ workspace });
    await runtime.start();
    await assert.rejects(() => runtime.runCell("throw new Error('kaboom');"), /kaboom/);
  });

  it('forwards a data_load drawer to onDataLoad when a cell loads via a collector', async () => {
    await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n1,2\n');
    const uri = pathToFileURL(join(inputs, 'cmdb.csv')).href;
    const drawers: DataLoadDrawer[] = [];
    runtime = new ChildProcessRuntime({ workspace, onDataLoad: (d) => drawers.push(d) });
    await runtime.start();

    const { value } = await runtime.runCell(
      `return await (await otto.collectors.open(${JSON.stringify(uri)})).load();`,
    );
    assert.equal(value, 'a,b\n1,2\n');

    // The data_load event may arrive moments before the result; allow a tick.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(drawers.length, 1);
    assert.equal(drawers[0].kind, 'data_load');
    assert.equal(drawers[0].collector, 'file');
    assert.equal(drawers[0].uri, uri);
    assert.equal(drawers[0].bytes, 8);
    assert.equal(drawers[0].schema, null);
  });

  it('times out a hung cell and rejects', async () => {
    runtime = new ChildProcessRuntime({ workspace, cellTimeoutMs: 200 });
    await runtime.start();
    await assert.rejects(() => runtime.runCell('return new Promise(() => {});'), /timed out/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: FAIL — cannot find module `./child-process-runtime.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/coworker-scratchpad/src/child-process-runtime.ts`:

```typescript
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';
import { isDataLoadEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame } from './kernel-protocol.js';

export interface CellResult {
  value: unknown;
  stdout: string;
}

export interface ChildProcessRuntimeOptions {
  workspace: string;
  onDataLoad?: (drawer: DataLoadDrawer) => void;
  cellTimeoutMs?: number;
  entryPath?: string;
}

interface Pending {
  resolve: (result: CellResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_CELL_TIMEOUT_MS = 30_000;

export class ChildProcessRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private readonly ready: Promise<void>;

  constructor(private readonly options: ChildProcessRuntimeOptions) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  async start(): Promise<void> {
    const entry = this.options.entryPath ?? resolveKernelEntry();
    const child = spawn(
      process.execPath,
      [...kernelExecArgv(), entry, this.options.workspace],
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
    ) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.on('exit', (code, signal) => {
      const err = new Error(`kernel exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.rejectReady(err); // no-op if already resolved
      this.failAllPending(err);
    });
    void this.readLoop(child);
    await this.ready;
  }

  private async readLoop(child: ChildProcessWithoutNullStreams): Promise<void> {
    try {
      for await (const raw of readNdjson(child.stdout)) {
        const frame = raw as KernelFrame;
        if (frame.type === 'event') {
          if (frame.event === 'ready') this.resolveReady();
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          continue;
        }
        const p = this.pending.get(frame.id);
        if (!p) continue;
        clearTimeout(p.timer);
        this.pending.delete(frame.id);
        if (frame.ok) {
          p.resolve({ value: frame.value, stdout: frame.stdout });
        } else {
          const err = new Error(frame.error.message);
          err.name = frame.error.name;
          if (frame.error.stack) err.stack = frame.error.stack;
          p.reject(err);
        }
      }
    } catch (err) {
      this.failAllPending(err as Error);
    }
  }

  async runCell(code: string): Promise<CellResult> {
    if (this.disposed) throw new Error('runtime disposed');
    const child = this.child;
    if (!child) throw new Error('kernel not started');
    const id = this.nextId++;
    const timeoutMs = this.options.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
    const result = new Promise<CellResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill();
        reject(new Error(`cell ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    await writeNdjson(child.stdin, { id, type: 'run', code });
    return result;
  }

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private kill(): void {
    this.disposed = true;
    this.child?.kill('SIGKILL');
    this.child = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.failAllPending(new Error('runtime disposed'));
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: PASS — `# pass 4`, `# fail 0`. (The timeout test takes ~0.2s; the file takes ~1.5s.)

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/child-process-runtime.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "feat(coworker-scratchpad): add ChildProcessRuntime kernel parent"
```

---

## Task 5: Wire the barrel, verify build + gate

Add the public surface to the barrel and verify the package compiles and the whole gate stays green.

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`

- [ ] **Step 1: Extend the barrel**

Overwrite `packages/coworker-scratchpad/src/index.ts` with:

```typescript
export { detectKind, FILE_COLLECTOR_KINDS } from './detect-kind.js';
export { FileCollector, type FileCollectorOptions } from './file-collector.js';
export { DefaultCollectorRegistry, uriMatchesPattern } from './collector-registry.js';
export {
  isDataLoadEvent,
  type RunRequest,
  type KernelRequest,
  type ResultOk,
  type ResultErr,
  type ResultResponse,
  type DataLoadDrawer,
  type ReadyEvent,
  type DataLoadEvent,
  type KernelEvent,
  type KernelFrame,
} from './kernel-protocol.js';
export { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';
export {
  ChildProcessRuntime,
  type CellResult,
  type ChildProcessRuntimeOptions,
} from './child-process-runtime.js';
```

> `kernel-entry.ts` is intentionally **not** exported — it is an executable entrypoint (spawned by path), not a library module.

- [ ] **Step 2: Build the package (type-checks the cross-module + cross-package imports)**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0; emits `dist/kernel-protocol.{js,d.ts}`, `dist/kernel-spawn.{js,d.ts}`, `dist/kernel-entry.{js,d.ts}`, `dist/child-process-runtime.{js,d.ts}`, and the updated `dist/index.{js,d.ts}`.

> If `tsc` reports a type error in `child-process-runtime.ts` around `spawn(...) as ChildProcessWithoutNullStreams`, that cast is intentional (stdio `['pipe','pipe','inherit']` yields non-null `stdin`/`stdout`); leave it. Fix any *other* reported error before proceeding — do not silence it.

- [ ] **Step 3: Run the workspace-package test gate**

Run: `npm run test:packages`
Expected: passes; `@otto/coworker-scratchpad` now reports **7** test files run (detect-kind, file-collector, collector-registry, kernel-protocol, kernel-spawn, kernel-entry, child-process-runtime) with zero failures.

- [ ] **Step 4: Verify workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.`

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export kernel runtime + protocol from barrel"
```

---

## Self-Review

**1. Spec coverage (§2.4 kernel + §6.3 NDJSON):**
- `ChildProcessRuntime`: per-kernel `node` subprocess via `child_process` (not worker_thread) — `child-process-runtime.ts` Task 4. ✓
- NDJSON over stdio, debuggable with `cat`/`jq`, `OTTO_SCRATCHPAD_IPC_TRACE=1` trace — `kernel-entry.ts` (trace to stderr) + `@otto/coworker-utils` helpers, Tasks 1/3/4. ✓
- Persistent `globalThis` namespace across cells — shared `vm` context, Task 3 (tested). ✓
- `otto.collectors` binding (`list()` + `open(uri)`) reusing the 1a facade — Task 3 (tested). ✓
- Layer-B `data_load` drawer on collector load (`{ kind, collector, uri, bytes, rows_loaded, loaded_at, schema }`) — emitted as an event, forwarded to `onDataLoad`, Tasks 3/4 (tested). ✓ (`schema` null + best-effort `rows_loaded` — full introspection deferred to 1d, noted.)
- Environment filtering at kernel spawn (allowlist + allow-prefixes incl. `OTTO_DS_*`, denylist API keys) — `filterEnv`, Task 2 (tested). ✓
- Basic total wall-clock timeout — Task 4 (tested). ✓ (Two-tier/inactivity/cancellation-escalation deferred to 1c, noted.)
- Pre-bound data libs, `ScratchpadManager`/pool/locks/heartbeat, DuckDB/namespace/cells persistence, `/sp`+tool+MIME — **deferred** to 1c/1d/1e, listed in Scope. ✓ (out of scope)

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `RunRequest`/`KernelRequest`/`ResultResponse`/`DataLoadDrawer`/`KernelEvent`/`KernelFrame`/`isDataLoadEvent` defined in Task 1 are imported unchanged in Tasks 3/4 and re-exported in Task 5. `filterEnv`/`kernelExecArgv`/`resolveKernelEntry` defined in Task 2 are imported in Tasks 3 (test)/4 and re-exported in Task 5. `CellResult`/`ChildProcessRuntimeOptions`/`ChildProcessRuntime` defined in Task 4 are re-exported in Task 5. `DefaultCollectorRegistry`/`FileCollector` come from 1a; `DataSource`/`DataSourceRef` from `@otto/coworker-types`; `writeNdjson`/`readNdjson` from `@otto/coworker-utils`. The cell value contract (`return <expr>;` inside an async IIFE) is consistent across `kernel-entry.ts` and every test that exercises it. ✓

**Deferred to later Phase 1 sub-plans (intentionally out of scope for 1b):** `ScratchpadManager` pool/LRU/locks/heartbeat/auto-restart + two-tier timeout + cancellation escalation + idle eviction (1c); DuckDB `kernel.db` + `namespace.json` snapshot/restore + `cells.jsonl` archive + pre-bound data libs + real `data_load` schema introspection (1d); `/sp` slash commands + `scratchpad` tool + MIME bundle output, and wiring `onDataLoad` to the real Layer-B `MemoryRecorder` (1e + Phase 3).
```
