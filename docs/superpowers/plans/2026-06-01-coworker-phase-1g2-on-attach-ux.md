# Otto Co-Worker Phase 1g2 — On-Attach UX Banners — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface unseen recovery notes, kernel-vs-view divergence, and a force-takeover prompt on `/sp attach` — closing the deferred UX backlog from 1c2/1d2/1f.

**Architecture:** Three notify-based banners after a successful attach; one new `/sp notes` verb for re-viewing; `--force-takeover` and `--reason` flags for scripting. Library tracks live kernel state in a new `Entry.kernelAtCellId` field; persists to `meta.kernel_at_cell_id` (additive — no schema bump). Recovery-notes "seen" cutoff in `meta.recovery_notes_seen_at`.

**Tech Stack:** Node 22, `node:test`, existing `ScratchpadManager` + `ChildProcessRuntime` from 1a–1g.

**Branch:** `feat/coworker-phase-0` (continues until 1g3 closes Phase 1).

**Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-1g2-on-attach-ux-design.md`

---

## Scope adjustment from spec (read first)

The spec's §4.1–§4.2 proposed enriching `ScratchpadBusyError` and persisting `takeover_reason` into `lock.json`. Reading the actual code (`packages/coworker-scratchpad/src/scratchpad-lock.ts`):

- `ScratchpadBusyError` ALREADY carries `holder: LockInfo` with `pid`, `host`, `acquired_at`.
- `acquireLock` ALREADY writes `takeoverReason` into `lock.json` as `takeover_from.reason` (line 82).
- `LockInfo` does NOT track `sessionId` — only pid + host. The confirm prompt text adjusts accordingly ("pid X on host Y" rather than "sess-Z").

So this plan drops the spec's lock-side work and consolidates to **5 tasks**:

1. `Entry.kernelAtCellId` lifecycle across attach/runCell/clearHistory/fork + `writeMeta` extension (lib)
2. `ScratchpadManager.markRecoveryNotesSeen` (lib)
3. `attach-banners.ts` pure helpers (ext)
4. `sp-command.ts` `case 'attach'` rewrite + `/sp notes` verb + `joinQuotedArg` (ext)
5. Build + full gates (test:packages + typecheck + build)

Spec coverage is unchanged — all locked decisions are still honored. Lock semantics 1+2 (decisions 5 + 6) are realized by code that already exists.

---

## File Structure

```
packages/coworker-scratchpad/src/
  scratchpad-manager.ts          ← MODIFY: Entry.kernelAtCellId; writeMeta extension;
                                            restoreKernelAtCellIdOnAttach helper;
                                            runCell + clearHistory + fork updates;
                                            new method markRecoveryNotesSeen()
  scratchpad-manager.test.ts     ← MODIFY: +6 tests across Tasks 1 + 2

src/resources/extensions/coworker-scratchpad/
  attach-banners.ts              ← NEW: showRecoveryNotesBanner + showDivergenceBanner
                                          + formatNoteLine
  attach-banners.test.ts         ← NEW: 6 tests
  sp-command.ts                  ← MODIFY: attach case rewrite (busy auto-prompt +
                                            reason capture + banner triggers);
                                            new 'notes' verb; joinQuotedArg helper;
                                            VERBS list update
  sp-command.test.ts             ← MODIFY: +8 tests
```

`index.ts`, `session-sidecar.ts`, `scratchpad-lock.ts`, `cell-archive.ts`, `cell-tree.ts` — unchanged.

## Standing test commands

```bash
# Single library test (fast iteration)
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<file>.test.ts

# Single extension test
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/<file>.test.ts

# Build (BEFORE typecheck — 1g lesson)
npm run build:coworker-scratchpad

# Type gate
npm run typecheck:extensions

# Package gate
npm run test:packages
```

---

## Task 1: `Entry.kernelAtCellId` lifecycle + `writeMeta` extension

Adds the live tracking field to Entry; wires lifecycle across attach (fresh + cold→warm), runCell, clearHistory, fork; extends writeMeta to persist + prevExtras to preserve across cold writes.

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

### Step 1.1 — Write failing tests

- [ ] **Append a new `describe` block to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the existing Phase 1g `describe` blocks):

```ts
describe('ScratchpadManager (kernel_at_cell_id — 1g2)', () => {
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

  it('runCell updates meta.kernel_at_cell_id to archive.lastId', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    const meta1 = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { kernel_at_cell_id?: unknown };
    assert.equal(meta1.kernel_at_cell_id, 1);
    await mgr.runCell('p1', 'globalThis.x = 2;');
    const meta2 = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { kernel_at_cell_id?: unknown };
    assert.equal(meta2.kernel_at_cell_id, 2);
  });

  it('clearHistory nulls meta.kernel_at_cell_id alongside the other pointers', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.clearHistory('p1');
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { kernel_at_cell_id?: unknown };
    assert.equal(meta.kernel_at_cell_id, null);
  });

  it('fork inherits kernel_at_cell_id from source meta', async () => {
    await mgr.runCell('src', 'globalThis.x = 1;');
    await mgr.runCell('src', 'globalThis.x = 2;');
    await mgr.fork('src', 'dst');
    const dstMeta = JSON.parse(readFileSync(join(root, 'dst', 'meta.json'), 'utf8')) as { kernel_at_cell_id?: unknown };
    assert.equal(dstMeta.kernel_at_cell_id, 2);
  });

  it('cold->warm attach restores kernelAtCellId from last_snapshot_cell_id', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.runCell('p1', 'globalThis.x = 2;');
    // Force a snapshot by disposing then re-attaching.
    await mgr.disposeAll();
    mgr = new ScratchpadManager({ workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000 });
    await mgr.getOrAttach('p1'); // cold -> warm
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as {
      kernel_at_cell_id?: unknown;
      last_snapshot_cell_id?: unknown;
    };
    // After dispose-then-attach: kernel restored from namespace.json which was at last_snapshot_cell_id.
    assert.equal(meta.kernel_at_cell_id, meta.last_snapshot_cell_id);
    assert.equal(meta.kernel_at_cell_id, 2);
  });

  it('writeMeta preserves kernel_at_cell_id across cold meta writes (prevExtras)', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.disposeAll();
    // Re-create manager. Cold writes via setLeaf would otherwise drop the field if not preserved.
    mgr = new ScratchpadManager({ workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000 });
    // Don't attach. Trigger a cold meta write via setLeaf (which writes meta directly).
    await mgr.setLeaf('p1', 1);
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { kernel_at_cell_id?: unknown };
    assert.equal(meta.kernel_at_cell_id, 1);
  });
});
```

- [ ] **Run; expect FAIL** on every new test (field doesn't exist yet):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 1.2 — Add `kernelAtCellId` to `Entry` interface

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Find the existing `Entry` interface (around line 34):**

```ts
interface Entry {
  runtime: ChildProcessRuntime | null; // null when cold (evicted, lock retained)
  lock: LockInfo;
  lastUsedAt: number;
  archive: CellArchive;
}
```

  and replace with:

```ts
interface Entry {
  runtime: ChildProcessRuntime | null; // null when cold (evicted, lock retained)
  lock: LockInfo;
  lastUsedAt: number;
  archive: CellArchive;
  kernelAtCellId: number | null; // 1g2: cell id at which the in-VM kernel state was last mutated
}
```

### Step 1.3 — Extend `writeMeta` to persist `kernel_at_cell_id`

- [ ] **Find the `prevExtras` preservation loop in `writeMeta` (line 112):**

```ts
        for (const k of ['last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes', 'cell_leaf_id']) {
          if (k in prev) prevExtras[k] = prev[k];
        }
