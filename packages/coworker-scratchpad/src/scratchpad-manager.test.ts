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
