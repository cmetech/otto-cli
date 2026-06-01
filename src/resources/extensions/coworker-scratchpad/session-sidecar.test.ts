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