```

  and replace with:

```ts
        for (const k of [
          'last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes',
          'cell_leaf_id', 'kernel_at_cell_id', 'recovery_notes_seen_at',
        ]) {
          if (k in prev) prevExtras[k] = prev[k];
        }
```

- [ ] **Find the live-archive cell_leaf_id pull (lines 126–129):**

```ts
    const archive = this.entries.get(name)?.archive;
    if (archive && archive.leafId !== null) {
      prevExtras.cell_leaf_id = archive.leafId;
    }
```

  and replace with:

```ts
    const archive = this.entries.get(name)?.archive;
    if (archive && archive.leafId !== null) {
      prevExtras.cell_leaf_id = archive.leafId;
    }
    const liveEntry = this.entries.get(name);
    if (liveEntry && liveEntry.kernelAtCellId !== null) {
      prevExtras.kernel_at_cell_id = liveEntry.kernelAtCellId;
    }
```

### Step 1.4 — Add `restoreKernelAtCellIdOnAttach` helper

- [ ] **Add a new private method directly after `restoreLeafOnAttach` (after line 234, before `private warmCount()`):**

```ts
  private restoreKernelAtCellIdOnAttach(name: string, entry: Entry): void {
    // Cold restore: kernel was hydrated from namespace.json, which was written at
    // last_snapshot_cell_id. That's where the in-VM state lives.
    const path = this.metaPath(name);
    if (!existsSync(path)) {
      entry.kernelAtCellId = null;
      return;
    }
    try {
      const cur = JSON.parse(readFileSync(path, 'utf8')) as { last_snapshot_cell_id?: unknown };
      const last = cur.last_snapshot_cell_id;
      entry.kernelAtCellId = typeof last === 'number' ? last : null;
    } catch {
      entry.kernelAtCellId = null;
    }
  }
```

### Step 1.5 — Call helpers from `attachUnmanaged` + `getOrAttach`

- [ ] **Find `getOrAttach` (around line 277). In the cold→warm transition path (after `restoreLeafOnAttach`):**

```ts
      existing.runtime = await this.spawnRuntime(name); // cold -> warm; namespace restored from disk (1d2)
      this.ingestRecoveryNotesOnAttach(name, existing);
      this.restoreLeafOnAttach(name, existing);
      return existing.runtime;
```

  add the new helper call between `restoreLeafOnAttach` and the return:

```ts
      existing.runtime = await this.spawnRuntime(name); // cold -> warm; namespace restored from disk (1d2)
      this.ingestRecoveryNotesOnAttach(name, existing);
      this.restoreLeafOnAttach(name, existing);
      this.restoreKernelAtCellIdOnAttach(name, existing);
      return existing.runtime;
```

- [ ] **Find `attachUnmanaged` (around line 400). After the existing leaf-restore (after line 419):**

```ts
    const entry: Entry = { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now) };
    this.entries.set(name, entry);
    this.ingestRecoveryNotesOnAttach(name, entry);
    this.restoreLeafOnAttach(name, entry);
    return runtime;
```

  modify to seed `kernelAtCellId` in the literal AND call the new helper after restoreLeaf:

```ts
    const entry: Entry = { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now), kernelAtCellId: null };
    this.entries.set(name, entry);
    this.ingestRecoveryNotesOnAttach(name, entry);
    this.restoreLeafOnAttach(name, entry);
    this.restoreKernelAtCellIdOnAttach(name, entry);
    return runtime;
