# Otto Co-Worker Phase 1c — Runtime Hardening (Two-Tier Timeout, Progress, Cancellation, Auto-Restart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the 1b `ChildProcessRuntime` so a single named kernel survives slow-but-alive cells, kills runaway/silent cells, can be cancelled without tearing down a healthy kernel, and auto-restarts once after an unexpected death before surfacing a hard failure.

**Architecture:** Three behaviors layered onto the existing parent/child pair. (1) **Two-tier timeout** — every cell gets a total wall-clock cap *and* an inactivity cap; the child exposes a `progress()` cell binding that emits a `progress` event, and each such event resets the parent's inactivity timer (bumping the window after the first heartbeat). (2) **Cancellation escalation** — `cancel()` sends `SIGINT` (the child installs `SIG_IGN` so a stray between-cells cancel can't kill it; `node:vm` can't abort sync JS mid-cell anyway), then after a grace window escalates `SIGTERM`→`SIGKILL`. (3) **Auto-restart** — an unexpected child exit marks the kernel dead; the next `runCell` transparently respawns it once, and a second death before any successful cell is a hard failure. This mirrors `../anton`'s two-tier timeout + `progress()` heartbeat and `../oh-my-pi`'s SIGINT→grace→SIGTERM→SIGKILL ladder and restart-once policy, adapted to Node `child_process` + `node:vm`.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+, `node:child_process`, `node:vm`, `node:test` + `node:assert/strict`. NDJSON via `@otto/coworker-utils`. No DuckDB, no pool/locks, no namespace snapshot — those are 1c2/1d.

**Spec reference:** `otto-cli/docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 — "Two-tier timeout (total wall-clock + inactivity); `progress()` heartbeat resets inactivity", "Cancellation escalation: SIGINT → … between-cells `SIG_IGN` … → SIGTERM if stuck … → process restart on next call", "Heartbeat dead-kernel detection; auto-restart allowed once; repeated crash = hard failure surfaced to user".

---

## Scope

**In scope (1c):**
- `progress` event frame in the wire protocol + `isProgressEvent` guard.
- A `progress(message?)` binding inside each cell that emits a `progress` event.
- The child ignores `SIGINT` (`SIG_IGN`) so a stray cancel between cells never tears down a healthy kernel.
- Parent two-tier timeout: total wall-clock cap + inactivity cap; `progress` events reset the inactivity timer and bump its window.
- `ChildProcessRuntime.cancel()`: `SIGINT` → grace window → `SIGTERM`/`SIGKILL` escalation, rejecting the active cell.
- Auto-restart once on death (timeout/cancel/crash); a second death without an intervening successful cell is a hard failure.

**Explicitly deferred (NOT in 1c):**
- `ScratchpadManager` (Map<name,runtime>), named-kernel CRUD, bounded live-kernel pool, LRU eviction, idle eviction, exclusive per-kernel locks + `--force-takeover` → **1c2**.
- True mid-cell abort-error injection into a running `vm` cell (not feasible for synchronous JS; neither `../anton` nor `../oh-my-pi` does it for an in-flight VM — they kill the process). 1c stops a hung cell by killing + restarting. **Documented gap; revisit only if a real need arises.**
- `namespace.json` snapshot/restore (a restarted kernel starts with an empty `globalThis` in 1c) → **1d**.
- DuckDB `kernel.db`, `cells.jsonl`, pre-bound data libs → **1d**.
- `/sp` commands, tool surface, MIME bundle → **1e**.

---

## Canonical commands

Same harness as 1a/1b. Run a single package `.ts` test from the repo root (verified on Node v22.22.3):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<FILE>.test.ts
```

Build the package:

```bash
npm run build:coworker-scratchpad
```

Run the workspace-package test gate + coverage gate:

```bash
npm run test:packages
npm run verify:workspace-coverage
```

> **Prerequisite (unchanged from 1b):** the child kernel imports `@otto/coworker-utils` at runtime. If a kernel test errors with "Cannot find module '@otto/coworker-utils'", run `npm run build:coworker-utils` once. 1c adds no new dependencies.

> **Defaults change:** 1b's single `cellTimeoutMs` defaulted to `30_000`. In 1c `cellTimeoutMs` becomes the **total wall-clock** cap and defaults to `120_000` (matching `../anton`'s `cell_timeout_default`). The existing 1b test that passes `cellTimeoutMs: 200` still asserts `/timed out/` and still passes — it just hits the total cap. No other code passes a timeout.

