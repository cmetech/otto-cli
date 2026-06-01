import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { acquireLease, releaseLease, isLeaseHeld } from './lease.js';

let tmpdir: string;

describe('lease helper', () => {
  beforeEach(async () => {
    tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lease-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpdir, { recursive: true, force: true });
  });

  it('acquires a free lease and writes PID + acquired_at + ttl_ms', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, true);
    const raw = await fs.readFile(lockPath, 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.pid, process.pid);
    assert.equal(typeof data.acquired_at, 'string');
    assert.equal(data.ttl_ms, 60_000);
  });

  it('blocks a second acquire while the first is held', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 60_000 });
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, false);
  });

  it('release allows re-acquire', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 60_000 });
    await releaseLease(lockPath);
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, true);
  });

  it('expired lease (past ttl) is auto-cleared on next acquire', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 50 });
    await new Promise(r => setTimeout(r, 100));
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, true, 'expected expired lease to be reclaimable');
  });

  it('isLeaseHeld returns false for missing file', async () => {
    const lockPath = path.join(tmpdir, 'missing.lock');
    assert.equal(await isLeaseHeld(lockPath), false);
  });

  it('isLeaseHeld returns false for expired lease without clearing it', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 50 });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await isLeaseHeld(lockPath), false);
  });
});