```

### Step 1.6 — Update `runCell` success path

- [ ] **Find `runCell` (around line 292). Find the success append:**

```ts
    try {
      const result = await runtime.runCell(code);
      entry.archive.append({ code, ok: true, value: result.value, stdout: result.stdout });
      this.writeMeta(name);
      return result;
```

  and update to set `kernelAtCellId` before `writeMeta`:

```ts
    try {
      const result = await runtime.runCell(code);
      entry.archive.append({ code, ok: true, value: result.value, stdout: result.stdout });
      entry.kernelAtCellId = entry.archive.lastId;
      this.writeMeta(name);
      return result;
```

- [ ] **In the same `runCell`, find the failure append (a few lines below):**

```ts
    } catch (err) {
      const e = err as Error;
      try {
        entry.archive.append({ code, ok: false, error: { name: e.name, message: e.message }, stdout: '' });
        this.writeMeta(name);
```

  and update to also set `kernelAtCellId`:

```ts
    } catch (err) {
      const e = err as Error;
      try {
        entry.archive.append({ code, ok: false, error: { name: e.name, message: e.message }, stdout: '' });
        entry.kernelAtCellId = entry.archive.lastId;
        this.writeMeta(name);
```

### Step 1.7 — Update `clearHistory` to null `kernel_at_cell_id`

- [ ] **Find the existing `clearHistory` method (lines 400–426 in current file — the method added in Phase 1g). Find the warm-path archive reset:**

```ts
    if (entry?.archive) {
      entry.archive.reset();
    } else {
```

  and update to also null the live entry's kernel pointer:

```ts
    if (entry?.archive) {
      entry.archive.reset();
      entry.kernelAtCellId = null;
    } else {
```

- [ ] **In the same `clearHistory`, find the direct meta write:**

```ts
      cur.cell_leaf_id = null;
      cur.last_snapshot_cell_id = null;
      cur.last_snapshot_at = null;
      writeFileSync(path, JSON.stringify(cur, null, 2));
```

  and add the new field:

```ts
      cur.cell_leaf_id = null;
      cur.last_snapshot_cell_id = null;
      cur.last_snapshot_at = null;
      cur.kernel_at_cell_id = null;
      writeFileSync(path, JSON.stringify(cur, null, 2));
```

### Step 1.8 — Update `fork` to inherit `kernel_at_cell_id`

- [ ] **Find the existing `fork` method's `dstMeta` construction (around line 377). Find the literal:**

```ts
    const dstMeta = {
      name: dstName,
      created_at: nowIso,
      last_used: nowIso,
      attached_sessions: this.sessionId ? [this.sessionId] : [],
      size_bytes: this.dirSize(dstDir),
      schema_version: META_SCHEMA_VERSION,
      cell_leaf_id: typeof srcMeta.cell_leaf_id === 'number' ? srcMeta.cell_leaf_id : null,
      last_snapshot_cell_id: typeof srcMeta.last_snapshot_cell_id === 'number' ? srcMeta.last_snapshot_cell_id : null,
      last_snapshot_at: typeof srcMeta.last_snapshot_at === 'string' ? srcMeta.last_snapshot_at : null,
      namespace_skipped: [],
      recovery_notes: [],
      kernel_db: { present: existsSync(join(dstDir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dstDir, 'namespace.json')), schema_version: 1 },
    };
```

  and add `kernel_at_cell_id` inheritance (after `last_snapshot_at`, before `namespace_skipped`):

```ts
    const dstMeta = {
      name: dstName,
      created_at: nowIso,
      last_used: nowIso,
      attached_sessions: this.sessionId ? [this.sessionId] : [],
      size_bytes: this.dirSize(dstDir),
      schema_version: META_SCHEMA_VERSION,
      cell_leaf_id: typeof srcMeta.cell_leaf_id === 'number' ? srcMeta.cell_leaf_id : null,
      last_snapshot_cell_id: typeof srcMeta.last_snapshot_cell_id === 'number' ? srcMeta.last_snapshot_cell_id : null,
      last_snapshot_at: typeof srcMeta.last_snapshot_at === 'string' ? srcMeta.last_snapshot_at : null,
      kernel_at_cell_id: typeof srcMeta.kernel_at_cell_id === 'number'
        ? srcMeta.kernel_at_cell_id
        : (typeof srcMeta.last_snapshot_cell_id === 'number' ? srcMeta.last_snapshot_cell_id : null),
      namespace_skipped: [],
      recovery_notes: [],
      kernel_db: { present: existsSync(join(dstDir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dstDir, 'namespace.json')), schema_version: 1 },
    };
```

- [ ] **In the same `fork`, the dstEntry construction:**

```ts
    const dstEntry: Entry = { runtime: null, lock: dstLock, lastUsedAt: this.now(), archive: new CellArchive(dstDir, this.now) };
```

  needs the new field. Replace with:

```ts
    const dstEntry: Entry = {
      runtime: null,
      lock: dstLock,
      lastUsedAt: this.now(),
      archive: new CellArchive(dstDir, this.now),
      kernelAtCellId: dstMeta.kernel_at_cell_id,
    };
```

### Step 1.9 — Run tests; expect PASS

- [ ] **Run; expect all 5 new tests to PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 1.10 — Commit

- [ ] **Commit Task 1:**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): Entry.kernelAtCellId + meta.kernel_at_cell_id tracking

Adds live tracking of the cell id at which the kernel's in-VM state was
last mutated. Distinct from cell_leaf_id (journal pointer) and
last_snapshot_cell_id (durable namespace pointer).

Lifecycle:
- attachUnmanaged + getOrAttach cold->warm: seed from last_snapshot_cell_id
  via restoreKernelAtCellIdOnAttach (namespace.json was written there,
  so that's where in-VM globals live)
- runCell success/failure: set to archive.lastId before writeMeta
- clearHistory: null both in-memory + on disk alongside other pointers
- fork: dstMeta inherits from src.kernel_at_cell_id (or src.last_snapshot
  as fallback); dstEntry seeded to match

writeMeta pulls from live entry.kernelAtCellId; prevExtras preserves
across cold writes. Additive field; meta schema stays at v3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ScratchpadManager.markRecoveryNotesSeen`

Single new manager method that stamps `meta.recovery_notes_seen_at = nowIso`. Direct read-modify-write — same idiom as Phase 1g's `clearHistory` + `detach`.

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

### Step 2.1 — Write failing tests

- [ ] **Append a new `describe` block to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (after the Task 1 `describe` block):

```ts
describe('ScratchpadManager (markRecoveryNotesSeen — 1g2)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    mgr = new ScratchpadManager({
      workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000,
      now: () => Date.parse('2026-06-01T12:00:00.000Z'),
    });
  });
  afterEach(async () => {
    await mgr.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('markRecoveryNotesSeen stamps meta.recovery_notes_seen_at = nowIso', async () => {
    await mgr.runCell('p1', 'globalThis.x = 1;');
    await mgr.markRecoveryNotesSeen('p1');
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { recovery_notes_seen_at?: unknown };
    assert.equal(meta.recovery_notes_seen_at, '2026-06-01T12:00:00.000Z');
  });

  it('markRecoveryNotesSeen is silent when meta is missing', async () => {
    // No scratchpad created; method should not throw.
    await mgr.markRecoveryNotesSeen('absent');
    assert.ok(true);
  });
});
```

- [ ] **Run; expect FAIL (`mgr.markRecoveryNotesSeen is not a function`):**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 2.2 — Implement `markRecoveryNotesSeen`

- [ ] **Edit** `packages/coworker-scratchpad/src/scratchpad-manager.ts`. **Add the new method directly after the existing `detach()` method (added in Phase 1g, before `private async attachUnmanaged`):**

```ts
  async markRecoveryNotesSeen(name: string): Promise<void> {
    this.assertNotDisposed();
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return; }
    cur.recovery_notes_seen_at = new Date(this.now()).toISOString();
    writeFileSync(path, JSON.stringify(cur, null, 2));
  }
```

### Step 2.3 — Run tests; expect PASS

- [ ] **Run; expect both new tests PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts
```

### Step 2.4 — Commit

- [ ] **Commit Task 2:**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad): ScratchpadManager.markRecoveryNotesSeen()

Stamps meta.recovery_notes_seen_at = nowIso so the recovery-notes
banner won't re-nag on the next attach. Direct read-modify-write of
meta.json — same idiom as clearHistory + detach. Silent on missing
or corrupt meta.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `attach-banners.ts` extension module

Pure helpers — `showRecoveryNotesBanner` reads meta + emits a warning notify when there are unseen recovery notes; `showDivergenceBanner` reads meta + emits an info notify when `cell_leaf_id !== kernel_at_cell_id`.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/attach-banners.ts`
- Create: `src/resources/extensions/coworker-scratchpad/attach-banners.test.ts`

### Step 3.1 — Write failing tests

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/attach-banners.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { showRecoveryNotesBanner, showDivergenceBanner } from './attach-banners.js';

interface FakeUi {
  notifications: Array<[string, string]>;
  notify: (msg: string, level: 'info' | 'warning' | 'error') => void;
}

function makeUi(): FakeUi {
  const notifications: FakeUi['notifications'] = [];
  return { notifications, notify: (m, l) => notifications.push([l, m]) };
}

function writeMeta(root: string, name: string, meta: Record<string, unknown>): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'meta.json'), JSON.stringify(meta));
}

let root: string;

describe('attach-banners', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'banners-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('showRecoveryNotesBanner emits warning when there are unseen notes; returns markSeen=true', () => {
    writeMeta(root, 'p1', {
      recovery_notes: [
        { kind: 'snapshot-failed', message: 'boom', at: '2026-05-31T10:00:00.000Z' },
        { kind: 'cells-since-snapshot', n: 3, at: '2026-05-31T11:00:00.000Z' },
      ],
      recovery_notes_seen_at: null,
    });
    const ui = makeUi();
    const { unseenCount, markSeen } = showRecoveryNotesBanner('p1', root, ui);
    assert.equal(unseenCount, 2);
    assert.equal(markSeen, true);
    assert.equal(ui.notifications.length, 1);
    assert.equal(ui.notifications[0][0], 'warning');
    assert.match(ui.notifications[0][1], /2 unread recovery notes/);
    assert.match(ui.notifications[0][1], /snapshot-failed: boom/);
    assert.match(ui.notifications[0][1], /3 cells since last snapshot/);
  });

  it('showRecoveryNotesBanner does not notify when all notes are seen; returns markSeen=false', () => {
    writeMeta(root, 'p1', {
      recovery_notes: [
        { kind: 'snapshot-failed', message: 'boom', at: '2026-05-31T10:00:00.000Z' },
      ],
      recovery_notes_seen_at: '2026-05-31T11:00:00.000Z',
    });
    const ui = makeUi();
    const { unseenCount, markSeen } = showRecoveryNotesBanner('p1', root, ui);
    assert.equal(unseenCount, 0);
    assert.equal(markSeen, false);
    assert.equal(ui.notifications.length, 0);
  });

  it('showRecoveryNotesBanner truncates to 5 with "+ N more" footer', () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({
      kind: 'snapshot-failed' as const,
      message: `err-${i}`,
      at: `2026-05-31T1${i}:00:00.000Z`,
    }));
    writeMeta(root, 'p1', { recovery_notes: notes, recovery_notes_seen_at: null });
    const ui = makeUi();
    const { unseenCount } = showRecoveryNotesBanner('p1', root, ui);
    assert.equal(unseenCount, 8);
    assert.match(ui.notifications[0][1], /\+ 3 more \(run \/sp notes\)/);
    // Should include err-0..err-4 (first 5) but not err-5..err-7
    assert.match(ui.notifications[0][1], /err-0/);
    assert.match(ui.notifications[0][1], /err-4/);
    assert.equal(ui.notifications[0][1].includes('err-5'), false);
  });

  it('showRecoveryNotesBanner tolerates missing or corrupt meta silently', () => {
    const ui = makeUi();
    // Missing scratchpad dir
    const r1 = showRecoveryNotesBanner('absent', root, ui);
    assert.deepEqual(r1, { unseenCount: 0, markSeen: false });
    // Corrupt meta.json
    mkdirSync(join(root, 'p2'), { recursive: true });
    writeFileSync(join(root, 'p2', 'meta.json'), '{not json');
    const r2 = showRecoveryNotesBanner('p2', root, ui);
    assert.deepEqual(r2, { unseenCount: 0, markSeen: false });
    assert.equal(ui.notifications.length, 0);
  });

  it('showDivergenceBanner emits info when leaf !== kernel; both set', () => {
    writeMeta(root, 'p1', { cell_leaf_id: 5, kernel_at_cell_id: 8 });
    const ui = makeUi();
    const { diverged } = showDivergenceBanner('p1', root, ui);
    assert.equal(diverged, true);
    assert.equal(ui.notifications.length, 1);
    assert.equal(ui.notifications[0][0], 'info');
    assert.match(ui.notifications[0][1], /kernel state is at cell #8/);
    assert.match(ui.notifications[0][1], /view is at cell #5/);
    assert.match(ui.notifications[0][1], /\/sp tree to inspect/);
  });

  it('showDivergenceBanner does not notify when leaf===kernel, either is null, or meta missing', () => {
    const ui = makeUi();
    // Equal
    writeMeta(root, 'p1', { cell_leaf_id: 5, kernel_at_cell_id: 5 });
    assert.deepEqual(showDivergenceBanner('p1', root, ui), { diverged: false });
    // Leaf null
    writeMeta(root, 'p2', { cell_leaf_id: null, kernel_at_cell_id: 5 });
    assert.deepEqual(showDivergenceBanner('p2', root, ui), { diverged: false });
    // Kernel null
    writeMeta(root, 'p3', { cell_leaf_id: 5, kernel_at_cell_id: null });
    assert.deepEqual(showDivergenceBanner('p3', root, ui), { diverged: false });
    // Meta missing
    assert.deepEqual(showDivergenceBanner('absent', root, ui), { diverged: false });
    assert.equal(ui.notifications.length, 0);
  });
});
```

- [ ] **Run; expect FAIL (`Cannot find module './attach-banners.js'`):**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/attach-banners.test.ts
```