---

## File structure

```
packages/coworker-scratchpad/src/
  kernel-protocol.ts          ← Modify: add ProgressEvent + isProgressEvent; extend KernelEvent (Task 1)
  kernel-protocol.test.ts     ← Modify: add isProgressEvent test (Task 1)
  kernel-entry.ts             ← Modify: add progress() cell binding + SIGINT-ignore (Task 1)
  kernel-entry.test.ts        ← Modify: add progress-event test (Task 1)
  child-process-runtime.ts    ← Rewrite: two-tier timeout + cancel + auto-restart (Task 2)
  child-process-runtime.test.ts ← Rewrite: keep 4 originals + add 6 hardening tests (Task 2)
  index.ts                    ← Modify: export ProgressEvent + isProgressEvent (Task 3)
```

Three tasks: Task 1 is the protocol+child changes (small, two files each with one new test), Task 2 is the parent rewrite (the cohesive heart of 1c), Task 3 wires the barrel and runs the gates.

---

## Task 1: `progress` event + child `progress()` binding + SIGINT-ignore

Add the `progress` wire frame and the in-cell `progress()` binding that emits it, and make the child ignore `SIGINT` so a stray cancel between cells can't kill a healthy kernel.

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-protocol.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-protocol.test.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-entry.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-entry.test.ts`

- [ ] **Step 1: Add the failing protocol test**

In `packages/coworker-scratchpad/src/kernel-protocol.test.ts`, update the import line and append a new `describe` block. The import line becomes:

```typescript
import { isDataLoadEvent, isProgressEvent } from './kernel-protocol.js';
import type { DataLoadEvent, ProgressEvent, ReadyEvent, ResultOk } from './kernel-protocol.js';
```

Append at the end of the file:

```typescript
describe('isProgressEvent', () => {
  it('returns true for a progress frame', () => {
    const frame: ProgressEvent = { type: 'event', event: 'progress', message: 'halfway' };
    assert.equal(isProgressEvent(frame), true);
  });

  it('returns false for ready and data_load and result frames', () => {
    const ready: ReadyEvent = { type: 'event', event: 'ready' };
    const dl: DataLoadEvent = {
      type: 'event',
      event: 'data_load',
      drawer: {
        kind: 'data_load', collector: 'file', uri: 'file:///x', bytes: 1,
        rows_loaded: null, loaded_at: '2026-05-31T00:00:00.000Z', schema: null,
      },
    };
    const res: ResultOk = { id: 1, type: 'result', ok: true, value: 0, stdout: '' };
    assert.equal(isProgressEvent(ready), false);
    assert.equal(isProgressEvent(dl), false);
    assert.equal(isProgressEvent(res), false);
  });
});
```

- [ ] **Step 2: Run protocol test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-protocol.test.ts`
Expected: FAIL — `isProgressEvent` / `ProgressEvent` not exported.

- [ ] **Step 3: Add `ProgressEvent` + `isProgressEvent` to the protocol**

In `packages/coworker-scratchpad/src/kernel-protocol.ts`, add the `ProgressEvent` interface immediately after the `DataLoadEvent` interface:

```typescript
export interface ProgressEvent {
  type: 'event';
  event: 'progress';
  message?: string;
}
```

Change the `KernelEvent` union to include it:

```typescript
export type KernelEvent = ReadyEvent | DataLoadEvent | ProgressEvent;
```

And add the guard immediately after `isDataLoadEvent`:

```typescript
export function isProgressEvent(frame: KernelFrame): frame is ProgressEvent {
  return frame.type === 'event' && frame.event === 'progress';
}
```

- [ ] **Step 4: Run protocol test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-protocol.test.ts`
Expected: PASS — `# pass 5` (3 original + 2 new).

- [ ] **Step 5: Add the failing child progress test**

In `packages/coworker-scratchpad/src/kernel-entry.test.ts`, update the protocol type import to add `ProgressEvent`:

```typescript
import type { KernelFrame, ProgressEvent, ResultResponse } from './kernel-protocol.js';
```

Append this test inside the existing `describe('kernel-entry (child process)', …)` block (before its closing `});`):

