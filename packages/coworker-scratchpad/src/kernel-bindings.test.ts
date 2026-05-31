import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDataLibBindings } from './kernel-bindings.js';

describe('kernel-bindings', () => {
  it('exposes all seven pre-bound data libraries', () => {
    const b = buildDataLibBindings();
    for (const key of ['polars', 'DuckDB', 'ExcelJS', 'dateFns', 'lodash', 'zod', 'axios']) {
      assert.ok(key in b, `missing binding: ${key}`);
      assert.notEqual(b[key], undefined, `binding is undefined: ${key}`);
    }
  });

  it('binds usable shapes (polars.DataFrame, zod.string, dateFns.format)', () => {
    const b = buildDataLibBindings() as Record<string, any>;
    assert.equal(typeof b.polars.DataFrame, 'function');
    assert.equal(typeof b.zod.string, 'function');
    assert.equal(typeof b.dateFns.format, 'function');
    assert.equal(typeof b.lodash.chunk, 'function');
    assert.equal(typeof b.axios.get, 'function');
    assert.equal(typeof b.ExcelJS.Workbook, 'function');
  });
});