### Step 3.2 — Implement the module

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/attach-banners.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecoveryNote } from '@otto/coworker-scratchpad';

type RecoveryNoteEntry = RecoveryNote & { at: string };

interface UiNotify {
  notify: (msg: string, level: 'info' | 'warning' | 'error') => void;
}

export function showRecoveryNotesBanner(
  name: string,
  rootDir: string,
  ui: UiNotify,
): { unseenCount: number; markSeen: boolean } {
  const metaPath = join(rootDir, name, 'meta.json');
  if (!existsSync(metaPath)) return { unseenCount: 0, markSeen: false };
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { unseenCount: 0, markSeen: false };
  }
  const notes = Array.isArray(meta.recovery_notes) ? (meta.recovery_notes as RecoveryNoteEntry[]) : [];
  if (notes.length === 0) return { unseenCount: 0, markSeen: false };
  const seenAt = typeof meta.recovery_notes_seen_at === 'string' ? meta.recovery_notes_seen_at : null;
  const unseen = notes.filter((n) => seenAt === null || n.at > seenAt);
  if (unseen.length === 0) return { unseenCount: 0, markSeen: false };
  const head = unseen.slice(0, 5).map(formatNoteLine).join('\n');
  const tail = unseen.length > 5 ? `\n+ ${unseen.length - 5} more (run /sp notes)` : '';
  ui.notify(`⚠ ${unseen.length} unread recovery notes:\n${head}${tail}`, 'warning');
  return { unseenCount: unseen.length, markSeen: true };
}

