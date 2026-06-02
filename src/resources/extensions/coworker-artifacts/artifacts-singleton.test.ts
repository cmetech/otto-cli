// src/resources/extensions/coworker-artifacts/artifacts-singleton.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactsBundle } from './artifacts-singleton.js';

describe('createArtifactsBundle', () => {
  it('returns bundle with ArtifactStore', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'art-bundle-'));
    const b = await createArtifactsBundle({ workspaceDir: ws });
    assert.ok(b.store);
    assert.equal(b.workspaceDir, ws);
    await b.dispose();
  });
  it('store creates an artifact in the workspace dir', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'art-b2-'));
    const b = await createArtifactsBundle({ workspaceDir: ws });
    const h = await b.store.create('report', 'test');
    assert.equal(h.slug, 'test');
    assert.match(h.dir, /\.otto\/artifacts\/test$/);
    await b.dispose();
  });
});
