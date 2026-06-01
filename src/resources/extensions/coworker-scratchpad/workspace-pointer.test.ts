import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  workspaceHash,
  workspacePointerPath,
  readWorkspacePointer,
  writeWorkspacePointer,
  isPointerFresh,
  WORKSPACE_POINTER_STALE_MS,
  type WorkspacePointer,
} from './workspace-pointer.js';

describe('workspace-pointer', () => {
  it('writes and round-trip reads a pointer', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsp-'));
    try {
      const hash = workspaceHash('/home/me/project');
      const path = workspacePointerPath(root, hash);
      const payload: WorkspacePointer = {
        schema_version: 1,
        workspace_hash: hash,
        workspace_root: '/home/me/project',
        last_session_id: 'sess-A',
        last_current_name: 't04-tree',
        last_attached_at: '2026-06-01T12:00:00.000Z',
      };
      writeWorkspacePointer(path, payload);
      assert.deepEqual(readWorkspacePointer(path), payload);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('isPointerFresh respects the 7-day boundary', () => {
    const base: WorkspacePointer = {
      schema_version: 1,
      workspace_hash: 'h',
      workspace_root: '/x',
      last_session_id: 's',
      last_current_name: 'n',
      last_attached_at: '2026-06-01T00:00:00.000Z',
    };
    const at0 = Date.parse(base.last_attached_at);
    assert.equal(isPointerFresh(base, at0 + WORKSPACE_POINTER_STALE_MS - 1), true);
    assert.equal(isPointerFresh(base, at0 + WORKSPACE_POINTER_STALE_MS), false);
    assert.equal(isPointerFresh(base, at0 + WORKSPACE_POINTER_STALE_MS + 1000), false);
  });

  it('returns null for corrupt JSON or missing schema_version', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsp-bad-'));
    try {
      const path = workspacePointerPath(root, 'abc');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'not valid json at all');
      assert.equal(readWorkspacePointer(path), null);
      writeFileSync(path, JSON.stringify({ schema_version: 99, foo: 'bar' }));
      assert.equal(readWorkspacePointer(path), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('workspaceHash is deterministic 16-char hex and varies by input', () => {
    const a = workspaceHash('/home/me/projA');
    const b = workspaceHash('/home/me/projB');
    assert.equal(a.length, 16);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.notEqual(a, b);
    assert.equal(workspaceHash('/home/me/projA'), a);
  });
});