export function showDivergenceBanner(
  name: string,
  rootDir: string,
  ui: UiNotify,
): { diverged: boolean } {
  const metaPath = join(rootDir, name, 'meta.json');
  if (!existsSync(metaPath)) return { diverged: false };
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { diverged: false };
  }
  const leaf = typeof meta.cell_leaf_id === 'number' ? meta.cell_leaf_id : null;
  const kernel = typeof meta.kernel_at_cell_id === 'number' ? meta.kernel_at_cell_id : null;
  if (leaf === null || kernel === null || leaf === kernel) return { diverged: false };
  ui.notify(
    `ℹ kernel state is at cell #${kernel}; view is at cell #${leaf} (run /sp tree to inspect)`,
    'info',
  );
  return { diverged: true };
}

export function formatNoteLine(n: RecoveryNoteEntry): string {
  const ts = n.at.slice(0, 19);
  switch (n.kind) {
    case 'snapshot-failed':       return `  • [${ts}] snapshot-failed: ${n.message}`;
    case 'cells-since-snapshot':  return `  • [${ts}] ${n.n} cells since last snapshot`;
    case 'namespace-corrupt':     return `  • [${ts}] namespace-corrupt: ${n.message}`;
    case 'namespace-absent':      return `  • [${ts}] namespace-absent`;
    default:                      return `  • [${ts}] ${(n as { kind: string }).kind}`;
  }
}
```

### Step 3.3 — Run tests; expect PASS

- [ ] **Run; expect all 6 new tests PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/attach-banners.test.ts
```

### Step 3.4 — Commit

- [ ] **Commit Task 3:**

```bash
git add src/resources/extensions/coworker-scratchpad/attach-banners.ts \
        src/resources/extensions/coworker-scratchpad/attach-banners.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad-ext): attach-banners.ts (recovery + divergence helpers)

Pure helpers used by /sp attach:
- showRecoveryNotesBanner: warning notify with up to 5 unseen notes +
  "+ N more (run /sp notes)" footer. Tolerates missing/corrupt meta.
- showDivergenceBanner: info notify when cell_leaf_id !== kernel_at_cell_id
  and both are non-null. Silent on equal or null-on-either-side.
- formatNoteLine: timestamp + per-kind formatting for all 4 RecoveryNote
  kinds (snapshot-failed, cells-since-snapshot, namespace-absent,
  namespace-corrupt).

No coupling to ScratchpadManager — disk reads + ui callback only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `sp-command.ts` attach rewrite + `/sp notes` verb + `joinQuotedArg`

The biggest task. Rewrites `case 'attach'` to handle `ScratchpadBusyError` with auto-prompt + reason capture; adds `--force-takeover` and `--reason "..."` flags; fires both banners after success. Adds `case 'notes'`. Adds `joinQuotedArg` helper.

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

### Step 4.1 — Update test scaffolding

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`. **Find the existing `makeCtx(...)` function (the version updated in Phase 1g Task 4) and add an `input` stub.** Replace:

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

  with:

```ts
function makeCtx(confirmAnswer: boolean = true, inputAnswer: string | undefined = 'because reason'): FakeCtx {
  const notifications: FakeCtx['notifications'] = [];
  return {
    notifications,
    hasUI: false,
    cwd: process.cwd(),
    ui: {
      notify: (m, l) => notifications.push([l, m]),
      confirm: async (_title: string, _msg: string) => confirmAnswer,
      input: async (_title: string, _placeholder?: string) => inputAnswer,
    },
  };
}
```

