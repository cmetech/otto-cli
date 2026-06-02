// src/resources/extensions/coworker-artifacts/open-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore, ArtifactNotFound } from '@otto/coworker-artifacts';
import { runOpenArtifact } from './open-tool.js';

describe('runOpenArtifact', () => {
  it('returns markdown with content + provenance tail', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ot-')) });
    const h = await store.create('report', 'r');
    await store.update(h, [{ path: 'report.md', content: '# hello\n' }]);
    await store.recordTurn(h, {
      action: 'create',
      turn_id: 't1',
      user_prompt: 'draft',
      files_touched: [],
    });
    const out = await runOpenArtifact(store, { slug: 'r' });
    assert.match(out.markdown, /# hello/);
    assert.match(out.markdown, /Recent provenance/);
    assert.match(out.markdown, /turn `t1`/);
  });
  it('throws ArtifactNotFound for missing slug', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ot2-')) });
    await assert.rejects(() => runOpenArtifact(store, { slug: 'missing' }), ArtifactNotFound);
  });
});
