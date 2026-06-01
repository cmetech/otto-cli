# Otto Co-Worker Phase 1g3 — Library Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three library-side hardening fixes — fork exit timeout + SIGKILL escalation, `size_bytes` payload-only whitelist, atomic rename for `namespace.json` and `meta.json`. Closes Phase 1.

**Architecture:** All changes contained in `packages/coworker-scratchpad/src/{scratchpad-manager,kernel-entry}.ts`. New `ForkKernelHangError` exported. New private helpers `raceWithTimeout` (module-level) and `writeMetaAtomic` + `payloadSize` (on ScratchpadManager). Eight `writeFileSync` sites on meta.json + one site on namespace.json switch to tmp+rename.

**Tech Stack:** Node 22, `node:test`, `node:fs` (renameSync), `node:child_process` (rawChild kill escalation), existing `ScratchpadManager` + `ChildProcessRuntime`.

**Branch:** `feat/coworker-phase-0`. This closes Phase 1; branch is mergeable to main after 1g3.

**Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-1g3-library-hardening-design.md`

---

## Plan adjustment: testability override for `FORK_EXIT_TIMEOUT_MS`

The spec (§10 Out of scope) defers a configurable `forkExitTimeoutMs` "until a real workload needs it." However, Task 1's tests cover 5-10 second real-time waits per test (3 tests × ~5-10s = 15-30s on every test run). That's painful for CI and TDD iteration.

**This plan adds `forkExitTimeoutMs?: number` to `ScratchpadManagerOptions`** as a test-injectable override (default = the `FORK_EXIT_TIMEOUT_MS` constant). Production behavior is unchanged. The spec's intent (no runtime tuning surface) is honored — this is purely for testability. Same call we made for `makeCtx` and `ScratchpadBusyError` import in 1g2 (legitimate test-tooling fixes that don't change production behavior).

---

## File Structure

```
packages/coworker-scratchpad/src/
  scratchpad-manager.ts          ← MODIFY: ForkKernelHangError class +
                                            raceWithTimeout helper +
                                            FORK_EXIT_TIMEOUT_MS constant +
                                            forkExitTimeoutMs option;
                                            fork timeout/SIGKILL escalation;
                                            payloadSize REPLACES dirSize
                                            (readdirSync import removed;
                                            renameSync import added);
                                            writeMetaAtomic helper +
                                            8 site swaps
  scratchpad-manager.test.ts     ← MODIFY: +7 tests across Tasks 1+2+3
  index.ts                       ← MODIFY: export ForkKernelHangError
  kernel-entry.ts                ← MODIFY: namespace.json atomic-rename
  kernel-entry.test.ts           ← MODIFY: +1 test
```

## Standing test commands

```bash
# Single library test (fast iteration)
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<file>.test.ts

# Build (BEFORE typecheck — 1g lesson)
npm run build:coworker-scratchpad

# Type gate
npm run typecheck:extensions