- [ ] **Update the `FakeCtx` interface to add `input`:**

```ts
interface FakeCtx {
  notifications: Array<[string, string]>;
  hasUI: boolean;
  cwd: string;
  ui: {
    notify: (msg: string, level: string) => void;
    confirm: (title: string, msg: string) => Promise<boolean>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
  };
}
```

- [ ] **Update the `StubMgr` interface + `makeStub` to support a forceTakeover-throwing path.** Find `StubMgr.getOrAttach` and the existing `makeStub` implementation:

```ts
interface StubMgr {
  // ... existing fields ...
  getOrAttach(name: string, opts?: { forceTakeover?: boolean; takeoverReason?: string }): Promise<unknown>;
  // ... rest ...
}

function makeStub(root: string, existing: string[] = [], busyOnAttach: boolean = false): StubMgr {
  const calls: StubMgr['calls'] = [];
  let busy = busyOnAttach;
  return {
    calls,
    rootDir: () => root,
    list() { calls.push(['list']); return existing.map((n) => ({ name: n, live: false, lastUsedAt: 0 })); },
    async create(name) { calls.push(['create', name]); if (existing.includes(name)) throw new Error(`scratchpad ${name} already exists`); existing.push(name); return null; },
    async getOrAttach(name, opts) {
      calls.push(['getOrAttach', name, opts ?? {}]);
      if (busy && !opts?.forceTakeover) {
        const err = new Error(`scratchpad ${name} is busy in another session`);
        err.name = 'ScratchpadBusyError';
        (err as unknown as { holder: unknown }).holder = { pid: 9999, host: 'host-x', acquired_at: '2026-05-31T10:00:00.000Z' };
        throw err;
      }
      busy = false; // takeover succeeded; subsequent attaches are normal
      if (!existing.includes(name)) existing.push(name);
      return null;
    },
    async remove(name) { calls.push(['remove', name]); const i = existing.indexOf(name); if (i >= 0) existing.splice(i, 1); },
    async save(name) { calls.push(['save', name]); if (!existing.includes(name)) throw new Error(`scratchpad ${name} is not warm — nothing to save`); },
    async detach(name, sid) { calls.push(['detach', name, sid]); },
    async clearHistory(name) { calls.push(['clearHistory', name]); },
    async markRecoveryNotesSeen(name) { calls.push(['markRecoveryNotesSeen', name]); },
  };
}
```

  Replace the existing `makeStub` accordingly. Note the new `busyOnAttach` parameter (default false) and the new `markRecoveryNotesSeen` stub.

- [ ] **Add `markRecoveryNotesSeen` to the StubMgr interface declaration at the top of the file.** Find the `interface StubMgr {` block and add:

```ts
  markRecoveryNotesSeen(name: string): Promise<void>;
```

- [ ] **Add a new `wireWithBusy(...)` helper next to `wire(...)` and `wireWithConfirm(...)`:**

```ts
  function wireWithBusy(confirm: boolean, inputAnswer: string | undefined, existing: string[] = []): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const ctx = makeCtx(confirm, inputAnswer);
    const mgr = makeStub(root, existing, /* busyOnAttach */ true);
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

### Step 4.2 — Write failing tests

- [ ] **Add 8 new `it(...)` blocks** to the existing describe block, just before the final `});`:

```ts
  it('/sp attach happy path attaches normally (no busy)', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.deepEqual(mgr.calls[0], ['getOrAttach', 'p1', {}]);
    assert.equal(current.name, 'p1');
  });

  it('/sp attach on busy without flag: confirm accepted, reason from input → retry with forceTakeover', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(true, 'debugging stuck cell');
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    // First call throws busy; second call has forceTakeover.
    assert.equal(mgr.calls[0][0], 'getOrAttach');
    assert.equal(mgr.calls[1][0], 'getOrAttach');
    const secondOpts = mgr.calls[1][2] as { forceTakeover?: boolean; takeoverReason?: string };
    assert.equal(secondOpts.forceTakeover, true);
    assert.equal(secondOpts.takeoverReason, 'debugging stuck cell');
    assert.equal(current.name, 'p1');
  });

  it('/sp attach on busy with confirm declined: cancelled; no retry', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(false, 'unused');
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    // Only the initial busy call; no retry.
    assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 1);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp attach on busy with input undefined (user escaped): cancelled; no retry', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(true, undefined);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 1);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp attach --force-takeover skips confirm but still prompts for reason via input', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(/* confirm */ false, 'because flag');
    await pi.commands.get('sp')!.handler('attach p1 --force-takeover', ctx);
    // confirm=false but the flag bypasses it
    assert.equal(mgr.calls.length, 2);
    const secondOpts = mgr.calls[1][2] as { forceTakeover?: boolean; takeoverReason?: string };
    assert.equal(secondOpts.forceTakeover, true);
    assert.equal(secondOpts.takeoverReason, 'because flag');
    assert.equal(current.name, 'p1');
  });

  it('/sp attach --force-takeover --reason "..." is fully non-interactive', async () => {
    // Both confirm and input stubs would return non-cancel values, but neither should be invoked.
    const { pi, ctx, mgr, current } = wireWithBusy(false, undefined);
    await pi.commands.get('sp')!.handler('attach p1 --force-takeover --reason "explicit reason"', ctx);
    assert.equal(mgr.calls.length, 2);
    const secondOpts = mgr.calls[1][2] as { forceTakeover?: boolean; takeoverReason?: string };
    assert.equal(secondOpts.forceTakeover, true);
    assert.equal(secondOpts.takeoverReason, 'explicit reason');
    assert.equal(current.name, 'p1');
  });

  it('/sp notes [<name>] reads meta.recovery_notes and prints all', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'meta.json'), JSON.stringify({
      recovery_notes: [
        { kind: 'snapshot-failed', message: 'boom', at: '2026-05-31T10:00:00.000Z' },
        { kind: 'cells-since-snapshot', n: 2, at: '2026-05-31T11:00:00.000Z' },
      ],
    }));
    await pi.commands.get('sp')!.handler('notes p1', ctx);
    const banner = ctx.notifications.find(([l]) => l === 'info');
    assert.ok(banner, 'info notify present');
    assert.match(banner![1], /p1 recovery notes \(2\)/);
    assert.match(banner![1], /snapshot-failed: boom/);
    assert.match(banner![1], /2 cells since last snapshot/);
  });

  it('/sp notes on empty notes emits "no recovery notes"', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'meta.json'), JSON.stringify({}));
    await pi.commands.get('sp')!.handler('notes p1', ctx);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /no recovery notes for p1/.test(m)));
  });
