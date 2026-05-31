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
});
