# Otto Co-Worker Phase 1g — Session Affinity + Scratchpad Ops Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `/sp save`, `/sp detach`, `/sp clear-history`, a confirm-on-current branch in `/sp remove`, and per-session `currentName` persistence via sidecar — closing the deferred polish backlog from 1c2/1d/1e/1f.

**Architecture:** Three new methods on `ScratchpadManager` (`save`, `clearHistory`, `detach`) plus `CellArchive.reset()`. New extension module `session-sidecar.ts` with atomic-rename writes. Three new verbs + a confirm prompt added to `sp-command.ts`. Session sidecar restored on `session_start`. No meta schema bump.

**Tech Stack:** Node 22, `node:test`, `node:fs`, atomic rename, existing 1f-era `ScratchpadManager` + `ChildProcessRuntime`.

**Branch:** `feat/coworker-phase-0` (do NOT merge between sub-phases; 1g3 closes Phase 1).

**Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-1g-session-affinity-design.md`

---

## File Structure

```
packages/coworker-scratchpad/src/
  cell-archive.ts                ← MODIFY: add reset()
  cell-archive.test.ts           ← MODIFY: +2 tests
  scratchpad-manager.ts          ← MODIFY: save() + clearHistory() + detach()
  scratchpad-manager.test.ts     ← MODIFY: +6 tests (2 per method)

src/resources/extensions/coworker-scratchpad/
  session-sidecar.ts             ← NEW: read/write/delete + path helper
  session-sidecar.test.ts        ← NEW: 5 tests
  sp-command.ts                  ← MODIFY: save + detach + clear-history verbs;
                                            remove confirm-on-current + --yes;
                                            attach/new sidecar writes;
                                            SpDeps gains getSessionId()
  sp-command.test.ts             ← MODIFY: +8 tests
  index.ts                       ← MODIFY: session_start restore;
                                            getSessionId() accessor wired into deps
  index.test.ts                  ← MODIFY: +3 tests
```

## Standing test commands

- **Single library test file (fast iteration):**
  ```bash
  node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<file>.test.ts
  ```
- **Single extension test file:**
  ```bash
  node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/<file>.test.ts
  ```
- **Package gate:** `npm run test:packages` (compiles to `dist-test/` then runs all package tests)
- **Type gate:** `npm run typecheck:extensions`
- **Build gate:** `npm run build:coworker-scratchpad && npm run build:core`

---

## Task 1: `CellArchive.reset()` + `ScratchpadManager.clearHistory()`

Truncate-to-header behavior on the archive, manager method that calls it and rewrites meta.

**Files:**
- Modify: `packages/coworker-scratchpad/src/cell-archive.ts`
- Modify: `packages/coworker-scratchpad/src/cell-archive.test.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

### Step 1.1 — Write failing tests for `CellArchive.reset()`

- [ ] **Append to** `packages/coworker-scratchpad/src/cell-archive.test.ts` **just before the final `});` that closes the `describe('CellArchive', ...)` block:**

```ts
  it('reset truncates the file back to the schema header and clears lastId + leafId', () => {
    const a = new CellArchive(dir, () => 1000);
    a.append({ code: 'a', ok: true, value: 1, stdout: '' });
    a.append({ code: 'b', ok: true, value: 2, stdout: '' });
    assert.equal(a.lastId, 2);
    assert.equal(a.leafId, 2);
    a.reset();
    assert.equal(a.lastId, null);
    assert.equal(a.leafId, null);
    const ls = lines(cellsPath());
    assert.equal(ls.length, 1);
    assert.deepEqual(JSON.parse(ls[0]), { type: 'header', version: CELLS_SCHEMA_VERSION });
  });

  it('append after reset starts a fresh chain at id 1, parentId null', () => {
    const a = new CellArchive(dir, () => 1000);
    a.append({ code: 'a', ok: true, value: 1, stdout: '' });
    a.append({ code: 'b', ok: true, value: 2, stdout: '' });
    a.reset();
    const next = a.append({ code: 'c', ok: true, value: 3, stdout: '' });
    assert.equal(next.id, 1);
    assert.equal(next.parentId, null);
    assert.equal(a.lastId, 1);
    assert.equal(a.leafId, 1);
  });
```

- [ ] **Run the tests; expect them to FAIL with `a.reset is not a function`:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-archive.test.ts
```

### Step 1.2 — Implement `CellArchive.reset()`

- [ ] **Edit** `packages/coworker-scratchpad/src/cell-archive.ts`. **Add `writeFileSync` to the `node:fs` import on line 1:**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
```

- [ ] **Add the `reset()` method to the `CellArchive` class, immediately after the `setLeaf` method (after line 88):**

```ts
  reset(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify({ type: 'header', version: CELLS_SCHEMA_VERSION }) + '\n');
    this.nextId = 1;
    this.#lastId = null;
    this.#leafId = null;
  }
```

