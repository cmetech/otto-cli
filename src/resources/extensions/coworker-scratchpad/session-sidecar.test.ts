import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sessionSidecarPath,
  readSessionSidecar,
  writeSessionSidecar,
  deleteSessionSidecar,
  sweepStaleSidecars,
  SIDECAR_GC_STALE_DAYS,
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

  it('sessionSidecarPath composes <root>/_sessions/sidecar_<sessionId>.json', () => {
    assert.equal(sessionSidecarPath(root, 'sess-1'), join(root, '_sessions', 'sidecar_sess-1.json'));
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

describe('sweepStaleSidecars', () => {
  let sweepRoot: string;
  beforeEach(() => {
    sweepRoot = mkdtempSync(join(tmpdir(), 'sweep-'));
    mkdirSync(join(sweepRoot, '_sessions'), { recursive: true });
  });
  afterEach(() => {
    rmSync(sweepRoot, { recursive: true, force: true });
  });

  it('deletes orphan when the referenced scratchpad is gone', () => {
    const sessionId = 'sess-OLD';
    writeSessionSidecar(sessionSidecarPath(sweepRoot, sessionId), {
      schema_version: 1, session_id: sessionId, current_name: 't-gone',
      attached_at: new Date().toISOString(),
    });
    const deleted = sweepStaleSidecars(sweepRoot, 'sess-CURRENT', Date.now());
    assert.equal(deleted, 1);
    assert.equal(existsSync(sessionSidecarPath(sweepRoot, sessionId)), false);
  });

  it('deletes old foreign-session sidecar by mtime when scratchpad still exists', () => {
    mkdirSync(join(sweepRoot, 't-alive'), { recursive: true });
    writeFileSync(join(sweepRoot, 't-alive', 'meta.json'), '{}');
    const sessionId = 'sess-OLD';
    const path = sessionSidecarPath(sweepRoot, sessionId);
    writeSessionSidecar(path, {
      schema_version: 1, session_id: sessionId, current_name: 't-alive',
      attached_at: new Date().toISOString(),
    });
    // Backdate mtime past the threshold
    const oldTime = (Date.now() - (SIDECAR_GC_STALE_DAYS + 1) * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path, oldTime, oldTime);
    const deleted = sweepStaleSidecars(sweepRoot, 'sess-CURRENT', Date.now());
    assert.equal(deleted, 1);
    assert.equal(existsSync(path), false);
  });

  it('never deletes the current session sidecar, even when backdated', () => {
    const sessionId = 'sess-CURRENT';
    const path = sessionSidecarPath(sweepRoot, sessionId);
    writeSessionSidecar(path, {
      schema_version: 1, session_id: sessionId, current_name: 't-gone',
      attached_at: new Date().toISOString(),
    });
    const oldTime = (Date.now() - (SIDECAR_GC_STALE_DAYS + 10) * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path, oldTime, oldTime);
    const deleted = sweepStaleSidecars(sweepRoot, sessionId, Date.now());
    assert.equal(deleted, 0);
    assert.equal(existsSync(path), true);
  });
});
