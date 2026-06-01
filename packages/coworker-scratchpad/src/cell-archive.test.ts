import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CellArchive, CELLS_SCHEMA_VERSION } from './cell-archive.js';

let dir: string;
const lines = (p: string): string[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
const cellsPath = (): string => join(dir, 'cells.jsonl');

describe('CellArchive', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cells-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a schema header once, then a first entry with id 1 / parentId null', () => {
    const a = new CellArchive(dir, () => 1000);
    const e = a.append({ code: 'return 1;', ok: true, value: 1, stdout: '' });
    assert.equal(e.id, 1);
    assert.equal(e.parentId, null);
    const ls = lines(cellsPath());
    assert.deepEqual(JSON.parse(ls[0]), { type: 'header', version: CELLS_SCHEMA_VERSION });
    const rec = JSON.parse(ls[1]);
    assert.equal(rec.id, 1);
    assert.equal(rec.ok, true);
    assert.equal(rec.value, 1);
    assert.equal(rec.ts, new Date(1000).toISOString());
  });

  it('chains parentId to the previous entry', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    const second = a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(second.id, 2);
    assert.equal(second.parentId, 1);
  });

  it('records a failed cell with ok:false and an error (no value)', () => {
    const a = new CellArchive(dir, () => 0);
    const e = a.append({ code: 'throw 1', ok: false, error: { name: 'Error', message: 'boom' }, stdout: '' });
    assert.equal(e.ok, false);
    assert.equal(e.error!.message, 'boom');
    assert.equal('value' in e, false);
  });

  it('continues ids across a fresh archive over the same file (re-attach durability)', () => {
    const a1 = new CellArchive(dir, () => 0);
    a1.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1
    a1.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2
    const a2 = new CellArchive(dir, () => 0); // re-attach: scans existing file
    const next = a2.append({ code: 'c', ok: true, value: null, stdout: '' });
    assert.equal(next.id, 3);
    assert.equal(next.parentId, 2);
    assert.equal(lines(cellsPath()).filter((l) => l.includes('"id"')).length, 3);
  });

  it('exposes lastId — null before any append, the most recent id after', () => {
    const a = new CellArchive(dir, () => 0);
    assert.equal(a.lastId, null);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    assert.equal(a.lastId, 1);
    a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(a.lastId, 2);
    // re-attach preserves it
    const a2 = new CellArchive(dir, () => 0);
    assert.equal(a2.lastId, 2);
  });

  it('leafId equals lastId after construct on a linear chain (backward-compat)', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(a.lastId, 2);
    assert.equal(a.leafId, 2);
    // Re-construct over the same file: both seed to file-max.
    const a2 = new CellArchive(dir, () => 0);
    assert.equal(a2.lastId, 2);
    assert.equal(a2.leafId, 2);
  });

  it('setLeaf moves leafId without affecting lastId', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1
    a.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2
    a.append({ code: 'c', ok: true, value: null, stdout: '' }); // id 3
    a.setLeaf(1);
    assert.equal(a.lastId, 3);
    assert.equal(a.leafId, 1);
  });

  it('append after setLeaf chains parentId from leaf, not from lastId', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1, parent null
    a.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2, parent 1
    a.append({ code: 'c', ok: true, value: null, stdout: '' }); // id 3, parent 2
    a.setLeaf(1);
    const branched = a.append({ code: 'd', ok: true, value: null, stdout: '' }); // id 4, parent 1
    assert.equal(branched.id, 4);
    assert.equal(branched.parentId, 1);
  });

  it('append after setLeaf updates BOTH lastId and leafId to the new id', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1
    a.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2
    a.setLeaf(1);
    a.append({ code: 'c', ok: true, value: null, stdout: '' }); // id 3, parent 1
    assert.equal(a.lastId, 3);
    assert.equal(a.leafId, 3);
  });

  it('setLeaf(null) makes the next append a root cell (parentId null)', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    a.setLeaf(null);
    const next = a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(next.parentId, null);
  });

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
});