- [ ] **Run the tests; expect PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-archive.test.ts
```

### Step 1.3 — Write failing tests for `ScratchpadManager.clearHistory()`

- [ ] **Append to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` **a new `describe` block before the final closing of the file:**

```ts
describe('ScratchpadManager (clearHistory — 1g)', () => {
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

  it('clearHistory truncates cells.jsonl + resets archive + nulls meta pointers on a warm scratchpad', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.runCell('p1', 'globalThis.x = 2;');
    const cellsPathP1 = join(root, 'p1', 'cells.jsonl');
    const metaPathP1 = join(root, 'p1', 'meta.json');
    // sanity: 2 data lines + 1 header
    assert.equal(readFileSync(cellsPathP1, 'utf8').split('\n').filter((l) => l.includes('"id"')).length, 2);

    await mgr.clearHistory('p1');

    const remaining = readFileSync(cellsPathP1, 'utf8').split('\n').filter((l) => l.trim());
    assert.equal(remaining.length, 1, 'only schema header remains');
    assert.equal(JSON.parse(remaining[0]).type, 'header');
    const meta = JSON.parse(readFileSync(metaPathP1, 'utf8')) as Record<string, unknown>;
    assert.equal(meta.cell_leaf_id, null);
    assert.equal(meta.last_snapshot_cell_id, null);
    assert.equal(meta.last_snapshot_at, null);
  });

  it('clearHistory throws when a cell is currently running', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    const entry = (mgr as unknown as { entries: Map<string, { runtime: { hasActiveCell: boolean } | null }> }).entries.get('p1')!;
    // Simulate an active cell by stubbing the getter.
    Object.defineProperty(entry.runtime!, 'hasActiveCell', { get: () => true, configurable: true });
    await assert.rejects(() => mgr.clearHistory('p1'), /cell is running/);
  });
});
```

- [ ] **Run; expect FAIL (`mgr.clearHistory is not a function`):**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 1.4 — Implement `ScratchpadManager.clearHistory()`

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Add the new method directly after the existing `fork(...)` method (after line 398, before `private async attachUnmanaged(...)`):**

```ts
  async clearHistory(name: string): Promise<void> {
    this.assertNotDisposed();
    const entry = this.entries.get(name);
    if (entry?.runtime?.hasActiveCell) {
      throw new Error('cannot clear history while a cell is running');
    }
    if (entry?.archive) {
      entry.archive.reset();
    } else {
      // Cold path: construct a temp archive solely to reuse its truncation logic.
      const tmpArchive = new CellArchive(this.dirFor(name), this.now);
      tmpArchive.reset();
    }
    // Direct meta read-modify-write; we explicitly do NOT route through writeMeta
    // because writeMeta pulls cell_leaf_id from the live archive — which is exactly
    // what we just nulled, but writeMeta would also re-add this.sessionId, which
    // we want preserved untouched here. Safer to read+merge+write directly.
    const path = this.metaPath(name);
    if (existsSync(path)) {
      let cur: Record<string, unknown> = {};
      try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* drop */ }
      cur.cell_leaf_id = null;
      cur.last_snapshot_cell_id = null;
      cur.last_snapshot_at = null;
      writeFileSync(path, JSON.stringify(cur, null, 2));
    }
  }
```

- [ ] **Run; expect PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 1.5 — Commit

- [ ] **Commit Task 1:**

```bash
git add packages/coworker-scratchpad/src/cell-archive.ts \
        packages/coworker-scratchpad/src/cell-archive.test.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): CellArchive.reset() + ScratchpadManager.clearHistory()

reset() truncates cells.jsonl back to the schema header line and zeros
nextId/#lastId/#leafId. clearHistory() refuses while a cell is active,
calls reset() (warm or cold via a temp archive), and nulls
cell_leaf_id/last_snapshot_cell_id/last_snapshot_at in meta — cell-id
space restarts, so prior pointers would dangle.

kernel.db + namespace.json are deliberately preserved; clearing
history does NOT reset in-VM globals.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ScratchpadManager.save()` + `.detach()`

Two more manager methods on the same persistence funnel.

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

### Step 2.1 — Write failing tests for `save()`

- [ ] **Append a new `describe` block to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the `clearHistory` describe from Task 1):

