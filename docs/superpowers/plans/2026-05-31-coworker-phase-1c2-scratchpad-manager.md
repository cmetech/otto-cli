# Otto Co-Worker Phase 1c2 — ScratchpadManager (Named-Kernel Pool, Idle/LRU Eviction, Cross-Process Lock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ScratchpadManager` that owns named `ChildProcessRuntime` kernels — a bounded live-kernel pool with LRU + idle eviction, and an exclusive cross-process lock per kernel (PID + host, stale-clear via `process.kill(pid, 0)`, `--force-takeover` audit trail).

**Architecture:** A composition layer over the 1c `ChildProcessRuntime` (untouched except one read-only `hasActiveCell` getter). The manager holds `Map<name, Entry>` where `Entry = { runtime, lock, lastUsedAt }`. A kernel is **warm** (child spawned, occupies a pool slot) or **cold** (runtime disposed by eviction, but still managed — the cross-process lock is *retained*). The pool bound (`maxLiveKernels`, default 8) counts warm entries; warming when full LRU-evicts the least-recently-used non-busy warm kernel to cold. A periodic `unref`'d sweep (driven by an injectable `now()` clock) evicts kernels idle past `idleMs` (default 600 000). Eviction is a resource optimization, never a detach: the lock survives so a re-attaching session still owns the name. The exclusive lock is a separate `lock.json` created atomically via `writeFileSync(..., { flag: 'wx' })`; stale locks (holder PID gone on the same host) are cleared on acquire; `--force-takeover` overwrites with a `takeover_from` audit field.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+, `node:fs` (`wx` atomic create), `node:os` (`hostname`), `node:process` (`kill(pid, 0)`), `node:test` + `node:assert/strict`. Builds on 1c's `ChildProcessRuntime`. No new dependencies.

**Spec reference:** `otto-cli/docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (lines 301–305: "`ScratchpadManager`: Map<name, runtime>", "Exclusive lock per kernel (cross-process via lock file)", "Bounded live-kernel pool (default `max_live_kernels: 8`); LRU eviction on overflow", "Idle eviction (default 10 min)"), §3.2 (concurrent attach → `"scratchpad <name> is busy in another session"`, `--force-takeover` writes `.takeover-from`), §3.3 (on-disk layout `~/.otto/scratchpads/<name>/meta.json`), §7 risk #6 (lock file includes PID + host; `kill(pid, 0)` stale check; `--force-takeover` with `.takeover-from` audit field).

**Design decisions (resolved in brainstorm — 2026-05-31):**
1. **Eviction retains the lock** (cold-but-locked). Idle/LRU eviction frees the live child but keeps the cross-process lock; the attachment persists. Lock released only on `remove()` / `disposeAll()`.
2. **Separate `lock.json` via `wx`-create** is the atomic mutex. `meta.json` is a minimal durable existence marker (`{ name, created_at }`). This reconciles spec §3.3's "lock_holder in meta.json" by splitting the atomic token into its own file for race-free acquisition; the full meta.json (attached_sessions, size_bytes, …) grows in 1d.
3. **`getOrAttach` is get-or-create** (idempotent workhorse); `create()` is the explicit "must be new, errors if exists" variant.
4. **The 1c runtime gains one read-only `get hasActiveCell`** so eviction never kills a kernel with an in-flight cell.

**Known intentional gap (deferred to 1d):** there is no `namespace.json` snapshot/restore in 1c2, so a cold→warm re-spawn (after idle or LRU eviction) legitimately starts with an **empty `globalThis`**. This is asserted as expected behavior in the tests, not a bug.

---

## Scope

**In scope (1c2):**
- `ChildProcessRuntime.hasActiveCell` — read-only getter (`this.activeId !== null`).
- `scratchpad-lock.ts` — cross-process exclusive lock: `acquireLock` (atomic `wx`-create, stale-clear, force-takeover), `releaseLock`, `readLock`, `isStaleLock`, `ScratchpadBusyError`.
- `scratchpad-manager.ts` — `ScratchpadManager` with `create` / `getOrAttach` / `list` / `remove` / `disposeAll`, bounded warm pool (`maxLiveKernels`, default 8) + LRU eviction, idle eviction (`idleMs`, default 600 000) via an `unref`'d sweep + injectable `now()` clock.
- Barrel exports for all of the above.

**Explicitly deferred (NOT in 1c2):**
- `namespace.json` snapshot/restore (cold→warm re-spawn starts empty) → **1d**.
- DuckDB `kernel.db`, `cells.jsonl`, pre-bound data libs → **1d**.
- Full `meta.json` (attached_sessions, last_used persistence, size_bytes) → **1d** (1c2 writes only `{ name, created_at }`).
- `/sp` commands, the `scratchpad` tool surface, MIME bundle → **1e**.
- Mid-cell eviction of a *busy* kernel during LRU overflow when **all** warm kernels are busy (the pool may momentarily exceed `maxLiveKernels` rather than kill an in-flight cell). Documented limitation; revisit if real concurrency arrives in 1e.
- Robust cross-process stale-clear under simultaneous contention (the unlink+recreate window has a small race). Acceptable under the spec's single-user laptop model (§3.2, non-goal "strong sandboxing"). Documented.

---

## Canonical commands

Same harness as 1a/1b/1c. Run a single package `.ts` test from the repo root (verified on Node v22.x):

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

> **Prerequisite (unchanged from 1b/1c):** the manager spawns real kernels that import `@otto/coworker-utils` at runtime. If a test errors with "Cannot find module '@otto/coworker-utils'", run `npm run build:coworker-utils` once. 1c2 adds no new dependencies.

> **Flakiness watch (bit us in 1c):** the eviction / lock / idle tests are timing-sensitive. They are made deterministic via an injectable `now()` clock and by driving `evictIdle()` directly (the real sweep interval is set to a huge value in tests so it never fires). Still, **run `scratchpad-manager.test.ts` 3–5 times** to confirm stability before committing each task:
> ```bash
> for i in 1 2 3 4 5; do node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts || break; done
> ```

---

## File structure

```
packages/coworker-scratchpad/src/
  child-process-runtime.ts        ← Modify: add `get hasActiveCell` (Task 1)
  child-process-runtime.test.ts   ← Modify: add hasActiveCell test (Task 1)
  scratchpad-lock.ts              ← Create: cross-process exclusive lock primitive (Task 2)
  scratchpad-lock.test.ts         ← Create: lock tests (Task 2)
  scratchpad-manager.ts           ← Create: manager — CRUD + lock + LRU pool (Task 3), + idle eviction (Task 4)
  scratchpad-manager.test.ts      ← Create: manager tests — core/LRU (Task 3), + idle (Task 4)
  index.ts                        ← Modify: export manager + lock surface (Task 5)
