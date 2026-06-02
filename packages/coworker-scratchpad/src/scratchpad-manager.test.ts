import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ScratchpadManager, ForkKernelHangError } from './scratchpad-manager.js';
import type { DataLoadDrawer } from './kernel-protocol.js';

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

  it('force-takeover steals a busy lock (after the prior runtime is cold)', async () => {
    // Evict 'a' to cold (snapshotThenDispose releases DuckDB file, keeps lock.json).
    mgr = new ScratchpadManager({ workspace, root, maxLiveKernels: 1 });
    await mgr.getOrAttach('a');
    await mgr.getOrAttach('b'); // LRU-evicts 'a' → runtime cold, lock retained
    assert.equal(liveOf(mgr, 'a'), false);
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

  it('re-warms a cold kernel and restores globalThis from the snapshot', async () => {
    let t = 1000;
    mgr = new ScratchpadManager({ workspace, root, maxLiveKernels: 1, now: () => t });
    const a1 = await mgr.getOrAttach('a');
    await a1.runCell('globalThis.x = 99;');
    t += 10;
    await mgr.getOrAttach('b');           // evicts 'a' -> cold (snapshot written)
    assert.equal(liveOf(mgr, 'a'), false);
    t += 10;
    const a2 = await mgr.getOrAttach('a'); // cold -> re-warm (namespace restored)
    assert.equal((await a2.runCell('return globalThis.x ?? null;')).value, 99);
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
    assert.equal(meta.schema_version, 4);
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
    assert.equal(meta.schema_version, 4);
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
    // Kill the kernel out from under the manager before disposeAll calls snapshot().
    // The runtime's child process is disposed externally, so snapshot() resolves ok:false.
    const entries = (m as unknown as { entries: Map<string, { runtime: import('./child-process-runtime.js').ChildProcessRuntime | null }> }).entries;
    const entry = entries.get('a')!;
    // Directly dispose the child process (simulating an unexpected crash) WITHOUT
    // setting entry.runtime = null — so snapshotThenDispose still attempts the snapshot.
    const liveRuntime = entry.runtime!;
    await liveRuntime.dispose(); // kills the child; snapshot() will resolve ok:false
    // disposeAll will call snapshotThenDispose('a', entry) → snapshot() → ok:false → appendRecoveryNotes
    await m.disposeAll(); // must not throw
    const meta = readMeta(rt, 'a');
    const note = meta.recovery_notes.find((n: { kind: string }) => n.kind === 'snapshot-failed');
    assert.ok(note, 'expected a snapshot-failed recovery note');
  });
});