# Package gate
npm run test:packages
```

---

## Task 1: `ForkKernelHangError` + `raceWithTimeout` + fork timeout/SIGKILL escalation

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
- Modify: `packages/coworker-scratchpad/src/index.ts`

### Step 1.1 — Write failing tests

- [ ] **Append a new `describe` block to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the existing 1g2 describe blocks):

```ts
describe('ScratchpadManager (fork exit escalation — 1g3)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    // Inject a TINY timeout so SIGKILL escalation + hang tests don't block CI.
    mgr = new ScratchpadManager({
      workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000,
      forkExitTimeoutMs: 50,
    });
  });
  afterEach(async () => {
    await mgr.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('fork succeeds when the source kernel exits cleanly within the timeout', async () => {
    await mgr.runCell('src', 'globalThis.x = 1;');
    // Default kernel obeys SIGTERM; happy path completes without escalation.
    await mgr.fork('src', 'dst');
    const dstMeta = JSON.parse(readFileSync(join(root, 'dst', 'meta.json'), 'utf8')) as { name: string };
    assert.equal(dstMeta.name, 'dst');
  });

  it('fork escalates to SIGKILL when SIGTERM is ignored, then proceeds', async () => {
    await mgr.runCell('src', 'globalThis.x = 1;');
    // Monkey-patch the rawChild so SIGTERM is swallowed but SIGKILL passes through.
    const entry = (mgr as unknown as { entries: Map<string, { runtime: unknown }> }).entries.get('src')!;
    const realChild = (entry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child!;
    const origKill = realChild.kill.bind(realChild);
    const signalsSeen: NodeJS.Signals[] = [];
    realChild.kill = ((sig?: NodeJS.Signals) => {
      const s = sig ?? 'SIGTERM';
      signalsSeen.push(s);
      if (s === 'SIGKILL') return origKill('SIGKILL');
      return true; // swallow SIGTERM
    }) as typeof realChild.kill;

    await mgr.fork('src', 'dst');
    assert.ok(signalsSeen.includes('SIGTERM'), 'SIGTERM attempted first');
    assert.ok(signalsSeen.includes('SIGKILL'), 'SIGKILL fired after timeout');
    const dstMeta = JSON.parse(readFileSync(join(root, 'dst', 'meta.json'), 'utf8')) as { name: string };
    assert.equal(dstMeta.name, 'dst');
  });

  it('fork throws ForkKernelHangError when both SIGTERM and SIGKILL are ignored', async () => {
    await mgr.runCell('src', 'globalThis.x = 1;');
    const entry = (mgr as unknown as { entries: Map<string, { runtime: unknown }> }).entries.get('src')!;
    const realChild = (entry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child!;
    realChild.kill = (() => true) as typeof realChild.kill; // swallow EVERY signal

    let caught: unknown = null;
    try {
      await mgr.fork('src', 'dst');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof ForkKernelHangError, 'ForkKernelHangError thrown');
    const e = caught as ForkKernelHangError;
    assert.equal(e.srcName, 'src');
    assert.ok(typeof e.pid === 'number' && e.pid > 0, 'pid attached');

    // After-the-fact: forcibly kill the lingering kernel so afterEach can clean up.
    const reallyKill = Object.getPrototypeOf(realChild).kill as (sig?: NodeJS.Signals) => boolean;
    reallyKill.call(realChild, 'SIGKILL');
  });
});
```

- [ ] **Add the import** at the top of `scratchpad-manager.test.ts` if not already present. Find the existing `import` block and ensure `ForkKernelHangError` is in the list:

```ts
import { ScratchpadManager, ForkKernelHangError } from './scratchpad-manager.js';
```

  If the existing import is `import { ScratchpadManager } from './scratchpad-manager.js';`, expand it.

- [ ] **Run tests; expect FAIL** (ForkKernelHangError doesn't exist, fork doesn't have timeout):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 1.2 — Add the `ForkKernelHangError` class

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Add the error class near the top of the file, right after the imports** (above the existing interfaces):

```ts
export class ForkKernelHangError extends Error {
  constructor(public readonly srcName: string, public readonly pid: number) {
    super(`fork: source kernel for '${srcName}' (pid ${pid}) did not exit after SIGTERM + SIGKILL. Destination may be partially populated; clean up with /sp remove <dst>.`);
    this.name = 'ForkKernelHangError';
  }
}
```

### Step 1.3 — Add the constant + module-level `raceWithTimeout` helper

- [ ] **In the same file, add directly below the existing constants (around line 41-46, after `DEFAULT_SWEEP_MS` / `META_SCHEMA_VERSION` / `MAX_RECOVERY_NOTES`):**

```ts
const FORK_EXIT_TIMEOUT_MS = 5000;

function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timeout: ${label}`));
    }, ms);
    timer.unref();
    p.then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
    );
  });
}
```

### Step 1.4 — Add `forkExitTimeoutMs` option + field

- [ ] **Find the `ScratchpadManagerOptions` interface (around line 12). Add the new option:**

```ts
export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  idleMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  sessionId?: string;
  forkExitTimeoutMs?: number;
}
```

- [ ] **Find the class field block (around lines 49-56). Add the new field:**

```ts
  protected readonly forkExitTimeoutMs: number;
```

- [ ] **Find the constructor (around line 59-69). Add the assignment after the other field initializations (e.g. after `this.sessionId = options.sessionId;`):**

```ts
    this.forkExitTimeoutMs = options.forkExitTimeoutMs ?? FORK_EXIT_TIMEOUT_MS;
```

### Step 1.5 — Update `fork` with the timeout + SIGKILL escalation

- [ ] **Find the `fork` method (around line 346). Find the exit-wait block (currently lines 360-364):**

```ts
    if (srcEntry && srcEntry.runtime) {
      const rawChild = (srcEntry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child;
      await this.snapshotThenDispose(srcName, srcEntry);
      if (rawChild && rawChild.exitCode === null) {
        await new Promise<void>((resolve) => rawChild.once('exit', resolve));
      }
    }
```

  and REPLACE with:

```ts
    if (srcEntry && srcEntry.runtime) {
      const rawChild = (srcEntry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child;
      await this.snapshotThenDispose(srcName, srcEntry);
      if (rawChild && rawChild.exitCode === null) {
        const exitPromise = new Promise<void>((resolve) => rawChild.once('exit', () => resolve()));
        try {
          await raceWithTimeout(exitPromise, this.forkExitTimeoutMs, 'exit-after-SIGTERM');
        } catch {
          rawChild.kill('SIGKILL');
          const exitPromise2 = new Promise<void>((resolve) => rawChild.once('exit', () => resolve()));
          try {
            await raceWithTimeout(exitPromise2, this.forkExitTimeoutMs, 'exit-after-SIGKILL');
          } catch {
            throw new ForkKernelHangError(srcName, rawChild.pid ?? -1);
          }
        }
      }
    }
```

### Step 1.6 — Export `ForkKernelHangError` from the package barrel

- [ ] **Edit** `packages/coworker-scratchpad/src/index.ts`. **Find the existing `ScratchpadManager` export block (lines 34-39):**

```ts
export {
  ScratchpadManager,
  type ScratchpadManagerOptions,
  type AttachOptions,
  type ScratchpadInfo,
} from './scratchpad-manager.js';
```

  and REPLACE with:

```ts
export {
  ScratchpadManager,
  ForkKernelHangError,
  type ScratchpadManagerOptions,
  type AttachOptions,
  type ScratchpadInfo,
} from './scratchpad-manager.js';
```

### Step 1.7 — Run tests; expect PASS

- [ ] **Run; expect all 3 new tests PASS in well under 1s each** (thanks to `forkExitTimeoutMs: 50` in the stubbed manager):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 1.8 — Commit

- [ ] **Commit Task 1:**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts \
        packages/coworker-scratchpad/src/index.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): fork exit timeout + SIGKILL escalation

Closes the latent fork-hang risk flagged during 1f. After
snapshotThenDispose sends SIGTERM, fork now races against a
FORK_EXIT_TIMEOUT_MS (5000) window. If the kernel doesn't exit:
escalate to SIGKILL and race again. If STILL no exit, throw
ForkKernelHangError without attempting copyFileSync — DuckDB
handles may still be held and a torn copy would be worse than
no copy.

Adds ScratchpadManagerOptions.forkExitTimeoutMs for test
injection (defaults to FORK_EXIT_TIMEOUT_MS). Production
behavior unchanged.

ForkKernelHangError exported from @otto/coworker-scratchpad
alongside ScratchpadBusyError. raceWithTimeout helper is
module-private; timer.unref() so it doesn't block process
exit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `payloadSize` (replaces `dirSize`)

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

### Step 2.1 — Write failing tests

- [ ] **Append a new `describe` block to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the Task 1 block):

