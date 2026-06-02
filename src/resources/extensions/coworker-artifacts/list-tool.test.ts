// src/resources/extensions/coworker-artifacts/list-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@otto/coworker-artifacts';
import { runListArtifacts } from './list-tool.js';

describe('runListArtifacts', () => {
  it('returns empty when no artifacts', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'lt-')) });
    const out = await runListArtifacts(store);
    assert.equal(out.artifacts.length, 0);
    assert.match(out.markdown, /### Artifacts \(0\)/);
  });
  it('returns rows with markdown table for present artifacts', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'lt2-'));
    const store = new ArtifactStore({ workspaceDir: ws });
    await store.create('report', 'a');
    await store.create('report', 'b');
    const out = await runListArtifacts(store);
    assert.equal(out.artifacts.length, 2);
    assert.match(out.markdown, /### Artifacts \(2\)/);
    assert.match(out.markdown, /\| slug \| kind \| turns \| last updated \| uri \|/);
    assert.match(out.markdown, /artifact:\/\/a/);
    assert.match(out.markdown, /artifact:\/\/b/);
  });
});
