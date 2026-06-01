import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectKind, FILE_COLLECTOR_KINDS } from './detect-kind.js';

describe('detectKind', () => {
  it('maps each supported extension to its DataKind', () => {
    assert.equal(detectKind('/x/cmdb.csv'), 'csv');
    assert.equal(detectKind('/x/report.xlsx'), 'xlsx');
    assert.equal(detectKind('/x/data.json'), 'json');
    assert.equal(detectKind('/x/big.parquet'), 'parquet');
    assert.equal(detectKind('/x/notes.txt'), 'txt');
    assert.equal(detectKind('/x/README.md'), 'md');
  });

  it('is case-insensitive on the extension', () => {
    assert.equal(detectKind('/x/CMDB.CSV'), 'csv');
  });

  it('handles file:// URIs and strips query/hash', () => {
    assert.equal(detectKind('file:///workspace/.otto/inputs/a.csv'), 'csv');
    assert.equal(detectKind('file:///x/a.json?v=2#top'), 'json');
  });

  it('returns null for unsupported or extensionless paths', () => {
    assert.equal(detectKind('/x/report.pdf'), null);
    assert.equal(detectKind('/x/Makefile'), null);
    assert.equal(detectKind('/x/archive.tar.gz'), null);
  });

  it('exposes the supported kinds as a stable list', () => {
    assert.deepEqual([...FILE_COLLECTOR_KINDS].sort(), ['csv', 'json', 'md', 'parquet', 'txt', 'xlsx']);
  });
});