```ts
describe('ScratchpadManager (payloadSize whitelist — 1g3)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    mgr = new ScratchpadManager({ workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000 });
  });
  afterEach(async () => {
    await mgr.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('size_bytes counts only payload files; excludes lock.json + meta.json', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    const dir = join(root, 'p1');

    // Sanity: lock.json + meta.json + cells.jsonl + kernel.db (+ maybe kernel.db.wal) + namespace.json all on disk
    // after a single runCell + auto-snapshot? Actually only cells.jsonl + kernel.db + lock.json + meta.json
    // exist after runCell — snapshot only fires on dispose/idle. namespace.json may not be present.
    // Either way the math holds: size_bytes only counts whatever's in the whitelist.
    const { statSync } = await import('node:fs');
    const lockSize = statSync(join(dir, 'lock.json')).size;
    const metaSize = statSync(join(dir, 'meta.json')).size;

    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { size_bytes?: unknown };
    const payloadOnly =
      (existsSync(join(dir, 'kernel.db')) ? statSync(join(dir, 'kernel.db')).size : 0) +
      (existsSync(join(dir, 'kernel.db.wal')) ? statSync(join(dir, 'kernel.db.wal')).size : 0) +
      (existsSync(join(dir, 'namespace.json')) ? statSync(join(dir, 'namespace.json')).size : 0) +
      (existsSync(join(dir, 'cells.jsonl')) ? statSync(join(dir, 'cells.jsonl')).size : 0);

    assert.equal(meta.size_bytes, payloadOnly, 'size_bytes equals payload sum');
    // Negative-form: it does NOT include lock.json or meta.json
    assert.notEqual(meta.size_bytes, payloadOnly + lockSize, 'size_bytes excludes lock.json');
    assert.notEqual(meta.size_bytes, payloadOnly + metaSize, 'size_bytes excludes meta.json');
  });

  it('size_bytes is 0 when no payload files are present (lock + meta only)', async () => {
    // attachUnmanaged writes meta + acquires lock BEFORE spawning the runtime.
    // We need to inspect meta written by attachUnmanaged before any runCell.
    // The simplest exercise: write meta directly via the public surface that triggers writeMeta with no payload.
    // Use `manager.create()` (which calls attachUnmanaged) and check the meta written.
    // But create spawns the kernel which writes kernel.db. Hmm.
    // Workaround: read meta AFTER create but check it counted only existing payload files at that point.
    // Since kernel.db is created during spawnRuntime which is called from attachUnmanaged, kernel.db
    // will exist by the time writeMeta returns. So this test can't easily exercise the "0 payload files" case.
    // Skip this test as a unit assertion; the whitelist-only-counts behavior is already verified above.
    // Instead, verify payloadSize directly via the internal helper exposure (cast through unknown).
    const dir = join(root, 'p-empty');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    // Drop a lock.json and meta.json but no payload.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'lock.json'), '{}');
    writeFileSync(join(dir, 'meta.json'), '{}');
    const size = (mgr as unknown as { payloadSize(d: string): number }).payloadSize(dir);
    assert.equal(size, 0, 'payloadSize ignores lock.json + meta.json');
  });
});
```

