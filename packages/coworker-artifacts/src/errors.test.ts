// packages/coworker-artifacts/src/errors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactNotFound, ArtifactKindRejected, ArtifactUriMalformed, ArtifactSlugCollision,
} from './errors.js';

describe('artifact errors', () => {
  it('ArtifactNotFound carries slug', () => {
    const e = new ArtifactNotFound('rca-1');
    assert.equal(e.name, 'ArtifactNotFound');
    assert.equal(e.slug, 'rca-1');
    assert.match(e.message, /rca-1/);
  });
  it('ArtifactKindRejected carries kind', () => {
    const e = new ArtifactKindRejected('workbook');
    assert.equal(e.name, 'ArtifactKindRejected');
    assert.equal(e.kind, 'workbook');
    assert.match(e.message, /workbook/);
    assert.match(e.message, /report/);
  });
  it('ArtifactUriMalformed carries uri + reason', () => {
    const e = new ArtifactUriMalformed('artifact://../x', 'path traversal');
    assert.equal(e.name, 'ArtifactUriMalformed');
    assert.equal(e.uri, 'artifact://../x');
    assert.equal(e.reason, 'path traversal');
    assert.match(e.message, /path traversal/);
  });
  it('ArtifactSlugCollision carries base + attempts', () => {
    const e = new ArtifactSlugCollision('rca', 100);
    assert.equal(e.name, 'ArtifactSlugCollision');
    assert.equal(e.base, 'rca');
    assert.equal(e.attempts, 100);
    assert.match(e.message, /rca/);
    assert.match(e.message, /100/);
  });
});
