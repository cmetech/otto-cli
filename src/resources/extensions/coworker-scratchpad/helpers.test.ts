import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRATCHPAD_NAME_REGEX, validateName, readCellsJsonl } from './helpers.js';

describe('SCRATCHPAD_NAME_REGEX + validateName', () => {
  it('accepts simple letter-led names', () => {
    for (const ok of ['default', 'p1', 'p1-1234', 'investigation_q4', 'A', 'rca-server-01']) {
      assert.equal(SCRATCHPAD_NAME_REGEX.test(ok), true, `should accept: ${ok}`);
      assert.doesNotThrow(() => validateName(ok));
    }
  });

  it('rejects digit-led, separator-led, empty, too-long, and traversal characters', () => {
    for (const bad of ['', '1abc', '-foo', '_foo', 'foo.bar', 'foo/bar', '..', 'a/b', 'a'.repeat(65)]) {
      assert.equal(SCRATCHPAD_NAME_REGEX.test(bad), false, `should reject: ${JSON.stringify(bad)}`);
      assert.throws(() => validateName(bad), /invalid scratchpad name/);
    }
  });
});

describe('readCellsJsonl', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cells-r-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty result when cells.jsonl does not exist', () => {
    const r = readCellsJsonl(dir);
    assert.deepEqual(r, { cells: [], total_cells: 0 });
  });

  it('reads schema-header + entries; ignores trailing corrupt line', async () => {
    const lines = [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'return 1;', ok: true, value: 1, stdout: '', ts: '2026-05-31T00:00:00.000Z' }),
      JSON.stringify({ id: 2, parentId: 1, code: 'return 2;', ok: true, value: 2, stdout: '', ts: '2026-05-31T00:00:01.000Z' }),
      '{ not-json',
    ];
    await writeFile(join(dir, 'cells.jsonl'), lines.join('\n') + '\n');
    const r = readCellsJsonl(dir);
    assert.equal(r.total_cells, 2);
    assert.equal(r.cells[0].id, 1);
    assert.equal(r.cells[1].id, 2);
    assert.equal(r.cells[1].parentId, 1);
  });

  it('returns cells in chronological order (file order)', async () => {
    const lines = [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'a', ok: true, value: 'a', stdout: '', ts: 't1' }),
      JSON.stringify({ id: 2, parentId: 1, code: 'b', ok: true, value: 'b', stdout: '', ts: 't2' }),
      JSON.stringify({ id: 3, parentId: 2, code: 'c', ok: false, error: { name: 'E', message: 'm' }, stdout: '', ts: 't3' }),
    ];
    await writeFile(join(dir, 'cells.jsonl'), lines.join('\n') + '\n');
    const r = readCellsJsonl(dir);
    assert.equal(r.cells.length, 3);
    assert.equal(r.cells[2].ok, false);
    assert.equal(r.cells[2].error?.message, 'm');
  });
});