```typescript
  it('emits a progress event when a cell calls progress()', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: "progress('halfway'); return 1;" });
    const frames: KernelFrame[] = [];
    for await (const raw of readNdjson(child.stdout)) {
      const f = raw as KernelFrame;
      frames.push(f);
      if (f.type === 'result') break;
    }
    const prog = frames.find((f) => f.type === 'event' && f.event === 'progress');
    assert.ok(prog, 'expected a progress event before the result');
    assert.equal((prog as ProgressEvent).message, 'halfway');
  });
```

- [ ] **Step 6: Run child test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-entry.test.ts`
Expected: FAIL — the cell throws `progress is not defined`, so no `progress` event arrives.

- [ ] **Step 7: Add the `progress()` binding + SIGINT-ignore to the child**

In `packages/coworker-scratchpad/src/kernel-entry.ts`, inside `runCell`, add the `progress` binding right after the `sandbox.console = …` assignment (so it is bound fresh per cell, like `console`):

```typescript
  sandbox.progress = (message?: unknown): void => {
    send({
      type: 'event',
      event: 'progress',
      message: message === undefined ? undefined : String(message),
    });
  };
```

And add the SIGINT-ignore handler at module top level, immediately after the `registry.register(new FileCollector({ workspace }));` line:

```typescript
process.on('SIGINT', () => {
  // Ignored on purpose. A stray cancel between cells must not tear down a healthy
  // kernel; the parent escalates to SIGTERM/SIGKILL to actually stop a hung kernel.
});
```

- [ ] **Step 8: Run child test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-entry.test.ts`
Expected: PASS — `# pass 5` (4 original + 1 new).

- [ ] **Step 9: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-protocol.ts packages/coworker-scratchpad/src/kernel-protocol.test.ts packages/coworker-scratchpad/src/kernel-entry.ts packages/coworker-scratchpad/src/kernel-entry.test.ts
git commit -m "feat(coworker-scratchpad): add progress event + cell progress() binding + child SIGINT-ignore"
```

---

## Task 2: Harden `ChildProcessRuntime` — two-tier timeout, cancellation, auto-restart

Rewrite the parent runtime. It keeps the 1b public surface (`start`/`runCell`/`dispose`/`onDataLoad`) and adds `cancel()`, a two-tier timeout, and transparent restart-once. The spawn logic is factored into a private `spawnChild()` so both `start()` and the auto-restart path reuse it.

**Files:**
- Rewrite: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Rewrite: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

- [ ] **Step 1: Write the failing test (overwrite the file)**

Overwrite `packages/coworker-scratchpad/src/child-process-runtime.test.ts` with (the 4 original 1b tests are preserved verbatim; 6 hardening tests are added):

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

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

    await delay(50);
    assert.equal(drawers.length, 1);
    assert.equal(drawers[0].kind, 'data_load');
    assert.equal(drawers[0].collector, 'file');
    assert.equal(drawers[0].uri, uri);
    assert.equal(drawers[0].bytes, 8);
    assert.equal(drawers[0].schema, null);
  });

  it('times out a hung cell on the total wall-clock cap and rejects', async () => {
    runtime = new ChildProcessRuntime({ workspace, cellTimeoutMs: 200 });
    await runtime.start();
    await assert.rejects(() => runtime.runCell('return new Promise(() => {});'), /timed out/);
  });

  it('times out a silent-but-alive cell on the inactivity cap', async () => {
    runtime = new ChildProcessRuntime({ workspace, inactivityTimeoutMs: 150, cellTimeoutMs: 10_000 });
    await runtime.start();
    await assert.rejects(() => runtime.runCell('return new Promise(() => {});'), /inactivity/);
  });

  it('progress() resets the inactivity timer so a long heartbeating cell completes', async () => {
    runtime = new ChildProcessRuntime({ workspace, inactivityTimeoutMs: 150, cellTimeoutMs: 10_000 });
    await runtime.start();
    const { value } = await runtime.runCell(
      "for (let i = 0; i < 4; i++) { progress('tick' + i); await new Promise((r) => setTimeout(r, 80)); } return 'done';",
    );
    assert.equal(value, 'done');
  });

  it('still enforces the total wall-clock cap even while progress() heartbeats', async () => {
    runtime = new ChildProcessRuntime({
      workspace, cellTimeoutMs: 250, inactivityTimeoutMs: 60_000, inactivityAfterProgressMs: 60_000,
    });
    await runtime.start();
    await assert.rejects(
      () => runtime.runCell("while (true) { progress('busy'); await new Promise((r) => setTimeout(r, 40)); }"),
      /total wall-clock/,
    );
  });

  it('cancel() rejects the active cell and the kernel restarts on the next call', async () => {
    runtime = new ChildProcessRuntime({
      workspace, cancelGraceMs: 100, inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000,
    });
    await runtime.start();
    const p = runtime.runCell('return new Promise(() => {});');
    await delay(50);
    await runtime.cancel();
    await assert.rejects(() => p, /cancelled/);
    const { value } = await runtime.runCell('return 7;');
    assert.equal(value, 7);
  });

  it('a stray SIGINT between cells is ignored (kernel state survives)', async () => {
    runtime = new ChildProcessRuntime({ workspace });
    await runtime.start();
    await runtime.runCell('globalThis.x = 99;');
    await runtime.cancel(); // nothing running: sends SIGINT, which the child ignores
    const { value } = await runtime.runCell('return globalThis.x;');
    assert.equal(value, 99); // 99 (not null) proves the kernel was NOT restarted
  });

  it('hard-fails after a second death without an intervening successful cell', async () => {
    runtime = new ChildProcessRuntime({
      workspace, cancelGraceMs: 80, inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000,
    });
    await runtime.start();
    const p1 = runtime.runCell('return new Promise(() => {});');
    await delay(30);
    await runtime.cancel();
    await assert.rejects(() => p1, /cancelled/);

    const p2 = runtime.runCell('return new Promise(() => {});'); // triggers restart #1
    await delay(30);
    await runtime.cancel();
    await assert.rejects(() => p2, /cancelled/);

    await assert.rejects(() => runtime.runCell('return 1;'), /repeatedly crashed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: FAIL — `runtime.cancel` is not a function and the new timeout options have no effect (current 1b impl). Several tests error/time out.

- [ ] **Step 3: Write the implementation (overwrite the file)**

Overwrite `packages/coworker-scratchpad/src/child-process-runtime.ts` with:

```typescript
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';
import { isDataLoadEvent, isProgressEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame } from './kernel-protocol.js';