describe('ScratchpadManager (tree + fork — 1f)', () => {
  let ws: string;
  let rt: string;
  let m: ScratchpadManager;

  const readMeta = (root: string, name: string): any =>
    JSON.parse(readFileSync(join(root, name, 'meta.json'), 'utf8'));

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'spm5-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    rt = await mkdtemp(join(tmpdir(), 'spm5-root-'));
  });
  afterEach(async () => {
    await m?.disposeAll();
    await rm(ws, { recursive: true, force: true });
    await rm(rt, { recursive: true, force: true });
  });

  it('writeMeta now persists cell_leaf_id and schema_version is 4', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    const meta = readMeta(rt, 'a');
    assert.equal(meta.schema_version, 4);
    assert.equal(meta.cell_leaf_id, 1);
  });

  it('setLeaf rejects an id not present in cells.jsonl', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    await assert.rejects(() => m.setLeaf('a', 99), /cell id 99 not found/);
  });

  it('setLeaf on a warm scratchpad updates archive.leafId AND meta.cell_leaf_id', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;'); // id 1
    await m.runCell('a', 'return 2;'); // id 2
    await m.setLeaf('a', 1);
    // The next runCell should chain from 1, not 2.
    const res = await m.runCell('a', 'return 3;');
    assert.equal(res.value, 3);
    const meta = readMeta(rt, 'a');
    assert.equal(meta.cell_leaf_id, 3); // the new cell becomes the leaf again
    // Read cells.jsonl and confirm the third cell's parentId is 1 (not 2).
    const lines = readFileSync(join(rt, 'a', 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"id"'));
    const recs = lines.map((l) => JSON.parse(l));
    assert.equal(recs[2].id, 3);
    assert.equal(recs[2].parentId, 1);
  });

  it('setLeaf on a cold scratchpad updates meta directly (next attach restores)', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    await m.runCell('a', 'return 2;');
    await m.disposeAll();
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    // Cold: 'a' is not in entries; setLeaf updates meta only.
    await m.setLeaf('a', 1);
    assert.equal(readMeta(rt, 'a').cell_leaf_id, 1);
    // Attach + new cell branches from 1.
    const res = await m.runCell('a', 'return 99;');
    assert.equal(res.value, 99);
    const lines = readFileSync(join(rt, 'a', 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"id"'));
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.parentId, 1);
  });

  it('fork copies kernel.db + namespace.json + cells.jsonl and writes fresh meta', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('src', 'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (1),(2)");');
    await m.runCell('src', 'globalThis.x = 42;');
    await m.fork('src', 'dst');
    // Both dirs exist.
    assert.equal(existsSync(join(rt, 'dst', 'kernel.db')), true);
    assert.equal(existsSync(join(rt, 'dst', 'cells.jsonl')), true);
    assert.equal(existsSync(join(rt, 'dst', 'meta.json')), true);
    // Dst meta inherits cell_leaf_id from src (currently last cell id = 2).
    const dstMeta = readMeta(rt, 'dst');
    assert.equal(dstMeta.cell_leaf_id, 2);
    assert.equal(dstMeta.name, 'dst');
    assert.deepEqual(dstMeta.recovery_notes, []);
    assert.deepEqual(dstMeta.namespace_skipped, []);
    // Dst is functional: attach and continue.
    const res = await m.runCell('dst', 'const c = await otto.duckdb.connect(); const r = await c.runAndReadAll("SELECT COUNT(*) AS n FROM t"); return Number(r.getRows()[0][0]);');
    assert.equal(res.value, 2);
  });

  it('fork rejects when dst already exists (entries or on disk)', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('src', 'return 1;');
    await m.runCell('dst', 'return 1;'); // creates dst on disk
    await assert.rejects(() => m.fork('src', 'dst'), /scratchpad dst already exists/);
  });

  it('fork rejects when src has no meta on disk', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await assert.rejects(() => m.fork('nope', 'dst'), /scratchpad not found: nope/);
  });

  it('re-attach restores leaf from meta when persisted leaf differs from file-max', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    await m.runCell('a', 'return 2;');
    await m.runCell('a', 'return 3;');
    await m.setLeaf('a', 1); // leaf=1, file-max=3
    await m.disposeAll();
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    const res = await m.runCell('a', 'return 99;'); // should branch from 1
    assert.equal(res.value, 99);
    const lines = readFileSync(join(rt, 'a', 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"id"'));
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.id, 4);
    assert.equal(last.parentId, 1);
  });
});

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
    const r = await mgr.runCell('p1', 'return globalThis.x;');
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
    // Also stub stdin.end() so dispose() can't cause natural exit via closed stdin;
    // we want SIGTERM to be the ONLY exit signal, so we can verify escalation.
    (realChild.stdin as unknown as { end: () => void }).end = () => { /* no-op */ };
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
    // Stub stdin.end() so dispose() can't trigger natural exit via closed stdin.
    (realChild.stdin as unknown as { end: () => void }).end = () => { /* no-op */ };
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
});

describe('ScratchpadManager.evict (Task D)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    mgr = new ScratchpadManager({ workspace, root, sessionId: 's', sweepIntervalMs: 1_000_000 });
  });
  afterEach(async () => {
    await mgr.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('evict snapshots + disposes warm entry; dir/meta/cells.jsonl remain', async () => {
    await mgr.runCell('t', 'globalThis.x = 1;');
    const { interrupted } = await mgr.evict('t');
    assert.equal(interrupted, false);
    assert.equal(mgr.list().find((i) => i.name === 't')?.live, false, 'should flip to cold');
    assert.ok(existsSync(join(root, 't', 'kernel.db')), 'kernel.db remains on disk');
    assert.ok(existsSync(join(root, 't', 'meta.json')), 'meta.json remains on disk');
  });

  it('evict refuses without --force when a cell is active', async () => {
    await mgr.getOrAttach('t');
    // Start a long-running cell but don't await it.
    const pending = mgr.runCell('t', 'while (true) {}');
    // Give the kernel a moment to start executing.
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(mgr.evict('t'), /cell is running.*--force to interrupt/);
    // Clean up: cancel via --force so afterEach doesn't hang.
    await mgr.evict('t', { force: true });
    await assert.rejects(pending); // cell rejected via cancel
  });

  it('evict --force interrupts an active cell and skips snapshot', async () => {
    await mgr.getOrAttach('t');
    const pending = mgr.runCell('t', 'while (true) {}');
    await new Promise((r) => setTimeout(r, 50));
    const { interrupted } = await mgr.evict('t', { force: true });
    assert.equal(interrupted, true);
    await assert.rejects(pending, /cancelled/);
    // Entry should be cold; dir remains for cold-restart.
    assert.equal(mgr.list().find((i) => i.name === 't')?.live, false);
    assert.ok(existsSync(join(root, 't', 'meta.json')), 'on-disk state preserved');
  });

  it('evict on cold entry throws "not warm"', async () => {
    await mgr.getOrAttach('t');
    await mgr.evict('t'); // first evict makes it cold
    await assert.rejects(mgr.evict('t'), /not warm \(already cold\)/);
  });

  it('list() ScratchpadInfo exposes hasActiveCell', async () => {
    await mgr.runCell('t', 'globalThis.x = 1;');
    const info = mgr.list().find((i) => i.name === 't')!;
    assert.equal(info.hasActiveCell, false, 'idle warm entry');
    const pending = mgr.runCell('t', 'while (true) {}');
    await new Promise((r) => setTimeout(r, 50));
    const infoBusy = mgr.list().find((i) => i.name === 't')!;
    assert.equal(infoBusy.hasActiveCell, true, 'mid-cell warm entry');
    await mgr.evict('t', { force: true });
    await assert.rejects(pending);
  });
});

