// packages/coworker-artifacts/src/dir-snapshot.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeSnapshot, diffSnapshots } from './dir-snapshot.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'ds-')); }

describe('takeSnapshot', () => {
  it('returns empty map for empty dir', () => {
    const snap = takeSnapshot(tmp());
    assert.equal(snap.size, 0);
  });
  it('captures relative path + size for each file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.md'), 'hello');
    writeFileSync(join(dir, 'b.md'), 'world!');
    const snap = takeSnapshot(dir);
    assert.equal(snap.size, 2);
    assert.equal(snap.get('a.md')!.sizeBytes, 5);
    assert.equal(snap.get('b.md')!.sizeBytes, 6);
    assert.equal(typeof snap.get('a.md')!.mtimeNs, 'bigint');
  });
  it('recurses into subdirs with forward-slash paths', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'c.md'), 'nested');
    const snap = takeSnapshot(dir);
    assert.ok(snap.has('sub/c.md'));
  });
  it('returns empty map when dir does not exist', () => {
    const snap = takeSnapshot(join(tmp(), 'nope'));
    assert.equal(snap.size, 0);
  });
});

describe('diffSnapshots', () => {
  it('detects added files', () => {
    const before = new Map();
    const after = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const d = diffSnapshots(before, after);
    assert.deepEqual(d.added, ['a.md']);
    assert.deepEqual(d.modified, []);
    assert.deepEqual(d.removed, []);
  });
  it('detects removed files', () => {
    const before = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const after = new Map();
    const d = diffSnapshots(before, after);
    assert.deepEqual(d.removed, ['a.md']);
  });
  it('detects modified when sizeBytes differs', () => {
    const before = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const after = new Map([['a.md', { mtimeNs: 2n, sizeBytes: 7 }]]);
    const d = diffSnapshots(before, after);
    assert.deepEqual(d.modified, ['a.md']);
  });
  it('detects modified when mtimeNs differs (same size)', () => {
    const before = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const after = new Map([['a.md', { mtimeNs: 999n, sizeBytes: 5 }]]);
    assert.deepEqual(diffSnapshots(before, after).modified, ['a.md']);
  });
  it('no diff when identical', () => {
    const a = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const b = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const d = diffSnapshots(a, b);
    assert.equal(d.added.length + d.modified.length + d.removed.length, 0);
  });
});
