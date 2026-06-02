// src/resources/extensions/coworker-artifacts/artifacts-command.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@otto/coworker-artifacts';
import { runArtifactsCommand } from './artifacts-command.js';

describe('/artifacts command', () => {
  it('list returns markdown table', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac-')) });
    await store.create('report', 'a');
    const out = await runArtifactsCommand(store, ['list']);
    assert.match(out.message, /### Artifacts \(1\)/);
  });
  it('bare invocation defaults to list', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac2-')) });
    const out = await runArtifactsCommand(store, []);
    assert.match(out.message, /### Artifacts \(0\)/);
  });
  it('show <slug> dumps content + provenance', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac3-')) });
    const h = await store.create('report', 'r');
    await store.update(h, [{ path: 'report.md', content: '# yo\n' }]);
    const out = await runArtifactsCommand(store, ['show', 'r']);
    assert.match(out.message, /# yo/);
  });
  it('remove --confirm deletes', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'ac4-'));
    const store = new ArtifactStore({ workspaceDir: ws });
    const h = await store.create('report', 'r');
    const out = await runArtifactsCommand(store, ['remove', 'r', '--confirm']);
    assert.match(out.message, /removed: r/);
    assert.equal(existsSync(h.dir), false);
  });
  it('remove without --confirm errors', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac5-')) });
    await store.create('report', 'r');
    await assert.rejects(() => runArtifactsCommand(store, ['remove', 'r']));
  });
  it('unknown subcommand errors', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac6-')) });
    await assert.rejects(() => runArtifactsCommand(store, ['banana']));
  });
});