- [ ] **Add `existsSync` to the test file's imports if not already present.** Most test blocks already use it; check the top of the file.

- [ ] **Run; expect FAIL** (current `dirSize` counts lock.json + meta.json):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 2.2 — Replace `dirSize` with `payloadSize`

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Find the existing `dirSize` method (lines 83-97):**

```ts
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
```

  and REPLACE with:

```ts
  private payloadSize(dir: string): number {
    let total = 0;
    for (const f of ['kernel.db', 'kernel.db.wal', 'namespace.json', 'cells.jsonl']) {
      try {
        total += statSync(join(dir, f)).size;
      } catch {
        // not present -> skip (no-op contribution)
      }
    }
    return total;
  }
```

### Step 2.3 — Update both call sites

- [ ] **Find the call in `writeMeta` (around line 143):**

```ts
      size_bytes: this.dirSize(dir),
```

  and replace with:

```ts
      size_bytes: this.payloadSize(dir),
```

- [ ] **Find the call in `fork` (around line 410, inside the dstMeta literal):**

```ts
      size_bytes: this.dirSize(dstDir),
```

  and replace with:

```ts
      size_bytes: this.payloadSize(dstDir),
```

### Step 2.4 — Remove unused `readdirSync` import

- [ ] **Find the `node:fs` import at the top of `scratchpad-manager.ts` (line 1):**

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

  `readdirSync` is no longer used anywhere in this file. Remove it:

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

