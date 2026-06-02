// packages/coworker-artifacts/src/resolve-uri.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtifactUri, ARTIFACT_URI_SCHEME } from './resolve-uri.js';
import { ArtifactUriMalformed } from './errors.js';

describe('resolveArtifactUri', () => {
  const ws = '/tmp/workspace';
  it('parses simple slug', () => {
    const r = resolveArtifactUri('artifact://rca-1', ws);
    assert.equal(r.slug, 'rca-1');
    assert.equal(r.dir, '/tmp/workspace/.otto/artifacts/rca-1');
    assert.equal(r.primaryPath, '/tmp/workspace/.otto/artifacts/rca-1/report.md');
    assert.equal(r.metadataPath, '/tmp/workspace/.otto/artifacts/rca-1/metadata.json');
    assert.equal(r.provenancePath, '/tmp/workspace/.otto/artifacts/rca-1/provenance.json');
    assert.equal(r.readmePath, '/tmp/workspace/.otto/artifacts/rca-1/README.md');
  });
  it('accepts single-char slug', () => {
    const r = resolveArtifactUri('artifact://x', ws);
    assert.equal(r.slug, 'x');
  });
  it('rejects bad scheme', () => {
    assert.throws(() => resolveArtifactUri('memory://x', ws), ArtifactUriMalformed);
  });
  it('rejects uppercase slug', () => {
    assert.throws(() => resolveArtifactUri('artifact://RCA', ws), ArtifactUriMalformed);
  });
  it('rejects path traversal', () => {
    assert.throws(() => resolveArtifactUri('artifact://../escape', ws), ArtifactUriMalformed);
  });
  it('rejects leading dash', () => {
    assert.throws(() => resolveArtifactUri('artifact://-foo', ws), ArtifactUriMalformed);
  });
  it('rejects trailing dash', () => {
    assert.throws(() => resolveArtifactUri('artifact://foo-', ws), ArtifactUriMalformed);
  });
  it('rejects > 64 chars', () => {
    assert.throws(() => resolveArtifactUri(`artifact://${'a'.repeat(65)}`, ws), ArtifactUriMalformed);
  });
  it('rejects empty slug', () => {
    assert.throws(() => resolveArtifactUri('artifact://', ws), ArtifactUriMalformed);
  });
  it('exports scheme constant', () => {
    assert.equal(ARTIFACT_URI_SCHEME, 'artifact://');
  });
});