```

- [ ] **Run; expect FAIL on the new tests:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

### Step 4.3 — Update `sp-command.ts` imports

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/sp-command.ts`. **Find the imports block at the top and add new imports:**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { ScratchpadBusyError } from '@otto/coworker-scratchpad';
import type { ScratchpadManager, RecoveryNote } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl, readPersistedLeaf } from './helpers.js';
import { projectTree, formatTreeText } from '@otto/coworker-scratchpad';
import { sessionSidecarPath, writeSessionSidecar, deleteSessionSidecar } from './session-sidecar.js';
import { showRecoveryNotesBanner, showDivergenceBanner, formatNoteLine } from './attach-banners.js';
```

- [ ] **Add `markRecoveryNotesSeen` to `SpDeps.getManager`'s return type by referencing the actual `ScratchpadManager` — no `SpDeps` change needed beyond what's there, but the underlying `ScratchpadManager` now has a new method that the stub mirrors.** No file edit here.

- [ ] **Update `SpVerb` + `VERBS`:**

```ts
type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove' | 'tree' | 'fork' | 'save' | 'detach' | 'clear-history' | 'notes';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove', 'tree', 'fork', 'save', 'detach', 'clear-history', 'notes'];
```

- [ ] **Update `UiCtx` to include `input`:**

```ts
interface UiCtx {
  hasUI: boolean;
  ui: {
    notify: (msg: string, level: 'info' | 'warning' | 'error') => void;
    confirm: (title: string, msg: string) => Promise<boolean>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
  };
}
```

- [ ] **Update the command's `description` line to include `notes`:**

```ts
    description: 'Manage scratchpads: /sp [list|new|attach|reset|view|remove|tree|fork|save|detach|clear-history|notes] [name]',
```

### Step 4.4 — Add the `joinQuotedArg` helper

- [ ] **Add this helper function at module-private scope (above `registerSpCommand`):**

```ts
function joinQuotedArg(parts: string[], startIdx: number): string | null {
  if (startIdx >= parts.length) return null;
  const first = parts[startIdx];
  if (!first) return null;
  if (!first.startsWith('"')) return first;
  // Quoted: walk forward until we find a part ending with "
  if (first.length > 1 && first.endsWith('"')) {
    return first.slice(1, -1); // single-token quoted reason
  }
  const collected: string[] = [first.slice(1)]; // strip opening quote
  for (let i = startIdx + 1; i < parts.length; i++) {
    const p = parts[i] ?? '';
    if (p.endsWith('"')) {
      collected.push(p.slice(0, -1));
      return collected.join(' ');
    }
    collected.push(p);
  }
  return collected.join(' '); // no closing quote — take rest
}
```

### Step 4.5 — Rewrite `case 'attach':`

- [ ] **Find the existing `case 'attach':` block (added in Phase 1g) and REPLACE the entire block:**

```ts
          case 'attach': {
            if (!name) {
              ctx.ui.notify('Usage: /sp attach <name> [--force-takeover] [--reason "<text>"]', 'error');
              return;
            }
            validateName(name);
            const forceFlag = parts.includes('--force-takeover');
            const reasonIdx = parts.indexOf('--reason');
            const reasonArg = reasonIdx >= 0 ? joinQuotedArg(parts, reasonIdx + 1) : null;

            let attached = false;
            try {
              await deps.getManager().getOrAttach(name);
              attached = true;
            } catch (err) {
              if (!(err instanceof ScratchpadBusyError)) {
                ctx.ui.notify((err as Error).message, 'error');
                return;
              }
              const holder = err.holder;
              const proceed = forceFlag || await ctx.ui.confirm(
                'Force takeover?',
                `${name}: lock held by pid ${holder.pid} on host ${holder.host} (acquired ${holder.acquired_at}). Take it?`,
              );
              if (!proceed) { ctx.ui.notify('cancelled', 'info'); return; }

              let reason: string | null = reasonArg;
              if (reason === null) {
                const input = await ctx.ui.input('Takeover reason', 'why are you taking over?');
                if (input === undefined) { ctx.ui.notify('cancelled', 'info'); return; }
                reason = input.trim() || '(no reason given)';
              }
              try {
                await deps.getManager().getOrAttach(name, { forceTakeover: true, takeoverReason: reason });
                attached = true;
              } catch (retryErr) {
                ctx.ui.notify((retryErr as Error).message, 'error');
                return;
              }
            }
            if (!attached) return;

            deps.setCurrentName(name);
            writeSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()), {
              schema_version: 1,
              session_id: deps.getSessionId(),
              current_name: name,
              attached_at: new Date().toISOString(),
            });
            ctx.ui.notify(`attached to scratchpad: ${name}`, 'info');

            // §2 + §4 banners (1g2):
            const { markSeen } = showRecoveryNotesBanner(name, deps.rootDir(), ctx.ui);
            if (markSeen) {
              await deps.getManager().markRecoveryNotesSeen(name);
            }
            showDivergenceBanner(name, deps.rootDir(), ctx.ui);
            return;
          }