- [ ] **Sanity-check:** search the file for any other `readdirSync` reference; there should be none.

```bash
grep -n "readdirSync" packages/coworker-scratchpad/src/scratchpad-manager.ts
```

Expected: no output.

### Step 2.5 — Run tests; expect PASS

- [ ] **Run; expect both new tests PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 2.6 — Commit

- [ ] **Commit Task 2:**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): size_bytes payload-only whitelist (replaces dirSize)

payloadSize() counts only kernel.db + kernel.db.wal + namespace.json +
cells.jsonl. Excludes lock.json (transient runtime overhead), meta.json
(self-referential during write), and any *.tmp (atomic-rename artifacts
from Task 3). Missing files contribute 0.

Eliminates two bugs at once:
- dirSize was computed BEFORE writeMeta wrote meta.json, so size_bytes
  always lagged one cycle.
- dirSize included lock.json + meta.json, inflating the reported
  scratchpad size with non-payload bytes.

dirSize is removed; readdirSync no longer needed (import cleaned up).
Two call sites swap (writeMeta + fork dstMeta).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `writeMetaAtomic` + 8 site swaps + kernel-entry namespace atomic

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-entry.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-entry.test.ts`

### Step 3.1 — Write failing tests

- [ ] **Append a new `describe` block to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the Task 2 block):

```ts
describe('ScratchpadManager (atomic meta writes — 1g3)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    mgr = new ScratchpadManager({ workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000 });
  });
  afterEach(async () => {
    await mgr.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('meta writes via writeMeta leave no .tmp artifact after success', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    const dir = join(root, 'p1');
    assert.ok(existsSync(join(dir, 'meta.json')), 'meta.json present');
    assert.equal(existsSync(join(dir, 'meta.json.tmp')), false, 'no .tmp leak');
  });

  it('meta writes via clearHistory leave no .tmp artifact', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.clearHistory('p1');
    const dir = join(root, 'p1');
    assert.ok(existsSync(join(dir, 'meta.json')), 'meta.json present');
    assert.equal(existsSync(join(dir, 'meta.json.tmp')), false, 'no .tmp leak');
  });
});
```

- [ ] **Run; expect PASS** on the FIRST test (current `writeFileSync` doesn't leak .tmp because it doesn't create one), but the test will run successfully. The test value is to LOCK IN the atomic-rename invariant going forward. Mark this as a regression-prevention test.

Wait — for TDD discipline, we want the test to fail FIRST. Re-read: these tests assert the absence of `.tmp` AND the presence of `meta.json`. The current code (writeFileSync directly to meta.json) satisfies BOTH conditions trivially. So these tests pass against the CURRENT code too.

To make this truly TDD, we'd need a test that fails against the current code and passes against the new code. Options:
- Inject a crash mid-write — hard to do in node:fs.
- Test the path via a stub that verifies tmp+rename was used.

For simplicity, we'll keep these as regression tests (they pin behavior that survives the refactor) AND add a behavioral test that verifies the rename happens via inspecting the internal helper directly. See Step 3.2 below.

### Step 3.2 — Add a third test that verifies writeMetaAtomic uses tmp+rename

- [ ] **Append one more test to the same describe block:**

```ts
  it('writeMetaAtomic uses tmp + rename (no .tmp leak; survives concurrent reader)', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    const path = join(root, 'p1', 'meta.json');
    // Spy on rename to confirm it was called for this path.
    // node:fs's renameSync is what the helper uses; we can verify by checking
    // the helper's internal behavior directly through a cast.
    const helper = (mgr as unknown as { writeMetaAtomic(path: string, payload: unknown): void });
    // Write a known payload.
    helper.writeMetaAtomic(path, { name: 'p1', schema_version: 3, custom_field: 'sentinel' });
    const written = JSON.parse(readFileSync(path, 'utf8')) as { custom_field?: string };
    assert.equal(written.custom_field, 'sentinel');
    assert.equal(existsSync(`${path}.tmp`), false, 'no .tmp leak after writeMetaAtomic');
  });
