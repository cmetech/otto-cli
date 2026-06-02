import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as artifacts from './index.js';

describe('@otto/coworker-artifacts barrel', () => {
  it('exports key surface', () => {
    assert.equal(typeof artifacts.ArtifactStore, 'function');
    assert.equal(typeof artifacts.deriveSlug, 'function');
    assert.equal(typeof artifacts.nextCollisionSlug, 'function');
    assert.equal(typeof artifacts.takeSnapshot, 'function');
    assert.equal(typeof artifacts.diffSnapshots, 'function');
    assert.equal(typeof artifacts.resolveArtifactUri, 'function');
    assert.equal(typeof artifacts.renderReadme, 'function');
    assert.equal(artifacts.ARTIFACT_URI_SCHEME, 'artifact://');
  });
  it('exports error classes', () => {
    assert.equal(typeof artifacts.ArtifactNotFound, 'function');
    assert.equal(typeof artifacts.ArtifactKindRejected, 'function');
    assert.equal(typeof artifacts.ArtifactUriMalformed, 'function');
    assert.equal(typeof artifacts.ArtifactSlugCollision, 'function');
  });
});