```ts
describe('ScratchpadManager (save + detach — 1g)', () => {
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

  it('save snapshots namespace.json and writes last_snapshot_cell_id + last_snapshot_at without disposing', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.runCell('p1', 'globalThis.x = 2;');
    await mgr.save('p1');
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(meta.last_snapshot_cell_id, 2);
    assert.equal(typeof meta.last_snapshot_at, 'string');
    // Still warm: another cell can be run without re-attach.
    const r = await mgr.runCell('p1', 'globalThis.x;');
    assert.equal(r.value, 2);
  });

  it('save throws when the scratchpad is cold or unknown', async () => {
    await assert.rejects(() => mgr.save('never-existed'), /not warm/);
  });

  it('detach removes this sessionId from attached_sessions; runtime untouched', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    let meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { attached_sessions: string[] };
    assert.deepEqual(meta.attached_sessions, ['sess-1']);

    await mgr.detach('p1', 'sess-1');

    meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { attached_sessions: string[] };
    assert.deepEqual(meta.attached_sessions, []);
    // Runtime intentionally still alive — pool LRU/idle eviction handles cleanup.
    const entry = (mgr as unknown as { entries: Map<string, { runtime: unknown }> }).entries.get('p1')!;
    assert.ok(entry.runtime, 'detach does not dispose the runtime');
  });

  it('detach is a no-op on attached_sessions when sessionId is not in the list', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.detach('p1', 'some-other-session');
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { attached_sessions: string[] };
    assert.deepEqual(meta.attached_sessions, ['sess-1']);
  });
});
```

- [ ] **Run; expect FAIL (`mgr.save is not a function`, `mgr.detach is not a function`):**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 2.2 — Implement `save()` + `detach()`

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Add both methods after the `clearHistory()` method added in Task 1 (before `private async attachUnmanaged`):**

```ts
  async save(name: string): Promise<void> {
    this.assertNotDisposed();
    const entry = this.entries.get(name);
    if (!entry || !entry.runtime) {
      throw new Error(`scratchpad ${name} is not warm — nothing to save`);
    }
    if (entry.runtime.hasActiveCell) {
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: 'active cell' }]);
      throw new Error('cannot save while a cell is running');
    }
    const res = await entry.runtime.snapshot();
    if (res.ok) {
      this.applySnapshotToMeta(name, entry, res);
    } else {
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: res.error.message }]);
      throw new Error(`save failed: ${res.error.message}`);
    }
  }

  async detach(name: string, sessionId: string): Promise<void> {
    this.assertNotDisposed();
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return; }
    const arr = Array.isArray(cur.attached_sessions) ? (cur.attached_sessions as string[]) : [];
    const idx = arr.indexOf(sessionId);
    if (idx >= 0) {
      cur.attached_sessions = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
      writeFileSync(path, JSON.stringify(cur, null, 2));
    }
    // Runtime explicitly NOT disposed. Pool LRU/idle eviction owns cleanup.
  }
```

- [ ] **Run; expect PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 2.3 — Commit

- [ ] **Commit Task 2:**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): ScratchpadManager.save() + .detach()

save() flushes namespace.json and updates last_snapshot_cell_id +
last_snapshot_at via the existing applySnapshotToMeta path; kernel
stays warm (no dispose). Active-cell gate writes a snapshot-failed
recovery note + throws. Cold/unknown target throws "not warm".

detach() drops the named sessionId from meta.attached_sessions[] (first
occurrence only). Tolerates "not in list" silently. Runtime intentionally
untouched — pool LRU/idle eviction owns kernel cleanup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `session-sidecar.ts` extension module

Pure read/write/delete + path helper. Atomic rename. Lives in the extension dir.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/session-sidecar.ts`
- Create: `src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts`

### Step 3.1 — Write failing test

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sessionSidecarPath,
  readSessionSidecar,
  writeSessionSidecar,
  deleteSessionSidecar,
  type SessionSidecar,
} from './session-sidecar.js';

let root: string;

describe('session-sidecar', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sp-sess-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('sessionSidecarPath composes <root>/_sessions/<sessionId>.json', () => {
    assert.equal(sessionSidecarPath(root, 'sess-1'), join(root, '_sessions', 'sess-1.json'));
  });

  it('write + read roundtrip preserves payload', () => {
    const payload: SessionSidecar = {
      schema_version: 1,
      session_id: 'sess-1',
      current_name: 'p1',
      attached_at: '2026-06-01T10:00:00.000Z',
    };
    writeSessionSidecar(sessionSidecarPath(root, 'sess-1'), payload);
    const back = readSessionSidecar(sessionSidecarPath(root, 'sess-1'));
    assert.deepEqual(back, payload);
  });

  it('write uses atomic rename — no .tmp left behind, no partial reads', () => {
    const path = sessionSidecarPath(root, 'sess-2');
    writeSessionSidecar(path, {
      schema_version: 1, session_id: 'sess-2', current_name: 'p2', attached_at: 't',
    });
    assert.ok(existsSync(path));
    assert.ok(!existsSync(`${path}.tmp`), 'no .tmp survives a successful write');
  });

  it('read returns null on missing, corrupt JSON, or wrong shape', () => {
    // missing
    assert.equal(readSessionSidecar(sessionSidecarPath(root, 'absent')), null);
    // corrupt JSON
    const corrupt = sessionSidecarPath(root, 'sess-3');
    mkdirSync(join(root, '_sessions'), { recursive: true });
    writeFileSync(corrupt, '{not json');
    assert.equal(readSessionSidecar(corrupt), null);
    // wrong shape
    const wrong = sessionSidecarPath(root, 'sess-4');
    writeFileSync(wrong, JSON.stringify({ schema_version: 2 })); // wrong version + missing fields
    assert.equal(readSessionSidecar(wrong), null);
  });

  it('delete is idempotent (missing file does not throw)', () => {
    const path = sessionSidecarPath(root, 'never');
    deleteSessionSidecar(path); // first call — no file
    deleteSessionSidecar(path); // second call — still no file
    // also works on a file that DOES exist
    writeSessionSidecar(sessionSidecarPath(root, 'sess-5'), {
      schema_version: 1, session_id: 'sess-5', current_name: 'p5', attached_at: 't',
    });
    const realPath = sessionSidecarPath(root, 'sess-5');
    deleteSessionSidecar(realPath);
    assert.ok(!existsSync(realPath));
    // The contents of the file shouldn't matter, but the readFileSync import keeps the linter happy if needed.
    void readFileSync;
  });
});
```