```

### Step 4.6 — Add the `case 'notes':` block

- [ ] **Add a new case directly after the new `case 'clear-history':` (added in Phase 1g, before the existing `default:`):**

```ts
          case 'notes': {
            const target = name ?? deps.getCurrentName();
            if (!target) {
              ctx.ui.notify('Usage: /sp notes [<name>] (no current scratchpad)', 'error');
              return;
            }
            validateName(target);
            const metaPath = join(deps.rootDir(), target, 'meta.json');
            if (!existsSync(metaPath)) {
              ctx.ui.notify(`scratchpad not found: ${target}`, 'error');
              return;
            }
            let meta: Record<string, unknown>;
            try {
              meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
            } catch {
              ctx.ui.notify(`${target}: meta.json unreadable`, 'error');
              return;
            }
            type RecoveryNoteEntry = RecoveryNote & { at: string };
            const notes = Array.isArray(meta.recovery_notes) ? (meta.recovery_notes as RecoveryNoteEntry[]) : [];
            if (notes.length === 0) {
              ctx.ui.notify(`no recovery notes for ${target}`, 'info');
              return;
            }
            const lines = notes.map(formatNoteLine);
            ctx.ui.notify(`${target} recovery notes (${notes.length}):\n${lines.join('\n')}`, 'info');
            // Deliberately does NOT update recovery_notes_seen_at — re-view path is read-only.
            return;
          }
```

### Step 4.7 — Run tests; expect PASS

- [ ] **Run; expect all new tests PASS:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

### Step 4.8 — Commit

- [ ] **Commit Task 4:**

```bash
git add src/resources/extensions/coworker-scratchpad/sp-command.ts \
        src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-scratchpad-ext): /sp attach force-takeover prompt + /sp notes + banners

/sp attach <name> [--force-takeover] [--reason "<text>"]:
  - on ScratchpadBusyError: auto-prompts confirm with holder details
    (pid + host + acquired_at); on accept, prompts ctx.ui.input for
    reason; retries with forceTakeover + takeoverReason.
  - --force-takeover flag skips confirm; reason still prompted unless
    --reason provided.
  - --force-takeover --reason "..." is fully non-interactive.
  - on success: fires showRecoveryNotesBanner + showDivergenceBanner
    after the existing "attached" notify; if banner marks notes seen,
    calls manager.markRecoveryNotesSeen.

/sp notes [<name>]: prints all recovery_notes (seen + unseen) without
  changing seen_at. Read-only re-view path.

joinQuotedArg helper handles `--reason "multi word reason"` despite
the dispatcher splitting on /\\s+/.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build + full gates

Run the gates in the correct order (build BEFORE typecheck — the 1g lesson) and confirm everything green.

**Files:** none modified; this is verification only.

### Step 5.1 — Run the full extension test set together (sanity)

- [ ] **Run all 7 coworker-scratchpad extension test files:**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/coworker-scratchpad/attach-banners.test.ts \
  src/resources/extensions/coworker-scratchpad/helpers.test.ts \
  src/resources/extensions/coworker-scratchpad/index.test.ts \
  src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts \
  src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts \
  src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts \
  src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

Expected: all green; total ~72 tests (was 58 + 14 new = 72).

### Step 5.2 — Rebuild the library (before typecheck — 1g lesson)

- [ ] **Build the coworker-scratchpad library so its `dist/*.d.ts` reflects the new `markRecoveryNotesSeen` method and `Entry.kernelAtCellId` field:**

```bash
npm run build:coworker-scratchpad
```

Expected: clean build.

### Step 5.3 — Run the type gate

- [ ] **Typecheck all extensions against the freshly-built lib types:**

```bash
npm run typecheck:extensions
```

Expected: no type errors.

### Step 5.4 — Run the package gate

- [ ] **Run all package tests (compiles to `dist-test/` and runs `node --test`):**

```bash
npm run test:packages
```

Expected: all green. `@otto/coworker-scratchpad` should show ~150 tests (141 + 7 new = ~148; minor margin).

### Step 5.5 — Run the full build

- [ ] **Run the core build (covers everything that ships):**

```bash
npm run build:core
```

Expected: clean build.

### Step 5.6 — Commit (verification-only)

- [ ] **No code change in Task 5. If any step revealed issues, fix them in the appropriate prior task's files and amend that task's commit. If all gates were green on the first run, no commit is needed.**

If a fix WAS required and amended, ensure the amended commit retains the original HEREDOC commit message + Co-Authored-By trailer.

---

## Self-review

After all five tasks pass:

**Spec coverage:**
- §3 locked decision 1 (notify-based surface) → Tasks 3 + 4
- §3 locked decision 2 (recovery-notes seen tracking via timestamp cutoff) → Tasks 2 + 3
- §3 locked decision 3 (`/sp notes` re-view verb) → Task 4
- §3 locked decision 4 (force-takeover auto-prompt + reason capture) → Task 4
- §3 locked decision 5+6 (lock.json takeover_reason + ScratchpadBusyError holder) → no code change required (already in scratchpad-lock.ts pre-1g2)
- §3 locked decision 7 (kernel_at_cell_id lifecycle) → Task 1
- §3 locked decision 8 (divergence banner: both set + differ) → Task 3
- §3 locked decision 9 (banners only from `/sp attach` slash command) → Task 4 — banners fire inside `case 'attach':` only, NOT in `getOrAttach` library path, NOT in `session_start` restore
- §3 locked decision 10 (no schema bump) → respected; both new fields are additive
- §4.5 markRecoveryNotesSeen → Task 2
- §4.6 attach-banners → Task 3
- §4.7 sp-command attach rewrite → Task 4
- §4.8 joinQuotedArg → Task 4
- §4.9 /sp notes verb → Task 4
- §5 slash command surface table → all rows implemented
- §6 error handling rows → each handled either in lib (markRecoveryNotesSeen tolerates missing meta) or in sp-command (usage errors, cancel paths, missing-target errors)

**Test count delta:**
- Library: +5 (Task 1) + 2 (Task 2) = +7 → ~148 total (141 + 7)
- Extension: +6 (Task 3) + 8 (Task 4) = +14 → ~72 total (58 + 14)

**Out of scope (carried to 1g3 per spec §10):** `fork`'s `rawChild.once('exit')` timeout + SIGKILL fallback; `size_bytes` post-write recompute; broader atomic-rename for `namespace.json`.