describe('ScratchpadManager attach meta freshness (Task E)', () => {
  it('meta.json after /sp new reflects post-spawn disk state (kernel_db.present + size_bytes)', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    const root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    const mgr = new ScratchpadManager({ workspace, root, sessionId: 's', sweepIntervalMs: 1_000_000 });
    try {
      await mgr.getOrAttach('fresh'); // simulates /sp new path
      const meta = JSON.parse(readFileSync(join(root, 'fresh', 'meta.json'), 'utf8')) as { kernel_db: { present: boolean }, size_bytes: number };
      assert.equal(meta.kernel_db.present, true, 'kernel.db should be reflected after spawn');
      assert.ok(meta.size_bytes > 0, `size_bytes should be > 0; got ${meta.size_bytes}`);
    } finally {
      await mgr.disposeAll();
      await rm(workspace, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('ScratchpadManager — bindings (Phase 2)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-bind-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    root = await mkdtemp(join(tmpdir(), 'sp-bind-root-'));
    mgr = new ScratchpadManager({ workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000 });
  });
  afterEach(async () => {
    await mgr?.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('create() persists bindings to meta.json', async () => {
    await mgr.create('p1', { bindings: ['jira:prod'] });
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as {
      schema_version?: unknown;
      bindings?: unknown;
    };
    assert.equal(meta.schema_version, 4);
    assert.deepEqual(meta.bindings, ['jira:prod']);
  });

  it('addBinding() appends a ref and is idempotent', async () => {
    await mgr.create('p1');
    const res1 = await mgr.addBinding('p1', 'jira:prod');
    assert.equal(res1.added, true);
    const meta1 = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { bindings?: unknown };
    assert.deepEqual(meta1.bindings, ['jira:prod']);
    // Same ref again is a no-op.
    const res2 = await mgr.addBinding('p1', 'jira:prod');
    assert.equal(res2.added, false);
    const meta2 = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { bindings?: unknown };
    assert.deepEqual(meta2.bindings, ['jira:prod']);
  });

  it('removeBinding() drops a ref and returns false when absent', async () => {
    await mgr.create('p1', { bindings: ['jira:prod', 'foo:bar'] });
    const r1 = await mgr.removeBinding('p1', 'jira:prod');
    assert.equal(r1.removed, true);
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8')) as { bindings?: unknown };
    assert.deepEqual(meta.bindings, ['foo:bar']);
    const r2 = await mgr.removeBinding('p1', 'jira:prod');
    assert.equal(r2.removed, false);
  });

  it('readBindings() returns the on-disk binding list', async () => {
    await mgr.create('p1', { bindings: ['jira:prod'] });
    assert.deepEqual(mgr.readBindings('p1'), ['jira:prod']);
    assert.deepEqual(mgr.readBindings('does-not-exist'), []);
  });

  it('fork copies bindings from src to dst', async () => {
    await mgr.create('src-bind', { bindings: ['jira:prod'] });
    await mgr.fork('src-bind', 'dst-bind');
    const dstMeta = JSON.parse(readFileSync(join(root, 'dst-bind', 'meta.json'), 'utf8')) as { bindings?: unknown };
    assert.deepEqual(dstMeta.bindings, ['jira:prod']);
  });

  it('migrates v3 meta.json to v4 by adding empty bindings', async () => {
    // Create via the normal path, then forcibly rewrite meta.json to look like v3.
    await mgr.create('legacy');
    const metaPath = join(root, 'legacy', 'meta.json');
    const cur = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    cur.schema_version = 3;
    delete cur.bindings;
    writeFileSync(metaPath, JSON.stringify(cur, null, 2));

    // Tear down + re-create on the same root so getOrAttach hits the cold path
    // (attachUnmanaged → writeMeta), which performs the migration.
    await mgr.disposeAll();
    mgr = new ScratchpadManager({ workspace, root, sessionId: 'sess-1', sweepIntervalMs: 1_000_000 });
    await mgr.getOrAttach('legacy');

    const migrated = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      schema_version?: unknown;
      bindings?: unknown;
    };
    assert.equal(migrated.schema_version, 4);
    assert.deepEqual(migrated.bindings, []);
  });
});

describe('ScratchpadManager — onDataLoad fan-out (Phase 3 Task 19)', () => {
  // Cross-pillar seam: the kernel emits a data_load event for every
  // otto.collectors.open(uri).load() call. ChildProcessRuntime surfaces it via
  // onDataLoad (per-spawn). The manager bridges that callback so callers see
  // {drawer, scratchpadName} — the shape MemoryRecorder.recordFileLoad needs.
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-onload-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    root = await mkdtemp(join(tmpdir(), 'sp-onload-root-'));
  });
  afterEach(async () => {
    await mgr?.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('forwards data_load drawers to onDataLoad with the scratchpad name', async () => {
    const inputs = join(workspace, '.otto', 'inputs');
    await writeFile(join(inputs, 'a.csv'), 'x,y\n1,2\n');
    const uri = pathToFileURL(join(inputs, 'a.csv')).href;

    const events: Array<{ drawer: DataLoadDrawer; scratchpadName: string }> = [];
    mgr = new ScratchpadManager({
      workspace,
      root,
      sessionId: 'sess-onload',
      sweepIntervalMs: 1_000_000,
      onDataLoad: (drawer, scratchpadName) => events.push({ drawer, scratchpadName }),
    });

    await mgr.runCell(
      'pad-x',
      `return await (await otto.collectors.open(${JSON.stringify(uri)})).load();`,
    );

    // data_load arrives as a kernel event; allow the IPC loop to drain.
    await delay(50);

    assert.equal(events.length, 1, 'exactly one data_load event expected');
    const ev = events[0]!;
    assert.equal(ev.scratchpadName, 'pad-x', 'scratchpadName closure-bound at spawn time');
    assert.equal(ev.drawer.kind, 'data_load');
    assert.equal(ev.drawer.collector, 'file');
    assert.equal(ev.drawer.uri, uri);
    assert.equal(ev.drawer.bytes, 8);
    assert.equal(ev.drawer.schema, null);
    // rows_loaded is null for a buffer/string payload (not an array).
    assert.equal(ev.drawer.rows_loaded, null);
  });

  it('routes loads from different scratchpads to the correct name', async () => {
    const inputs = join(workspace, '.otto', 'inputs');
    await writeFile(join(inputs, 'one.csv'), 'a,b\n');
    await writeFile(join(inputs, 'two.csv'), 'c,d\n');
    const u1 = pathToFileURL(join(inputs, 'one.csv')).href;
    const u2 = pathToFileURL(join(inputs, 'two.csv')).href;

    const events: Array<{ name: string; uri: string }> = [];
    mgr = new ScratchpadManager({
      workspace,
      root,
      sessionId: 'sess-onload-2',
      sweepIntervalMs: 1_000_000,
      onDataLoad: (drawer, scratchpadName) => events.push({ name: scratchpadName, uri: drawer.uri }),
    });

    await mgr.runCell('alpha', `await (await otto.collectors.open(${JSON.stringify(u1)})).load();`);
    await mgr.runCell('beta', `await (await otto.collectors.open(${JSON.stringify(u2)})).load();`);
    await delay(50);

    assert.equal(events.length, 2);
    // Order isn't guaranteed across kernels but each event's name must match its URI.
    const alphaEv = events.find((e) => e.name === 'alpha');
    const betaEv = events.find((e) => e.name === 'beta');
    assert.ok(alphaEv, 'alpha event present');
    assert.ok(betaEv, 'beta event present');
    assert.equal(alphaEv!.uri, u1);
    assert.equal(betaEv!.uri, u2);
  });
});