- [ ] **Run; expect FAIL (`Cannot find module './session-sidecar.js'`):**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts
```

### Step 3.2 — Implement the module

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/session-sidecar.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SessionSidecar {
  schema_version: 1;
  session_id: string;
  current_name: string;
  attached_at: string;
}

export function sessionSidecarPath(rootDir: string, sessionId: string): string {
  return join(rootDir, '_sessions', `${sessionId}.json`);
}

export function readSessionSidecar(path: string): SessionSidecar | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionSidecar>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.session_id === 'string' &&
      typeof parsed.current_name === 'string' &&
      typeof parsed.attached_at === 'string'
    ) {
      return parsed as SessionSidecar;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSessionSidecar(path: string, payload: SessionSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function deleteSessionSidecar(path: string): void {
  rmSync(path, { force: true });
}
```

- [ ] **Run; expect PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts
```

### Step 3.3 — Commit

- [ ] **Commit Task 3:**

```bash
git add src/resources/extensions/coworker-scratchpad/session-sidecar.ts \
        src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad-ext): session-sidecar.ts (atomic-rename writes)

Pure helpers for the per-session currentName affinity sidecar at
<root>/_sessions/<sessionId>.json. write uses tmp+rename for atomicity
(preview of the 1g3 namespace.json hardening). read returns null on
missing, corrupt JSON, or wrong shape. delete is idempotent.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extension wiring — sp-command verbs + sidecar writes

Three new verbs (`save`, `detach`, `clear-history`), confirm-on-current branch in `remove`, sidecar writes on `attach`/`new`, `getSessionId()` accessor in `SpDeps`.

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

### Step 4.1 — Write failing tests

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`. **Replace the `StubMgr` interface and `makeStub` function (lines 8–27) with this expanded version** so stubs cover the new manager methods:

```ts
interface StubMgr {
  list(): Array<{ name: string; live: boolean; lastUsedAt: number }>;
  create(name: string): Promise<unknown>;
  getOrAttach(name: string): Promise<unknown>;
  remove(name: string): Promise<void>;
  save(name: string): Promise<void>;
  detach(name: string, sessionId: string): Promise<void>;
  clearHistory(name: string): Promise<void>;
  rootDir(): string;
  calls: Array<[string, ...unknown[]]>;
}

function makeStub(root: string, existing: string[] = []): StubMgr {
  const calls: StubMgr['calls'] = [];
  return {
    calls,
    rootDir: () => root,
    list() { calls.push(['list']); return existing.map((n) => ({ name: n, live: false, lastUsedAt: 0 })); },
    async create(name) { calls.push(['create', name]); if (existing.includes(name)) throw new Error(`scratchpad ${name} already exists`); existing.push(name); return null; },
    async getOrAttach(name) { calls.push(['getOrAttach', name]); if (!existing.includes(name)) existing.push(name); return null; },
    async remove(name) { calls.push(['remove', name]); const i = existing.indexOf(name); if (i >= 0) existing.splice(i, 1); },
    async save(name) { calls.push(['save', name]); if (!existing.includes(name)) throw new Error(`scratchpad ${name} is not warm — nothing to save`); },
    async detach(name, sid) { calls.push(['detach', name, sid]); },
    async clearHistory(name) { calls.push(['clearHistory', name]); },
  };
}
```

- [ ] **Replace** `makeCtx()` (lines 35-38) to add a `confirm` stub controllable per test:

```ts
function makeCtx(confirmAnswer: boolean = true): FakeCtx {
  const notifications: FakeCtx['notifications'] = [];
  return {
    notifications,
    hasUI: false,
    cwd: process.cwd(),
    ui: {
      notify: (m, l) => notifications.push([l, m]),
      confirm: async (_title: string, _msg: string) => confirmAnswer,
    },
  };
}
```

- [ ] **Update the `FakeCtx` interface (line 29-34) to include `confirm`:**

```ts
interface FakeCtx {
  notifications: Array<[string, string]>;
  hasUI: boolean;
  cwd: string;
  ui: {
    notify: (msg: string, level: string) => void;
    confirm: (title: string, msg: string) => Promise<boolean>;
  };
}
```

- [ ] **Update the `wire(...)` function's `deps` block (around line 64-69) to include `getSessionId`:**

```ts
    const deps: SpDeps = {
      getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
      getSessionId: () => 'sess-1',
    } as SpDeps;