```

- [ ] **Run; expect FAIL on the third test** (`writeMetaAtomic` doesn't exist yet):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 3.3 — Add `renameSync` to imports + `writeMetaAtomic` helper

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Update the `node:fs` import (line 1) to add `renameSync`:**

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

- [ ] **Add the new private method directly after `payloadSize` (which was added in Task 2):**

```ts
  private writeMetaAtomic(path: string, payload: unknown): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2));
    renameSync(tmp, path);
  }
```

### Step 3.4 — Swap the 8 `writeFileSync` sites

Each site below has the EXACT current line and the EXACT replacement. Apply them in order.

- [ ] **Site 1: `writeMeta` (around line 149).** Find:

```ts
    writeFileSync(path, JSON.stringify(meta, null, 2));
```

  replace with:

```ts
    this.writeMetaAtomic(path, meta);
```

- [ ] **Site 2: `appendRecoveryNotes` (around line 168).** Find:

```ts
    writeFileSync(path, JSON.stringify(cur, null, 2));
```

  replace with:

```ts
    this.writeMetaAtomic(path, cur);
```

  (Multiple sites have this exact text. Make the edit at the appendRecoveryNotes site specifically — look for the line preceding `cur.recovery_notes = merged.slice(...)`.)

- [ ] **Site 3: `applySnapshotToMeta` (around line 185).** Find the same statement preceded by the `cur.namespace = { ... }` line (inside `applySnapshotToMeta`):

```ts
    writeFileSync(path, JSON.stringify(cur, null, 2));
```

  replace with:

```ts
    this.writeMetaAtomic(path, cur);
```

- [ ] **Site 4: `setLeaf` (around line 371).** Find the same statement preceded by `cur.cell_leaf_id = id;` and `cur.schema_version = META_SCHEMA_VERSION;`:

```ts
    writeFileSync(path, JSON.stringify(cur, null, 2));
```

  replace with:

```ts
    this.writeMetaAtomic(path, cur);
```

- [ ] **Site 5: `fork` dstMeta (around line 423).** Find:

```ts
    writeFileSync(join(dstDir, 'meta.json'), JSON.stringify(dstMeta, null, 2));
```

  replace with:

```ts
    this.writeMetaAtomic(join(dstDir, 'meta.json'), dstMeta);
```

- [ ] **Site 6: `clearHistory` (around line 463).** Find the statement inside the `if (existsSync(path))` block:

```ts
      writeFileSync(path, JSON.stringify(cur, null, 2));
```

  replace with:

```ts
      this.writeMetaAtomic(path, cur);
```

- [ ] **Site 7: `detach` (around line 496).** Find the statement after the array slicing logic:

```ts
      writeFileSync(path, JSON.stringify(cur, null, 2));
```

  replace with:

```ts
      this.writeMetaAtomic(path, cur);
```

- [ ] **Site 8: `markRecoveryNotesSeen` (around line 508).** Find:

```ts
    writeFileSync(path, JSON.stringify(cur, null, 2));
```

  replace with:

```ts
    this.writeMetaAtomic(path, cur);
