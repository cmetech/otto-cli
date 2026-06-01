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