```

- [ ] **Add a new `wireWithConfirm(...)` helper next to `wire(...)`** that lets tests control the confirm answer:

```ts
  function wireWithConfirm(confirm: boolean, existing: string[] = []): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const ctx = makeCtx(confirm);
    const mgr = makeStub(root, existing);
    const current = { name: null as string | null };
    const deps: SpDeps = {
      getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
      getSessionId: () => 'sess-1',
    } as SpDeps;
    registerSpCommand(pi as unknown as Parameters<typeof registerSpCommand>[0], deps);
    return { pi, ctx, mgr, current };
  }
```

- [ ] **Add 8 new `it(...)` blocks just before the final `});` of the `describe('sp-command dispatch (stubbed manager)', ...)` block:**

```ts
  it('/sp save calls manager.save on current scratchpad', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('save', ctx);
    assert.deepEqual(mgr.calls, [['save', 'p1']]);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /saved p1/.test(m)));
  });

  it('/sp save errors when no current and no arg', async () => {
    const { pi, ctx, mgr } = wire();
    await pi.commands.get('sp')!.handler('save', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /no current scratchpad/.test(m)));
  });

  it('/sp detach removes current and clears currentName', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('detach', ctx);
    assert.deepEqual(mgr.calls, [['detach', 'p1', 'sess-1']]);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /detached from p1/.test(m)));
  });

  it('/sp detach errors when not attached', async () => {
    const { pi, ctx, mgr } = wire();
    await pi.commands.get('sp')!.handler('detach', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /not attached/.test(m)));
  });

  it('/sp clear-history confirms then calls manager.clearHistory', async () => {
    const { pi, ctx, mgr, current } = wireWithConfirm(true, ['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('clear-history', ctx);
    assert.deepEqual(mgr.calls, [['clearHistory', 'p1']]);
  });

  it('/sp clear-history cancels when confirm returns false', async () => {
    const { pi, ctx, mgr, current } = wireWithConfirm(false, ['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('clear-history', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp remove on current scratchpad confirms; --yes skips confirm', async () => {
    // confirm=false => without --yes, remove is blocked
    const { pi: pi1, ctx: ctx1, mgr: mgr1, current: cur1 } = wireWithConfirm(false, ['p1']);
    cur1.name = 'p1';
    await pi1.commands.get('sp')!.handler('remove p1', ctx1);
    assert.deepEqual(mgr1.calls, []);
    assert.ok(ctx1.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));

    // --yes flag bypasses the prompt even with confirm=false
    const { pi: pi2, ctx: ctx2, mgr: mgr2, current: cur2 } = wireWithConfirm(false, ['p1']);
    cur2.name = 'p1';
    await pi2.commands.get('sp')!.handler('remove p1 --yes', ctx2);
    assert.deepEqual(mgr2.calls, [['remove', 'p1']]);
    assert.equal(cur2.name, null);
  });

  it('/sp remove of non-current scratchpad does NOT confirm', async () => {
    const { pi, ctx, mgr, current } = wireWithConfirm(false, ['p1', 'p2']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('remove p2', ctx);
    // confirm=false should not block because p2 != current; remove proceeds.
    assert.deepEqual(mgr.calls, [['remove', 'p2']]);
    assert.equal(current.name, 'p1', 'currentName preserved');
  });
```

- [ ] **Run; expect FAIL on the new tests:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

### Step 4.2 — Implement the extension changes

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/sp-command.ts`. **Update the imports at the top to include sidecar helpers:**

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import type { ScratchpadManager } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl, readPersistedLeaf } from './helpers.js';
import { projectTree, formatTreeText } from '@otto/coworker-scratchpad';
import { sessionSidecarPath, writeSessionSidecar, deleteSessionSidecar } from './session-sidecar.js';
```

- [ ] **Update `SpDeps` (the interface starting line 8) and `SpVerb` / `VERBS` (lines 15–16):**

```ts
export interface SpDeps {
  getManager: () => ScratchpadManager;
  getCurrentName: () => string | null;
  setCurrentName: (name: string | null) => void;
  rootDir: () => string;
  getSessionId: () => string;
}

type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove' | 'tree' | 'fork' | 'save' | 'detach' | 'clear-history';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove', 'tree', 'fork', 'save', 'detach', 'clear-history'];
```

- [ ] **Update the `UiCtx` interface (around line 47-50) to expose `confirm`:**

```ts
interface UiCtx {
  hasUI: boolean;
  ui: {
    notify: (msg: string, level: 'info' | 'error' | 'warning') => void;
    confirm: (title: string, msg: string) => Promise<boolean>;
  };
}
```

- [ ] **Modify the existing `case 'new':` handler to write the sidecar:** find the existing block:

```ts
          case 'new': {
            if (!name) { ctx.ui.notify('Usage: /sp new <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().create(name);
            deps.setCurrentName(name);
            ctx.ui.notify(`created scratchpad: ${name} (now current)`, 'info');
            return;
          }
```

  and replace with:

```ts
          case 'new': {
            if (!name) { ctx.ui.notify('Usage: /sp new <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().create(name);
            deps.setCurrentName(name);
            writeSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()), {
              schema_version: 1,
              session_id: deps.getSessionId(),
              current_name: name,
              attached_at: new Date().toISOString(),
            });
            ctx.ui.notify(`created scratchpad: ${name} (now current)`, 'info');
            return;
          }
```

- [ ] **Modify the existing `case 'attach':` handler the same way:** replace:

```ts
          case 'attach': {
            if (!name) { ctx.ui.notify('Usage: /sp attach <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().getOrAttach(name);
            deps.setCurrentName(name);
            ctx.ui.notify(`attached to scratchpad: ${name}`, 'info');
            return;
          }
```

  with:

```ts
          case 'attach': {
            if (!name) { ctx.ui.notify('Usage: /sp attach <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().getOrAttach(name);
            deps.setCurrentName(name);
            writeSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()), {
              schema_version: 1,
              session_id: deps.getSessionId(),
              current_name: name,
              attached_at: new Date().toISOString(),
            });
            ctx.ui.notify(`attached to scratchpad: ${name}`, 'info');
            return;
          }
```

- [ ] **Replace the existing `case 'remove':` block** (around line 141-148):

```ts
          case 'remove': {
            if (!name) { ctx.ui.notify('Usage: /sp remove <name> [--yes]', 'error'); return; }
            const force = parts.includes('--yes');
            validateName(name);
            if (name === deps.getCurrentName() && !force) {
              const confirmed = await ctx.ui.confirm(
                'Remove current scratchpad?',
                `${name} is your current scratchpad. Remove it? This deletes kernel.db, namespace.json, and the cell journal.`,
              );
              if (!confirmed) { ctx.ui.notify('cancelled', 'info'); return; }
            }
            const wasCurrent = name === deps.getCurrentName();
            await deps.getManager().remove(name);
            if (wasCurrent) {
              deleteSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()));
              deps.setCurrentName(null);
            }
            ctx.ui.notify(`removed scratchpad: ${name}`, 'info');
            return;
          }
```

- [ ] **Add three new cases** to the verb switch, inserted just before the existing `default:` block:

```ts
          case 'save': {
            const target = name ?? deps.getCurrentName();
            if (!target) { ctx.ui.notify('Usage: /sp save [<name>] — no current scratchpad', 'error'); return; }
            validateName(target);
            await deps.getManager().save(target);
            ctx.ui.notify(`saved ${target}`, 'info');
            return;
          }
          case 'detach': {
            const target = deps.getCurrentName();
            if (!target) { ctx.ui.notify('not attached to any scratchpad', 'error'); return; }
            await deps.getManager().detach(target, deps.getSessionId());
            deleteSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()));
            deps.setCurrentName(null);
            ctx.ui.notify(`detached from ${target}`, 'info');
            return;
          }
          case 'clear-history': {
            const target = name ?? deps.getCurrentName();
            if (!target) { ctx.ui.notify('Usage: /sp clear-history [<name>] — no current scratchpad', 'error'); return; }
            validateName(target);
            const confirmed = await ctx.ui.confirm(
              'Clear cell history?',
              `Clear cell history for ${target}? kernel.db + namespace.json are preserved.`,
            );
            if (!confirmed) { ctx.ui.notify('cancelled', 'info'); return; }
            await deps.getManager().clearHistory(target);
            ctx.ui.notify(`cleared cell history for ${target}`, 'info');
            return;
          }
```

- [ ] **Update the command's `description` line (line 54)** to advertise the new verbs:

```ts
    description: 'Manage scratchpads: /sp [list|new|attach|reset|view|remove|tree|fork|save|detach|clear-history] [name]',
```

- [ ] **Run; expect PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

### Step 4.3 — Commit

- [ ] **Commit Task 4:**

```bash
git add src/resources/extensions/coworker-scratchpad/sp-command.ts \
        src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad-ext): /sp save + detach + clear-history; remove confirm; sidecar writes

Adds three new verbs to /sp:
  save           — explicit no-dispose snapshot via manager.save
  detach         — drop sessionId from attached_sessions, clear sidecar
  clear-history  — confirm + truncate cells.jsonl + null pointer fields

/sp remove now confirms when target == currentName; --yes skips. /sp
attach + /sp new write the per-session sidecar at <root>/_sessions/
<sessionId>.json after setting currentName. SpDeps gains getSessionId().
UiCtx now requires ui.confirm() (already exists on the real
ExtensionUIContext).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extension restore on `session_start` + gates

Wire `getSessionId()` accessor, read sidecar on startup, restore `currentName`, run the full test gates.

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/index.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/index.test.ts`

### Step 5.1 — Write failing tests

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/index.test.ts`. **Add a new describe block at the end of the file (after the existing `describe('coworker-scratchpad extension (live kernel)', ...)` block):**

```ts
describe('coworker-scratchpad extension (session affinity — 1g)', () => {
  let workspace: string;
  let scratchpadRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'spext-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    scratchpadRoot = await mkdtemp(join(tmpdir(), 'spext-root-'));
    process.env.OTTO_SCRATCHPAD_ROOT = scratchpadRoot;
  });
  afterEach(async () => {
    delete process.env.OTTO_SCRATCHPAD_ROOT;
    await rm(workspace, { recursive: true, force: true });
    await rm(scratchpadRoot, { recursive: true, force: true });
  });

  function makeSessionCtx(sessionFile: string | undefined): {
    cwd: string;
    sessionManager: { getSessionFile: () => string | undefined };
    hasUI: boolean;
    ui: { notify: (m: string, l: string) => void; confirm: (a: string, b: string) => Promise<boolean> };
    notifications: Array<[string, string]>;
  } {
    const notifications: Array<[string, string]> = [];
    return {
      cwd: workspace,
      sessionManager: { getSessionFile: () => sessionFile },
      hasUI: false,
      ui: {
        notify: (m, l) => notifications.push([l, m]),
        confirm: async () => true,
      },
      notifications,
    };
  }

  it('session_start restores currentName from a valid sidecar', async () => {
    // Pre-create the scratchpad on disk so the meta.json existence check passes.
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(scratchpadRoot, 'p1'), { recursive: true });
    await writeFile(join(scratchpadRoot, 'p1', 'meta.json'), '{}');
    // Pre-write a sidecar for sessionId=sess-A.
    await mkdir(join(scratchpadRoot, '_sessions'), { recursive: true });
    await writeFile(
      join(scratchpadRoot, '_sessions', 'sess-A.json'),
      JSON.stringify({ schema_version: 1, session_id: 'sess-A', current_name: 'p1', attached_at: 't' }),
    );

    const pi = makePi();
    coworkerScratchpadExtension(pi as any);
    const ctx = makeSessionCtx('/tmp/sess-A.jsonl');
    await pi.fire('session_start', {}, ctx);

    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /restored/.test(m)));
  });

  it('session_start clears the sidecar + notifies when the target scratchpad is gone', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(scratchpadRoot, '_sessions'), { recursive: true });
    const sidecarPath = join(scratchpadRoot, '_sessions', 'sess-B.json');
    await writeFile(
      sidecarPath,
      JSON.stringify({ schema_version: 1, session_id: 'sess-B', current_name: 'p-missing', attached_at: 't' }),
    );

    const pi = makePi();
    coworkerScratchpadExtension(pi as any);
    const ctx = makeSessionCtx('/tmp/sess-B.jsonl');
    await pi.fire('session_start', {}, ctx);

    assert.ok(!existsSync(sidecarPath), 'stale sidecar deleted');
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /not restored/.test(m)));
  });

  it('session_start with no sidecar is a silent no-op', async () => {
    const pi = makePi();
    coworkerScratchpadExtension(pi as any);
    const ctx = makeSessionCtx('/tmp/sess-C.jsonl');
    await pi.fire('session_start', {}, ctx);
    assert.equal(ctx.notifications.length, 0);
  });
});
```

- [ ] **Run; expect FAIL on the new tests (no restore behavior yet):**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/index.test.ts
```

### Step 5.2 — Implement restore-on-session_start + getSessionId in deps

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/index.ts`. **Replace the full file** with:

```ts
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@otto/pi-coding-agent';
import { ScratchpadManager } from '@otto/coworker-scratchpad';
import { registerSpCommand } from './sp-command.js';
import { registerScratchpadTool } from './scratchpad-tool.js';
import { sessionSidecarPath, readSessionSidecar, deleteSessionSidecar } from './session-sidecar.js';

function deriveScratchpadRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}

function deriveSessionId(ctx: ExtensionContext): string {
  const file = ctx.sessionManager.getSessionFile() as string | undefined;
  if (!file) return 'default';
  const base = basename(file);
  return base.endsWith('.jsonl') ? base.slice(0, -6) : base;
}

export default function coworkerScratchpadExtension(pi: ExtensionAPI): void {
  let manager: ScratchpadManager | null = null;
  let workspaceCwd: string | null = null;
  let sessionId: string | null = null;
  let currentName: string | null = null;
  const root = deriveScratchpadRoot();

  const getManager = (): ScratchpadManager => {
    if (!manager) {
      if (!workspaceCwd) throw new Error('scratchpad: manager requested before session_start');
      manager = new ScratchpadManager({
        workspace: workspaceCwd,
        root,
        sessionId: sessionId ?? 'default',
      });
    }
    return manager;
  };
  const getCurrentName = (): string | null => currentName;
  const setCurrentName = (n: string | null): void => { currentName = n; };
  const rootDir = (): string => root;
  const getSessionId = (): string => sessionId ?? 'default';

  registerSpCommand(pi, { getManager, getCurrentName, setCurrentName, rootDir, getSessionId });
  registerScratchpadTool(pi, { getManager, getCurrentName, setCurrentName, rootDir });

  pi.on('session_start', async (_event, ctx) => {
    workspaceCwd = ctx.cwd;
    sessionId = deriveSessionId(ctx);

    const sidecarPath = sessionSidecarPath(root, sessionId);
    const sidecar = readSessionSidecar(sidecarPath);
    if (!sidecar) return;

    const targetMeta = join(root, sidecar.current_name, 'meta.json');
    if (!existsSync(targetMeta)) {
      deleteSessionSidecar(sidecarPath);
      ctx.ui.notify(`previous scratchpad '${sidecar.current_name}' is gone; not restored`, 'info');
      return;
    }
    currentName = sidecar.current_name;
    ctx.ui.notify(`attached to ${sidecar.current_name} (restored)`, 'info');
  });

  pi.on('session_shutdown', async () => {
    if (manager) {
      await manager.disposeAll();
      manager = null;
    }
    // Sidecar deliberately NOT deleted here — survives so /resume restores.
  });
}
```

- [ ] **Run; expect PASS on the new tests:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/index.test.ts
```

### Step 5.3 — Run all coworker-scratchpad tests together (sanity)

- [ ] **Run every extension test file in the coworker-scratchpad dir to catch interaction regressions:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/coworker-scratchpad/helpers.test.ts \
  src/resources/extensions/coworker-scratchpad/index.test.ts \
  src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts \
  src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts \
  src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts \
  src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

Expected: all green, total ~56 tests.

### Step 5.4 — Run library gate

- [ ] **Run the full package test gate (compiles + runs every package's tests):**

```bash
npm run test:packages
```

Expected: all green. Test count for `@otto/coworker-scratchpad` should be ~140 (prior 132 + 8 new from Tasks 1–2).

### Step 5.5 — Run type + build gates

- [ ] **Type-check:**

```bash
npm run typecheck:extensions
```

Expected: no type errors.

- [ ] **Build:**

```bash
npm run build:coworker-scratchpad && npm run build:core
```

Expected: clean build.

### Step 5.6 — Commit

- [ ] **Commit Task 5:**

```bash
git add src/resources/extensions/coworker-scratchpad/index.ts \
        src/resources/extensions/coworker-scratchpad/index.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad-ext): restore currentName from sidecar on session_start

Wires getSessionId() into the deps passed to registerSpCommand. On
session_start, reads the per-session sidecar at <root>/_sessions/
<sessionId>.json; if it points to a still-existing scratchpad, sets
currentName and notifies "(restored)". If the target is gone,
deletes the stale sidecar and notifies "not restored". Missing sidecar
is a silent no-op. Sidecar is intentionally NOT deleted on
session_shutdown — that's what makes /resume work.

Restore is affinity-only: the kernel is NOT pre-warmed. The next
/sp exec triggers the normal getOrAttach cold->warm path.

Closes Phase 1g.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

After all five tasks pass:

**Spec coverage:**
- §3 locked decision 2 (`/sp save` semantics) → Task 2 + Task 4
- §3 locked decision 3 (`/sp clear-history` semantics) → Task 1 + Task 4
- §3 locked decision 4 (`/sp detach` semantics) → Task 2 + Task 4
- §3 locked decision 5 (`/sp remove` confirm + `--yes`) → Task 4
- §3 locked decision 6 (sidecar lifecycle) → Tasks 3, 4, 5
- §3 locked decision 7 (atomic rename) → Task 3
- §3 locked decision 8 (no schema bump) → respected (no `META_SCHEMA_VERSION` change)
- §4.1 `CellArchive.reset()` → Task 1
- §4.2a/b/c manager methods → Tasks 1 + 2
- §4.3 `session-sidecar.ts` → Task 3
- §4.4 sp-command verbs + remove confirm + attach/new sidecar writes → Task 4
- §4.5 `index.ts` restore + getSessionId → Task 5
- §6 error handling — every row covered by test or implementation

**Test count delta:**
- Library: +4 (cell-archive 2 + manager 2) +4 (manager save/detach 4) = +8 → ~140 total
- Extension: +5 (sidecar) +8 (sp-command) +3 (index) = +16 → ~56 total

**Out of scope (carried to 1g2/1g3 per spec §10):** recovery-notes banner, force-takeover prompt, divergence banner, fork timeout, size_bytes recompute, broader atomic-rename for namespace.json.