```

- [ ] **Sanity check: confirm `writeFileSync` is no longer used for meta.json anywhere in the file.**

```bash
grep -n "writeFileSync.*meta\|writeFileSync.*JSON" packages/coworker-scratchpad/src/scratchpad-manager.ts
```

Expected: no output. (If there are any remaining hits, swap them too.)

Note: `writeFileSync` may still be used inside `writeMetaAtomic` itself (line in the new helper) — that's correct.

### Step 3.5 — Add `renameSync` to kernel-entry imports + atomic namespace write

- [ ] **Edit** `packages/coworker-scratchpad/src/kernel-entry.ts`. **Find the `node:fs` import (line 3):**

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
```

  replace with:

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
```

- [ ] **Find the namespace.json write (line 171):**

```ts
  writeFileSync(join(dir, 'namespace.json'), JSON.stringify(envelope));
```

  replace with:

```ts
  const nsPath = join(dir, 'namespace.json');
  const tmp = `${nsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(envelope));
  renameSync(tmp, nsPath);
```

### Step 3.6 — Add a kernel-entry test for namespace.json atomic-rename

- [ ] **Edit** `packages/coworker-scratchpad/src/kernel-entry.test.ts`. **Find a sensible insertion point — likely at the END of the existing top-level describe block. Add one new test:**

```ts
  it('snapshot writes namespace.json via tmp + rename (no .tmp leak — 1g3)', async () => {
    // Strategy: drive the kernel via ChildProcessRuntime, run a cell, snapshot,
    // confirm namespace.json exists and namespace.json.tmp does NOT.
    // (kernel-entry's snapshot handler is exercised through a real subprocess
    // in the existing tests; this just adds the .tmp absence assertion.)
    const ws = await mkdtemp(join(tmpdir(), 'ke-ws-'));
    const dir = await mkdtemp(join(tmpdir(), 'ke-dir-'));
    try {
      const rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: dir });
      await rt.start();
      await rt.runCell('globalThis.x = 1;');
      const res = await rt.snapshot();
      assert.equal(res.ok, true, 'snapshot acked');
      assert.ok(existsSync(join(dir, 'namespace.json')), 'namespace.json present');
      assert.equal(existsSync(join(dir, 'namespace.json.tmp')), false, 'no .tmp leak');
      await rt.dispose();
    } finally {
      await rm(ws, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });
```

- [ ] **Add any missing imports to `kernel-entry.test.ts`:** the test uses `existsSync`, `mkdtemp`, `rm`, `tmpdir`, `join`, `ChildProcessRuntime`. Most are already present; verify and add if missing.

- [ ] **Run kernel-entry tests; expect PASS** (since the kernel-side change has been made before this step):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-entry.test.ts
```

### Step 3.7 — Run the manager tests; expect PASS

- [ ] **Run; expect all 3 new manager tests + all 5 prior 1g3 tests PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 3.8 — Commit

- [ ] **Commit Task 3:**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts \
        packages/coworker-scratchpad/src/kernel-entry.ts \
        packages/coworker-scratchpad/src/kernel-entry.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): atomic rename for namespace.json + meta.json

Power-loss mid-write previously left a corrupt namespace.json or
meta.json on disk; 1g3 closes that. Pattern is the one Phase 1g
introduced for session sidecar writes: tmp file + renameSync.

Manager side: new private writeMetaAtomic(path, payload) replaces
8 direct writeFileSync sites (writeMeta, appendRecoveryNotes,
applySnapshotToMeta, setLeaf, fork dstMeta, clearHistory, detach,
markRecoveryNotesSeen). renameSync added to node:fs imports.

Kernel side: kernel-entry.ts snapshot handler now writes
namespace.json.tmp then renames. Single write site.

cells.jsonl deliberately unchanged — appendFileSync is syscall-atomic
and scan() already tolerates trailing-corrupt-line. lock.json
deliberately unchanged — acquireLock uses {flag:'wx'} which is
atomic-create.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Build + full gates

Verification-only. Run gates in the right ORDER (build BEFORE typecheck — the 1g lesson).

**Files:** none modified; verification only.

### Step 4.1 — Run all manager tests together (sanity)

- [ ] **Run the manager + kernel-entry test files to catch any cross-task regression:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/coworker-scratchpad/src/scratchpad-manager.test.ts \
  packages/coworker-scratchpad/src/kernel-entry.test.ts
```

