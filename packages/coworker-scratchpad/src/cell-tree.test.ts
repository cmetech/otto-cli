import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CellEntry } from './cell-archive.js';
import { projectTree, findLeaves, validateLeafId, formatTreeText } from './cell-tree.js';

function mkCell(id: number, parentId: number | null, ok = true, value: unknown = id, code = `return ${id};`): CellEntry {
  return ok
    ? { id, parentId, code, ok: true, value, stdout: '', ts: `t${id}` }
    : { id, parentId, code, ok: false, error: { name: 'Error', message: String(value) }, stdout: '', ts: `t${id}` };
}

describe('projectTree', () => {
  it('returns null root and empty maps for an empty cell list', () => {
    const t = projectTree([]);
    assert.equal(t.root, null);
    assert.equal(t.byId.size, 0);
    assert.deepEqual(t.orphans, []);
  });

  it('builds a linear chain into a single-spine tree', () => {
    const cells = [mkCell(1, null), mkCell(2, 1), mkCell(3, 2)];
    const t = projectTree(cells);
    assert.equal(t.root?.cell.id, 1);
    assert.equal(t.root?.children.length, 1);
    assert.equal(t.root?.children[0].cell.id, 2);
    assert.equal(t.root?.children[0].children[0].cell.id, 3);
    assert.equal(t.byId.size, 3);
    assert.deepEqual(t.orphans, []);
  });

  it('builds a branching tree when a parent has two children', () => {
    // 1 → 2 → 3
    //     └→ 4
    const cells = [mkCell(1, null), mkCell(2, 1), mkCell(3, 2), mkCell(4, 2)];
    const t = projectTree(cells);
    assert.equal(t.byId.get(2)!.children.length, 2);
    const ids = t.byId.get(2)!.children.map((c) => c.cell.id).sort();
    assert.deepEqual(ids, [3, 4]);
  });

  it('collects orphans when parentId points to a missing id', () => {
    const cells = [mkCell(1, null), mkCell(5, 99)]; // 99 doesn't exist
    const t = projectTree(cells);
    assert.equal(t.root?.cell.id, 1);
    assert.equal(t.orphans.length, 1);
    assert.equal(t.orphans[0].cell.id, 5);
  });
});

describe('findLeaves', () => {
  it('returns all childless nodes', () => {
    // 1 → 2 → 3
    //     └→ 4
    const cells = [mkCell(1, null), mkCell(2, 1), mkCell(3, 2), mkCell(4, 2)];
    const leaves = findLeaves(projectTree(cells));
    const ids = leaves.map((n) => n.cell.id).sort();
    assert.deepEqual(ids, [3, 4]);
  });
});

describe('validateLeafId', () => {
  it('returns without throwing when id is present', () => {
    const t = projectTree([mkCell(1, null), mkCell(2, 1)]);
    assert.doesNotThrow(() => validateLeafId(t, 2));
  });

  it('throws when id is missing', () => {
    const t = projectTree([mkCell(1, null)]);
    assert.throws(() => validateLeafId(t, 99), /cell id 99 not found/);
  });
});

describe('formatTreeText', () => {
  it('renders ok cells with #id, ok flag, value, and code preview', () => {
    const text = formatTreeText(projectTree([mkCell(1, null, true, 42, 'return 42;')]));
    assert.match(text, /#1/);
    assert.match(text, /\bok\b/);
    assert.match(text, /value=42/);
    assert.match(text, /return 42;/);
  });

  it('renders err cells with error message instead of value', () => {
    const text = formatTreeText(projectTree([mkCell(1, null, false, 'boom', 'throw 1;')]));
    assert.match(text, /\berr\b/);
    assert.match(text, /error=boom/);
    assert.doesNotMatch(text, /value=/);
  });

  it('marks the current leaf with a trailing *', () => {
    const cells = [mkCell(1, null), mkCell(2, 1)];
    const text = formatTreeText(projectTree(cells), 2);
    const lineWith2 = text.split('\n').find((l) => l.includes('#2'))!;
    assert.match(lineWith2, /\*\s*$/);
    const lineWith1 = text.split('\n').find((l) => l.includes('#1'))!;
    assert.doesNotMatch(lineWith1, /\*\s*$/);
  });

  it('truncates code preview to 60 chars', () => {
    const longCode = 'const x = '.padEnd(200, 'A');
    const text = formatTreeText(projectTree([mkCell(1, null, true, null, longCode)]));
    const line = text.split('\n').find((l) => l.includes('#1'))!;
    // The 60-char preview plus ellipsis OR cut at 60; either way the full 200-char source must not appear.
    assert.doesNotMatch(line, /A{100}/);
  });
});