export interface CellResult {
  value: unknown;
  stdout: string;
}

export interface ChildProcessRuntimeOptions {
  workspace: string;
  onDataLoad?: (drawer: DataLoadDrawer) => void;
  cellTimeoutMs?: number; // total wall-clock hard cap per cell
  inactivityTimeoutMs?: number; // silence cap before the first progress() heartbeat
  inactivityAfterProgressMs?: number; // silence cap after a progress() heartbeat
  cancelGraceMs?: number; // SIGINT -> SIGTERM/SIGKILL escalation window
  entryPath?: string;
}

interface Pending {
  resolve: (result: CellResult) => void;
  reject: (err: Error) => void;
  totalTimer: NodeJS.Timeout;
  inactivityTimer: NodeJS.Timeout;
  inactivityWindowMs: number;
}

const DEFAULT_CELL_TIMEOUT_MS = 120_000;
const DEFAULT_INACTIVITY_MS = 30_000;
const DEFAULT_INACTIVITY_AFTER_PROGRESS_MS = 60_000;
const DEFAULT_CANCEL_GRACE_MS = 2_000;
const MAX_RESTARTS_BEFORE_SUCCESS = 1;

export class ChildProcessRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private activeId: number | null = null;
  private nextId = 1;
  private alive = false;
  private disposed = false;
  private restartsSinceSuccess = 0;
  private resolveReady: () => void = () => {};
  private rejectReady: (err: Error) => void = () => {};
  private ready: Promise<void> = Promise.resolve();

  constructor(private readonly options: ChildProcessRuntimeOptions) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('runtime disposed');
    await this.spawnChild();
  }

  private spawnChild(): Promise<void> {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const entry = this.options.entryPath ?? resolveKernelEntry();
    const child = spawn(
      process.execPath,
      [...kernelExecArgv(), entry, this.options.workspace],
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
    ) as unknown as ChildProcessWithoutNullStreams;
    this.child = child;
    this.alive = true;
    child.on('exit', (code, signal) => {
      if (this.child !== child) return; // superseded by a restart
      this.alive = false;
      if (this.disposed) return;
      const err = new Error(`kernel exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.rejectReady(err); // no-op if ready already resolved
      this.failAllPending(err);
    });
    void this.readLoop(child);
    return this.ready;
  }

  private async readLoop(child: ChildProcessWithoutNullStreams): Promise<void> {
    try {
      for await (const raw of readNdjson(child.stdout)) {
        if (this.child !== child) break; // superseded by a restart
        const frame = raw as KernelFrame;
        if (frame.type === 'event') {
          if (frame.event === 'ready') this.resolveReady();
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          else if (isProgressEvent(frame)) this.resetInactivity();
          continue;
        }
        const p = this.pending.get(frame.id);
        if (!p) continue;
        clearTimeout(p.totalTimer);
        clearTimeout(p.inactivityTimer);
        this.pending.delete(frame.id);
        if (this.activeId === frame.id) this.activeId = null;
        this.restartsSinceSuccess = 0; // a completed cell proves the kernel is healthy
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

  private resetInactivity(): void {
    if (this.activeId === null) return;
    const id = this.activeId;
    const p = this.pending.get(id);
    if (!p) return;
    p.inactivityWindowMs =
      this.options.inactivityAfterProgressMs ?? DEFAULT_INACTIVITY_AFTER_PROGRESS_MS;
    clearTimeout(p.inactivityTimer);
    p.inactivityTimer = setTimeout(() => this.onInactivityTimeout(id), p.inactivityWindowMs);
  }

  private onInactivityTimeout(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.totalTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.markDead();
    p.reject(new Error(`cell ${id} timed out after ${p.inactivityWindowMs}ms of inactivity`));
  }

  private onTotalTimeout(id: number, totalMs: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.inactivityTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.markDead();
    p.reject(new Error(`cell ${id} timed out after ${totalMs}ms (total wall-clock)`));
  }

  async runCell(code: string): Promise<CellResult> {
    if (this.disposed) throw new Error('runtime disposed');
    if (!this.alive) {
      if (this.restartsSinceSuccess >= MAX_RESTARTS_BEFORE_SUCCESS) {
        throw new Error(
          `kernel repeatedly crashed (${this.restartsSinceSuccess} restart(s) without a successful cell); giving up`,
        );
      }
      this.restartsSinceSuccess++;
      await this.spawnChild();
    }
    const child = this.child;
    if (!child) throw new Error('kernel not started');
    const id = this.nextId++;
    const totalMs = this.options.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
    const inactivityMs = this.options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_MS;
    const result = new Promise<CellResult>((resolve, reject) => {
      const totalTimer = setTimeout(() => this.onTotalTimeout(id, totalMs), totalMs);
      const inactivityTimer = setTimeout(() => this.onInactivityTimeout(id), inactivityMs);
      this.pending.set(id, { resolve, reject, totalTimer, inactivityTimer, inactivityWindowMs: inactivityMs });
    });
    this.activeId = id;
    await writeNdjson(child.stdin, { id, type: 'run', code });
    return result;
  }

  async cancel(): Promise<void> {
    const child = this.child;
    if (!child || !this.alive) return;
    const id = this.activeId;
    child.kill('SIGINT'); // child ignores SIGINT between cells; no-op for sync vm code mid-cell
    if (id === null) return; // nothing running: the gentle signal is harmless
    await new Promise((r) => setTimeout(r, this.options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS));
    const p = this.pending.get(id);
    if (!p) return; // settled within the grace window
    clearTimeout(p.totalTimer);
    clearTimeout(p.inactivityTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.markDead(); // escalate: SIGTERM -> SIGKILL
    p.reject(new Error(`cell ${id} cancelled`));
  }

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.totalTimer);
      clearTimeout(p.inactivityTimer);
      p.reject(err);
    }
    this.pending.clear();
    this.activeId = null;
  }

  private markDead(): void {
    const child = this.child;
    if (!child) return;
    this.alive = false;
    child.kill('SIGTERM');
    child.kill('SIGKILL');
    // child stays referenced until its 'exit' fires; identity guards in readLoop/exit
    // ignore the dead child once a restart reassigns this.child.
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
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
Expected: PASS — `# pass 10`, `# fail 0`. (The cancel/hard-fail tests use small grace windows; the file takes ~3s.)

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/child-process-runtime.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "feat(coworker-scratchpad): two-tier timeout + cancel + auto-restart in ChildProcessRuntime"
```

---

## Task 3: Export new protocol surface, verify build + gates

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`

- [ ] **Step 1: Extend the barrel**

In `packages/coworker-scratchpad/src/index.ts`, the kernel-protocol export block must add `isProgressEvent` and `type ProgressEvent`. Replace the existing `from './kernel-protocol.js'` export block with:

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

> `ChildProcessRuntimeOptions` is already exported from the barrel (1b); its new optional fields ride along automatically. No other barrel change is needed.

- [ ] **Step 2: Build the package**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0; re-emits `dist/kernel-protocol.*`, `dist/kernel-entry.*`, `dist/child-process-runtime.*`, `dist/index.*`.

> The `spawn(...) as unknown as ChildProcessWithoutNullStreams` cast is intentional (carried from 1b; `['pipe','pipe','inherit']` makes `stderr` null). Leave it. Fix any *other* reported error before proceeding — do not silence it.

- [ ] **Step 3: Run the workspace-package test gate**

Run: `npm run test:packages`
Expected: passes; `@otto/coworker-scratchpad` still reports **7** test files run (no new files; protocol +2 tests, kernel-entry +1, runtime +6) with zero failures.

- [ ] **Step 4: Verify workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.`

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export progress event + guard from barrel"
```

---

## Self-Review

**1. Spec coverage (§2.4 runtime-hardening bullets):**
- Two-tier timeout (total wall-clock + inactivity) — `onTotalTimeout` + `onInactivityTimeout`, Task 2 (tested: total cap, inactivity cap, total-caps-despite-progress). ✓
- `progress()` heartbeat resets inactivity — `progress()` cell binding (Task 1) emits a `progress` event; `resetInactivity()` reschedules the inactivity timer and bumps the window (Task 2, tested). ✓
- Cancellation: `SIGINT` → between-cells `SIG_IGN` → `SIGTERM`/`SIGKILL` if stuck → restart on next call — child `process.on('SIGINT', noop)` (Task 1); `cancel()` SIGINT→grace→`markDead` escalation (Task 2, tested: cancel rejects + restarts, stray SIGINT ignored with state survival). ✓
- Heartbeat dead-kernel detection; auto-restart once; repeated crash = hard failure — `exit` handler sets `alive=false`; `runCell` respawns once; second death without a successful cell throws (Task 2, tested: hard-fail-after-second-death). ✓ (Death is detected via the child `exit` event — the same path a true crash takes; the tests drive it deterministically via `cancel()`/`markDead`.)
- True mid-cell abort into a live `vm` cell — **deferred** (not feasible for sync JS; documented in Scope; neither `../anton` nor `../oh-my-pi` does it for an in-flight VM). ✓ (out of scope)
- `ScratchpadManager`/pool/LRU/idle/locks — **deferred to 1c2**; `namespace.json` snapshot/restore (restarted kernel starts empty) — **deferred to 1d**. ✓ (out of scope)

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `ProgressEvent`/`isProgressEvent` defined in Task 1 are imported in Task 2 (`child-process-runtime.ts`) and re-exported in Task 3. `ChildProcessRuntimeOptions` gains `inactivityTimeoutMs`/`inactivityAfterProgressMs`/`cancelGraceMs` (all optional) and the test constructs runtimes with those exact names. The `Pending` shape (`totalTimer`/`inactivityTimer`/`inactivityWindowMs`) is used consistently across `runCell`/`resetInactivity`/`onInactivityTimeout`/`onTotalTimeout`/`failAllPending`. `cellTimeoutMs` keeps its 1b name but its meaning is now "total wall-clock"; the 1b `cellTimeoutMs: 200` test still asserts `/timed out/`. The `send` helper in `kernel-entry.ts` accepts `KernelEvent | ResultResponse`, and `ProgressEvent ∈ KernelEvent`, so the new `progress` emission type-checks. ✓

**Deferred to later Phase 1 sub-plans (intentionally out of scope for 1c):** `ScratchpadManager` Map<name,runtime> CRUD + bounded pool + LRU eviction + idle eviction + exclusive per-kernel locks + `--force-takeover` (1c2); `namespace.json` snapshot/restore + DuckDB `kernel.db` + `cells.jsonl` + pre-bound data libs (1d); `/sp` commands + tool surface + MIME bundle (1e); true mid-cell abort-error injection into a running `vm` cell (no phase — revisit only on demonstrated need).
```
