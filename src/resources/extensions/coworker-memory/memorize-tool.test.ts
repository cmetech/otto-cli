// src/resources/extensions/coworker-memory/memorize-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';

async function bundleFor(scope: 'global'|'per-project'|'per-project-tagged') {
  return createMemoryBundle({
    globalDir: mkdtempSync(join(tmpdir(), 'mt-home-')),
    workspaceDir: mkdtempSync(join(tmpdir(), 'mt-ws-')),
    scopeMode: scope, currentScratchpadName: () => null,
  });
}

describe('memorize tool', () => {
  it('writes lesson to workspace by default', async () => {
    const b = await bundleFor('per-project-tagged');
    await runMemorize(b, { text: 'MTTR target 30m', kind: 'lesson' });
    const body = await b.workspaceLayerA.read('lesson');
    assert.match(body, /MTTR target 30m/);
    assert.equal((await b.globalLayerA.read('lesson')), '');
    await b.dispose();
  });
  it('honors scope: global', async () => {
    const b = await bundleFor('per-project-tagged');
    await runMemorize(b, { text: 'use polars', kind: 'profile', scope: 'global' });
    assert.match(await b.globalLayerA.read('profile'), /use polars/);
    await b.dispose();
  });
  it('throws LayerAWriteBlocked on secret content', async () => {
    const b = await bundleFor('per-project-tagged');
    await assert.rejects(
      () => runMemorize(b, { text: 'token AKIAABCDEFGHIJKLMNOP', kind: 'rule' }),
      /VAULT|secret-shaped|Refused/,
    );
    await b.dispose();
  });
});