```

Five tasks: Task 1 is the one-line runtime getter (+test). Task 2 is the standalone lock primitive (testable in isolation). Task 3 is the manager core (CRUD, lock integration, LRU pool — the heart). Task 4 layers idle eviction onto the manager. Task 5 wires the barrel and runs the gates.

---

## Task 1: `ChildProcessRuntime.hasActiveCell` getter

Add a read-only getter so the manager can refuse to evict a kernel that is mid-cell.

**Files:**
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

- [ ] **Step 1: Add the failing test**

In `packages/coworker-scratchpad/src/child-process-runtime.test.ts`, append this test inside the existing `describe('ChildProcessRuntime', …)` block (before its closing `});`):

```typescript
  it('hasActiveCell is true while a cell runs, false otherwise', async () => {
    runtime = new ChildProcessRuntime({ workspace, inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000 });
    await runtime.start();
    assert.equal(runtime.hasActiveCell, false);
    const p = runtime.runCell('await new Promise((r) => setTimeout(r, 150)); return 5;');
    assert.equal(runtime.hasActiveCell, true);
    assert.equal((await p).value, 5);
    assert.equal(runtime.hasActiveCell, false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: FAIL — `runtime.hasActiveCell` is `undefined` (not a getter), so the first `assert.equal(runtime.hasActiveCell, false)` reports `undefined !== false`.

- [ ] **Step 3: Add the getter**

In `packages/coworker-scratchpad/src/child-process-runtime.ts`, insert this getter immediately before the `async dispose(): Promise<void> {` line:

```typescript
  get hasActiveCell(): boolean {
    return this.activeId !== null;
  }

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts`
Expected: PASS — `# pass 11` (10 from 1c + 1 new).

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/child-process-runtime.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "feat(coworker-scratchpad): add hasActiveCell getter to ChildProcessRuntime"
```

---

## Task 2: `scratchpad-lock.ts` — cross-process exclusive lock

A standalone, dependency-free lock primitive. `lock.json` lives at `<dir>/lock.json`. Acquisition is an atomic `wx` create; a stale lock (holder PID dead on the same host) is cleared and retaken; `forceTakeover` overwrites and records `takeover_from` for forensics.

**Files:**
- Create: `packages/coworker-scratchpad/src/scratchpad-lock.ts`
- Create: `packages/coworker-scratchpad/src/scratchpad-lock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/scratchpad-lock.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import {
  acquireLock,
  releaseLock,
  readLock,
  isStaleLock,
  ScratchpadBusyError,
} from './scratchpad-lock.js';
import type { LockInfo } from './scratchpad-lock.js';

let root: string;
let dir: string;

// A real, definitely-dead PID: spawn a node that exits immediately, await its exit, reuse its PID.
async function deadPid(): Promise<number> {
  const c = spawn(process.execPath, ['-e', '']);
  const pid = c.pid as number;
  await new Promise<void>((r) => c.on('exit', () => r()));
  return pid;
}

describe('scratchpad-lock', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sp-lock-'));
    dir = join(root, 'p1');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('acquires a fresh lock holding this pid + host', () => {
    const lock = acquireLock(dir);
    assert.equal(lock.pid, process.pid);
    assert.equal(lock.host, hostname());
    assert.ok(existsSync(join(dir, 'lock.json')));
  });

  it('throws ScratchpadBusyError when a live holder already owns the lock', () => {
    acquireLock(dir);
    assert.throws(() => acquireLock(dir), (err: unknown) => {
      assert.ok(err instanceof ScratchpadBusyError);
      assert.match((err as Error).message, /scratchpad p1 is busy in another session/);
      return true;
    });
  });

  it('clears a stale lock (dead holder pid) and re-acquires', async () => {
    await mkdir(dir, { recursive: true });
    const stale: LockInfo = { pid: await deadPid(), host: hostname(), acquired_at: '2026-01-01T00:00:00.000Z' };
    await writeFile(join(dir, 'lock.json'), JSON.stringify(stale));
    const lock = acquireLock(dir);
    assert.equal(lock.pid, process.pid);
    assert.equal(JSON.parse(readFileSync(join(dir, 'lock.json'), 'utf8')).pid, process.pid);
  });

  it('force-takeover overwrites a live lock and records takeover_from', () => {
    const prior = acquireLock(dir);
    const taken = acquireLock(dir, { forceTakeover: true, takeoverReason: 'unit-test' });
    assert.equal(taken.pid, process.pid);
    assert.ok(taken.takeover_from);
    assert.equal(taken.takeover_from!.pid, prior.pid);
    assert.equal(taken.takeover_from!.reason, 'unit-test');
  });

  it('releaseLock removes our own lock so it can be re-acquired', () => {
    acquireLock(dir);
    releaseLock(dir);
    assert.equal(existsSync(join(dir, 'lock.json')), false);
    assert.doesNotThrow(() => acquireLock(dir));
  });

  it('releaseLock leaves a lock owned by another holder', async () => {
    await mkdir(dir, { recursive: true });
    const other: LockInfo = { pid: await deadPid(), host: hostname(), acquired_at: '2026-01-01T00:00:00.000Z' };
    await writeFile(join(dir, 'lock.json'), JSON.stringify(other));
    releaseLock(dir);
    assert.ok(existsSync(join(dir, 'lock.json'))); // not ours -> untouched
  });

  it('isStaleLock is true for a dead holder and false for a live one', async () => {
    const dead: LockInfo = { pid: await deadPid(), host: hostname(), acquired_at: '2026-01-01T00:00:00.000Z' };
    const live: LockInfo = { pid: process.pid, host: hostname(), acquired_at: '2026-01-01T00:00:00.000Z' };
    assert.equal(isStaleLock(dead), true);
    assert.equal(isStaleLock(live), false);
  });

  it('readLock returns null when no lock exists', () => {
    assert.equal(readLock(dir), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-lock.test.ts`
Expected: FAIL — cannot find module `./scratchpad-lock.js` / exports undefined.

- [ ] **Step 3: Write the implementation**

Create `packages/coworker-scratchpad/src/scratchpad-lock.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { hostname } from 'node:os';
import process from 'node:process';

export interface LockInfo {
  pid: number;
  host: string;
  acquired_at: string;
  takeover_from?: { pid: number; host: string; reason: string };
}

export interface AcquireOptions {
  forceTakeover?: boolean;
  takeoverReason?: string;
  now?: () => number;
}

export class ScratchpadBusyError extends Error {
  readonly scratchpadName: string;
  readonly holder: LockInfo;
  constructor(scratchpadName: string, holder: LockInfo) {
    super(`scratchpad ${scratchpadName} is busy in another session`);
    this.name = 'ScratchpadBusyError';
    this.scratchpadName = scratchpadName;
    this.holder = holder;
  }
}

function lockPath(dir: string): string {
  return join(dir, 'lock.json');
}

export function readLock(dir: string): LockInfo | null {
  const path = lockPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null; // corrupt lock is treated as absent (clearable on acquire)
  }
}

function holderIsAlive(holder: LockInfo): boolean {
  if (holder.host !== hostname()) return true; // can't verify a remote PID -> assume alive
  try {
    process.kill(holder.pid, 0);
    return true; // exists and signalable
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'; // ESRCH = no such process (dead); EPERM etc. = alive
  }
}

export function isStaleLock(holder: LockInfo): boolean {
  return !holderIsAlive(holder);
}

export function acquireLock(dir: string, options: AcquireOptions = {}): LockInfo {
  const now = options.now ?? Date.now;
  mkdirSync(dir, { recursive: true });
  const path = lockPath(dir);
  const self: LockInfo = { pid: process.pid, host: hostname(), acquired_at: new Date(now()).toISOString() };

  try {
    writeFileSync(path, JSON.stringify(self), { flag: 'wx' });
    return self; // won the atomic create
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  const holder = readLock(dir);
  if (holder === null || !holderIsAlive(holder)) {
    // corrupt or stale -> clear and retake
    unlinkSync(path);
    writeFileSync(path, JSON.stringify(self), { flag: 'wx' });
    return self;
  }

  if (options.forceTakeover) {
    const taken: LockInfo = {
      ...self,
      takeover_from: { pid: holder.pid, host: holder.host, reason: options.takeoverReason ?? 'force-takeover' },
    };
    writeFileSync(path, JSON.stringify(taken)); // overwrite the live holder
    return taken;
  }

  throw new ScratchpadBusyError(basename(dir), holder);
}

export function releaseLock(dir: string): void {
  const holder = readLock(dir);
  if (holder === null) return;
  if (holder.pid === process.pid && holder.host === hostname()) {
    try {
      unlinkSync(lockPath(dir));
    } catch {
      // already gone
    }
  }
  // not ours (e.g. taken over) -> leave it
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-lock.test.ts`
Expected: PASS — `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-lock.ts packages/coworker-scratchpad/src/scratchpad-lock.test.ts
git commit -m "feat(coworker-scratchpad): cross-process scratchpad lock (wx-create + stale-clear + force-takeover)"
```

---

## Task 3: `ScratchpadManager` — CRUD + lock integration + LRU pool

The manager core. Owns `Map<name, Entry>`, integrates the lock, and bounds the warm pool with LRU eviction. **No idle eviction yet** (that is Task 4) — there is no sweep timer, `idleMs`, or `evictIdle` in this task.

**Files:**
- Create: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Create: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { ScratchpadManager } from './scratchpad-manager.js';

let workspace: string;
let root: string;
let mgr: ScratchpadManager;
let mgr2: ScratchpadManager | undefined;

const liveOf = (m: ScratchpadManager, name: string): boolean =>
  m.list().find((s) => s.name === name)!.live;

describe('ScratchpadManager (core + LRU)', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'spm-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    root = await mkdtemp(join(tmpdir(), 'spm-root-'));
    mgr2 = undefined;
  });

  afterEach(async () => {
    await mgr?.disposeAll();
    await mgr2?.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('getOrAttach creates a kernel that runs cells', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    const rt = await mgr.getOrAttach('a');
    const { value } = await rt.runCell('return 6 * 7;');
    assert.equal(value, 42);
    assert.equal(liveOf(mgr, 'a'), true);
  });

  it('getOrAttach is idempotent — same name returns the same runtime', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    const first = await mgr.getOrAttach('a');
    const second = await mgr.getOrAttach('a');
    assert.equal(first, second);
    assert.equal(mgr.list().length, 1);
  });

  it('create throws if the scratchpad already exists', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    await mgr.create('a');
    await assert.rejects(() => mgr.create('a'), /scratchpad a already exists/);
  });

  it('a second manager on the same root sees a live kernel as busy', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    await mgr.getOrAttach('a');
    mgr2 = new ScratchpadManager({ workspace, root });
    await assert.rejects(() => mgr2.getOrAttach('a'), /scratchpad a is busy in another session/);
  });

  it('force-takeover steals a busy lock', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    await mgr.getOrAttach('a');
    mgr2 = new ScratchpadManager({ workspace, root });
    const rt = await mgr2.getOrAttach('a', { forceTakeover: true, takeoverReason: 'test' });
    assert.equal((await rt.runCell('return 1;')).value, 1);
  });

  it('auto-clears a stale lock (dead-pid holder) and attaches', async () => {
    // Simulate a crashed prior session: a lock.json whose holder pid is dead.
    const dir = join(root, 'a');
    await mkdir(dir, { recursive: true });
    const c = spawn(process.execPath, ['-e', '']);
    const dead = c.pid as number;
    await new Promise<void>((r) => c.on('exit', () => r()));
    await writeFile(join(dir, 'lock.json'),
      JSON.stringify({ pid: dead, host: hostname(), acquired_at: '2026-01-01T00:00:00.000Z' }));
    mgr = new ScratchpadManager({ workspace, root });
    const rt = await mgr.getOrAttach('a'); // stale lock cleared on acquire
    assert.equal((await rt.runCell('return 2;')).value, 2);
  });

  it('LRU-evicts the least-recently-used kernel when the pool overflows', async () => {
    let t = 1000;
    mgr = new ScratchpadManager({ workspace, root, maxLiveKernels: 2, now: () => t });
    await mgr.getOrAttach('a'); t += 10;
    await mgr.getOrAttach('b'); t += 10;
    await mgr.getOrAttach('c'); // pool full -> evict LRU 'a'
    assert.equal(liveOf(mgr, 'a'), false); // cold
    assert.equal(liveOf(mgr, 'b'), true);
    assert.equal(liveOf(mgr, 'c'), true);
  });

  it('re-warms a cold kernel with an empty globalThis (no snapshot — 1d gap)', async () => {
    let t = 1000;
    mgr = new ScratchpadManager({ workspace, root, maxLiveKernels: 1, now: () => t });
    const a1 = await mgr.getOrAttach('a');
    await a1.runCell('globalThis.x = 99;');
    t += 10;
    await mgr.getOrAttach('b');           // evicts 'a' -> cold
    assert.equal(liveOf(mgr, 'a'), false);
    t += 10;
    const a2 = await mgr.getOrAttach('a'); // cold -> re-warm (fresh child)
    assert.equal((await a2.runCell('return globalThis.x ?? null;')).value, null);
  });

  it('keeps the lock when a kernel is LRU-evicted (cold but still owned)', async () => {
    let t = 1000;
    mgr = new ScratchpadManager({ workspace, root, maxLiveKernels: 1, now: () => t });
    await mgr.getOrAttach('a'); t += 10;
    await mgr.getOrAttach('b');           // evicts 'a' -> cold, lock retained
    assert.equal(liveOf(mgr, 'a'), false);
    mgr2 = new ScratchpadManager({ workspace, root, now: () => t });
    await assert.rejects(() => mgr2.getOrAttach('a'), /busy/); // lock survived eviction
  });

  it('remove deletes the scratchpad dir and frees the lock', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    await mgr.getOrAttach('a');
    await mgr.remove('a');
    assert.equal(existsSync(join(root, 'a')), false);
    assert.equal(mgr.list().length, 0);
    mgr2 = new ScratchpadManager({ workspace, root });
    const rt = await mgr2.getOrAttach('a'); // lock gone -> re-attach succeeds
    assert.equal((await rt.runCell('return 3;')).value, 3);
  });

  it('disposeAll tears down every kernel and rejects further attaches', async () => {
    mgr = new ScratchpadManager({ workspace, root });
    await mgr.getOrAttach('a');
    await mgr.getOrAttach('b');
    await mgr.disposeAll();
    await assert.rejects(() => mgr.getOrAttach('c'), /disposed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: FAIL — cannot find module `./scratchpad-manager.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/coworker-scratchpad/src/scratchpad-manager.ts`:

```typescript
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChildProcessRuntime, type ChildProcessRuntimeOptions } from './child-process-runtime.js';
import { acquireLock, releaseLock, type LockInfo } from './scratchpad-lock.js';

export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
}

export interface AttachOptions {
  forceTakeover?: boolean;
  takeoverReason?: string;
}

export interface ScratchpadInfo {
  name: string;
  live: boolean;
  lastUsedAt: number;
}

interface Entry {
  runtime: ChildProcessRuntime | null; // null when cold (evicted, lock retained)
  lock: LockInfo;
  lastUsedAt: number;
}

const DEFAULT_MAX_LIVE = 8;

export class ScratchpadManager {
  protected readonly entries = new Map<string, Entry>();
  protected readonly workspace: string;
  protected readonly root: string;
  protected readonly maxLive: number;
  protected readonly now: () => number;
  protected readonly runtimeOptions: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  protected disposed = false;

  constructor(options: ScratchpadManagerOptions) {
    this.workspace = options.workspace;
    this.root = options.root ?? join(homedir(), '.otto', 'scratchpads');
    this.maxLive = options.maxLiveKernels ?? DEFAULT_MAX_LIVE;
    this.now = options.now ?? Date.now;
    this.runtimeOptions = options.runtimeOptions ?? {};
  }

  protected dirFor(name: string): string {
    return join(this.root, name);
  }

  private metaPath(name: string): string {
    return join(this.dirFor(name), 'meta.json');
  }

  private existsOnDisk(name: string): boolean {
    return existsSync(this.metaPath(name));
  }

  private writeMetaIfAbsent(name: string): void {
    const path = this.metaPath(name);
    if (existsSync(path)) return;
    mkdirSync(this.dirFor(name), { recursive: true });
    writeFileSync(path, JSON.stringify({ name, created_at: new Date(this.now()).toISOString() }, null, 2));
  }

  private warmCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.runtime !== null) n++;
    return n;
  }

  private async spawnRuntime(): Promise<ChildProcessRuntime> {
    const rt = new ChildProcessRuntime({ workspace: this.workspace, ...this.runtimeOptions });
    await rt.start();
    return rt;
  }

  private async evictLruIfNeeded(): Promise<void> {
    while (this.warmCount() >= this.maxLive) {
      let victim: Entry | null = null;
      for (const e of this.entries.values()) {
        if (e.runtime === null) continue; // already cold
        if (e.runtime.hasActiveCell) continue; // never evict a busy kernel
        if (victim === null || e.lastUsedAt < victim.lastUsedAt) victim = e;
      }
      if (victim === null) break; // every warm kernel is busy; pool may momentarily exceed (documented)
      await victim.runtime!.dispose();
      victim.runtime = null; // cold; lock RETAINED (Model A)
    }
  }

  async create(name: string, opts: AttachOptions = {}): Promise<ChildProcessRuntime> {
    this.assertNotDisposed();
    if (this.entries.has(name) || this.existsOnDisk(name)) {
      throw new Error(`scratchpad ${name} already exists`);
    }
    return this.attachUnmanaged(name, opts);
  }

  async getOrAttach(name: string, opts: AttachOptions = {}): Promise<ChildProcessRuntime> {
    this.assertNotDisposed();
    const existing = this.entries.get(name);
    if (existing) {
      existing.lastUsedAt = this.now();
      if (existing.runtime) return existing.runtime;
      await this.evictLruIfNeeded();
      existing.runtime = await this.spawnRuntime(); // cold -> warm; empty globalThis (1d gap)
      return existing.runtime;
    }
    return this.attachUnmanaged(name, opts);
  }

  private async attachUnmanaged(name: string, opts: AttachOptions): Promise<ChildProcessRuntime> {
    const dir = this.dirFor(name);
    const lock = acquireLock(dir, {
      forceTakeover: opts.forceTakeover,
      takeoverReason: opts.takeoverReason,
      now: this.now,
    });
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
  }

  list(): ScratchpadInfo[] {
    return [...this.entries].map(([name, e]) => ({
      name,
      live: e.runtime !== null,
      lastUsedAt: e.lastUsedAt,
    }));
  }

  async remove(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (entry) {
      await entry.runtime?.dispose();
      this.entries.delete(name);
    }
    rmSync(this.dirFor(name), { recursive: true, force: true }); // deletes lock.json + meta.json
  }

  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const [name, e] of this.entries) {
      await e.runtime?.dispose();
      releaseLock(this.dirFor(name)); // release lock; leave meta.json (durable)
    }
    this.entries.clear();
  }

  protected assertNotDisposed(): void {
    if (this.disposed) throw new Error('scratchpad manager disposed');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: PASS — `# pass 11`, `# fail 0`. Run it 3–5 times (see Flakiness watch) to confirm stability.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "feat(coworker-scratchpad): ScratchpadManager core — named-kernel CRUD + lock + LRU pool"
```

---

## Task 4: Idle eviction (`idleMs` + `unref`'d sweep + `evictIdle`)

Layer idle eviction onto the Task 3 manager. A periodic `unref`'d sweep evicts warm kernels idle past `idleMs` (default 600 000). The sweep is driven by the injectable `now()` clock; tests set a huge `sweepIntervalMs` so the real timer never fires and call `evictIdle()` directly. Idle eviction obeys the same rules as LRU: skip busy kernels, retain the lock.

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Add the failing tests**

In `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`, append a new `describe` block at the end of the file (after the existing `describe('ScratchpadManager (core + LRU)', …)` block):

```typescript
describe('ScratchpadManager (idle eviction)', () => {
  let workspace2: string;
  let root2: string;
  let m: ScratchpadManager;
  let m2: ScratchpadManager | undefined;

  const liveIn = (mm: ScratchpadManager, name: string): boolean =>
    mm.list().find((s) => s.name === name)!.live;

  beforeEach(async () => {
    workspace2 = await mkdtemp(join(tmpdir(), 'spm2-ws-'));
    await mkdir(join(workspace2, '.otto', 'inputs'), { recursive: true });
    root2 = await mkdtemp(join(tmpdir(), 'spm2-root-'));
    m2 = undefined;
  });

  afterEach(async () => {
    await m?.disposeAll();
    await m2?.disposeAll();
    await rm(workspace2, { recursive: true, force: true });
    await rm(root2, { recursive: true, force: true });
  });

  it('evicts a kernel idle past idleMs on sweep', async () => {
    let t = 1000;
    m = new ScratchpadManager({ workspace: workspace2, root: root2, idleMs: 1000, sweepIntervalMs: 1_000_000, now: () => t });
    await m.getOrAttach('a'); // lastUsedAt = 1000
    t = 2001;                 // 1001ms later, > idleMs
    await m.evictIdle();
    assert.equal(liveIn(m, 'a'), false);
  });

  it('does not evict a kernel with an in-flight cell', async () => {
    let t = 1000;
    m = new ScratchpadManager({
      workspace: workspace2, root: root2, idleMs: 1000, sweepIntervalMs: 1_000_000, now: () => t,
      runtimeOptions: { inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000 },
    });
    const a = await m.getOrAttach('a');
    const p = a.runCell('await new Promise((r) => setTimeout(r, 300)); return 1;');
    assert.equal(a.hasActiveCell, true);
    t = 5000; // way past idle
    await m.evictIdle();
    assert.equal(liveIn(m, 'a'), true); // busy -> not evicted
    assert.equal((await p).value, 1);
  });

  it('retains the lock across idle eviction (a second manager stays blocked)', async () => {
    let t = 1000;
    m = new ScratchpadManager({ workspace: workspace2, root: root2, idleMs: 1000, sweepIntervalMs: 1_000_000, now: () => t });
    await m.getOrAttach('a');
    t = 2001;
    await m.evictIdle();
    assert.equal(liveIn(m, 'a'), false);
    m2 = new ScratchpadManager({ workspace: workspace2, root: root2, now: () => t });
    await assert.rejects(() => m2.getOrAttach('a'), /busy/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: FAIL — `m.evictIdle` is not a function, and the `idleMs` / `sweepIntervalMs` options have no effect.

- [ ] **Step 3: Add idle eviction to the implementation**

Make four edits to `packages/coworker-scratchpad/src/scratchpad-manager.ts`:

(a) Extend `ScratchpadManagerOptions` — add `idleMs` and `sweepIntervalMs` after `maxLiveKernels`:

```typescript
export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  idleMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
}
```

(b) Add the two constants next to `DEFAULT_MAX_LIVE`:

```typescript
const DEFAULT_MAX_LIVE = 8;
const DEFAULT_IDLE_MS = 600_000;
const DEFAULT_SWEEP_MS = 30_000;
```

(c) Add an `idleMs` field + `sweepTimer` field and start the sweep in the constructor. Replace the field declarations and constructor with:

```typescript
  protected readonly entries = new Map<string, Entry>();
  protected readonly workspace: string;
  protected readonly root: string;
  protected readonly maxLive: number;
  protected readonly idleMs: number;
  protected readonly now: () => number;
  protected readonly runtimeOptions: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  protected disposed = false;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(options: ScratchpadManagerOptions) {
    this.workspace = options.workspace;
    this.root = options.root ?? join(homedir(), '.otto', 'scratchpads');
    this.maxLive = options.maxLiveKernels ?? DEFAULT_MAX_LIVE;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? Date.now;
    this.runtimeOptions = options.runtimeOptions ?? {};
    this.sweepTimer = setInterval(() => { void this.evictIdle(); }, options.sweepIntervalMs ?? DEFAULT_SWEEP_MS);
    this.sweepTimer.unref();
  }
```

(d) Add the `evictIdle` method (place it immediately before `async disposeAll`), and clear the timer inside `disposeAll`. Add:

```typescript
  async evictIdle(): Promise<void> {
    if (this.disposed) return;
    const cutoff = this.now() - this.idleMs;
    for (const e of this.entries.values()) {
      if (e.runtime === null) continue;
      if (e.runtime.hasActiveCell) continue; // never evict a busy kernel
      if (e.lastUsedAt <= cutoff) {
        await e.runtime.dispose();
        e.runtime = null; // cold; lock RETAINED (Model A)
      }
    }
  }
```

And change the top of `disposeAll` from:

```typescript
  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
```

to:

```typescript
  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: PASS — `# pass 14`, `# fail 0` (11 core/LRU + 3 idle). Run 3–5 times to confirm stability.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "feat(coworker-scratchpad): idle eviction (unref'd sweep + injectable clock) in ScratchpadManager"
```

---

## Task 5: Export manager + lock surface, verify build + gates

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`

- [ ] **Step 1: Extend the barrel**

In `packages/coworker-scratchpad/src/index.ts`, append these two export blocks at the end of the file:

```typescript
export {
  ScratchpadManager,
  type ScratchpadManagerOptions,
  type AttachOptions,
  type ScratchpadInfo,
} from './scratchpad-manager.js';
export {
  acquireLock,
  releaseLock,
  readLock,
  isStaleLock,
  ScratchpadBusyError,
  type LockInfo,
  type AcquireOptions,
} from './scratchpad-lock.js';
```

- [ ] **Step 2: Build the package**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0; emits `dist/scratchpad-lock.*`, `dist/scratchpad-manager.*`, re-emits `dist/child-process-runtime.*` and `dist/index.*`. Fix any reported type error before proceeding — do not silence it.

- [ ] **Step 3: Run the workspace-package test gate**

Run: `npm run test:packages`
Expected: passes; `@otto/coworker-scratchpad` now reports **9** test files run (the 7 from 1c + `scratchpad-lock.test.ts` + `scratchpad-manager.test.ts`) with zero failures.

- [ ] **Step 4: Verify workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.`

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export ScratchpadManager + lock surface from barrel"
```

---

## Self-Review

**1. Spec coverage (§2.4 / §3.2 / §3.3 / §7 #6):**
- `ScratchpadManager: Map<name, runtime>` with named-kernel CRUD — `create` / `getOrAttach` / `list` / `remove` / `disposeAll` (Task 3, tested). ✓
- Bounded live-kernel pool (`max_live_kernels: 8`) + LRU eviction on overflow — `maxLive` default 8; `evictLruIfNeeded` picks the lowest-`lastUsedAt` non-busy warm entry → cold (Task 3, tested: LRU evicts, re-warm empty, lock retained). ✓
- Idle eviction (default 10 min) → terminate runtime — `idleMs` default 600 000; `unref`'d sweep + `evictIdle` (Task 4, tested: idle→cold, busy-skip, lock retained). ✓
- Exclusive per-kernel lock, cross-process, PID + host — `lock.json` via `wx`-create holding `{ pid, host, acquired_at }` (Task 2, tested). ✓
- Concurrent attach blocked → `"scratchpad <name> is busy in another session"` — `ScratchpadBusyError` (exact message) (Task 2 + Task 3, tested). ✓
- `--force-takeover` writes `.takeover-from` audit (prior PID + reason) — `takeover_from: { pid, host, reason }` (Task 2, tested; surfaced via `AttachOptions.forceTakeover`/`takeoverReason` in Task 3). ✓
- Stale-lock detection via `process.kill(pid, 0)` — `holderIsAlive` (ESRCH = dead); auto-clear on acquire (Task 2, tested with a real dead PID; Task 3 manager-level test). ✓
- `meta.json` in the named scratchpad dir — minimal `{ name, created_at }` existence marker written on create (Task 3); full meta deferred to 1d. ✓
- Eviction retains the lock (design decision #1) — both `evictLruIfNeeded` and `evictIdle` set `runtime = null` without releasing; tested via "second manager stays blocked" (Tasks 3 + 4). ✓
- Empty-`globalThis`-on-reattach (no snapshot — intentional 1d gap) — tested explicitly (Task 3). ✓
- `namespace.json`/DuckDB/cells.jsonl/data libs (1d), `/sp`/tool/MIME (1e) — **out of scope**, listed in Scope. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `LockInfo` / `AcquireOptions` / `ScratchpadBusyError` defined in Task 2 are imported by `scratchpad-manager.ts` (Task 3) and re-exported in Task 5. `ScratchpadManagerOptions` gains `idleMs` + `sweepIntervalMs` in Task 4; the Task 4 tests construct managers with exactly those names. `hasActiveCell` (Task 1) is read by both `evictLruIfNeeded` (Task 3) and `evictIdle` (Task 4). `Entry` (`runtime | null`, `lock`, `lastUsedAt`) is used consistently across `getOrAttach` / `attachUnmanaged` / `evictLruIfNeeded` / `evictIdle` / `list` / `remove` / `disposeAll`. `AttachOptions` (`forceTakeover`, `takeoverReason`) flows from `getOrAttach`/`create` → `acquireLock`'s `AcquireOptions`. `now()` is threaded into both manager bookkeeping (`lastUsedAt`, idle cutoff) and `acquireLock` (`acquired_at`). ✓