Expected: all green. Manager should show ~155 tests (148 pre-1g3 + 7 from Tasks 1+2+3); kernel-entry +1 from Task 3.

### Step 4.2 — Build the coworker-scratchpad library (BEFORE typecheck)

- [ ] **Rebuild lib so dist/*.d.ts reflects the new exports:**

```bash
npm run build:coworker-scratchpad
```

Expected: clean build.

### Step 4.3 — Run the type gate

- [ ] **Typecheck all extensions against the freshly-built lib types:**

```bash
npm run typecheck:extensions
```

Expected: no type errors.

### Step 4.4 — Run the full package gate

- [ ] **Run all package tests (compiles to dist-test/ then runs node --test):**

```bash
npm run test:packages
```

Expected: all green. `@otto/coworker-scratchpad` should show ~155 tests.

### Step 4.5 — Run the full build

- [ ] **Run the core build:**

```bash
npm run build:core
```

Expected: clean build.

### Step 4.6 — Verification commit (only if amending needed)

- [ ] **No code change in Task 4. If any gate revealed issues, fix them in the appropriate prior task's files and AMEND that task's commit (preserve original HEREDOC + Co-Authored-By trailer). If all gates were green first time, no commit needed.**

---

## Self-review

After all four tasks pass:

**Spec coverage:**
- §3 locked decision 1 (fork escalation 5s + SIGKILL + 5s + throw) → Task 1
- §3 locked decision 2 (size_bytes payload whitelist) → Task 2
- §3 locked decision 3 (payloadSize REPLACES dirSize) → Task 2 (removes dirSize entirely)
- §3 locked decision 4 (atomic rename for namespace.json + meta.json; NOT cells.jsonl/lock.json) → Task 3
- §3 locked decision 5 (writeMetaAtomic private to ScratchpadManager) → Task 3
- §3 locked decision 6 (ForkKernelHangError exported from package barrel) → Task 1 (index.ts edit)
- §3 locked decision 7 (raceWithTimeout module-private) → Task 1
- §3 locked decision 8 (no schema bump) → respected; no META_SCHEMA_VERSION change
- §4.1 ForkKernelHangError class → Task 1
- §4.2 raceWithTimeout helper → Task 1
- §4.3 fork escalation logic → Task 1
- §4.4 payloadSize whitelist → Task 2
- §4.5 writeMetaAtomic + 8 sites → Task 3
- §4.6 kernel-side namespace atomic-rename → Task 3
- §8 error handling rows → covered by tests in Tasks 1-3 + production behavior

**Plan adjustment vs spec:**
- Spec §10 deferred `forkExitTimeoutMs` runtime option; this plan adds it for testability only. Default = FORK_EXIT_TIMEOUT_MS (5000); production behavior unchanged. Documented at the top of the plan.

**Test count delta:**
- Task 1: +3 (fork escalation: happy / SIGKILL / hang)
- Task 2: +2 (payloadSize whitelist / cold dir)
- Task 3: +3 manager (no-.tmp-after-writeMeta / no-.tmp-after-clearHistory / writeMetaAtomic direct) + 1 kernel-entry (no-.tmp-after-snapshot)
- Total lib: +7 manager + 1 kernel-entry → 148 + 8 = ~156 (close to spec's ~155)

**Out of scope (correctly NOT touched):**
- cells.jsonl atomicity (already safe)
- lock.json atomicity (acquireLock uses `wx`)
- Schema bumps
- Phase 2+ items
