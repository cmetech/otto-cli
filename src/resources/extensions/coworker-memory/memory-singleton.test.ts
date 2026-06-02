// src/resources/extensions/coworker-memory/memory-singleton.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';

describe('memory singleton bundle', () => {
  it('constructs scope-aware bundle with all stores', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-'));
    mkdirSync(ws, { recursive: true });
    const bundle = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => null,
    });
    assert.ok(bundle.globalLayerA);
    assert.ok(bundle.workspaceLayerA);
    assert.ok(bundle.backend);
    assert.ok(bundle.recorder);
    assert.equal(bundle.scopeMode, 'per-project-tagged');
    assert.match(bundle.workspaceWing, /-[0-9a-f]{6}$/);
    assert.equal(bundle.writeWing, bundle.workspaceWing);
    assert.deepEqual(bundle.readWings, [bundle.workspaceWing, 'global']);
    await bundle.dispose();
  });
  it('global mode bundle uses wing global', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-g-'));
    const bundle = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'global',
      currentScratchpadName: () => null,
    });
    assert.equal(bundle.writeWing, 'global');
    assert.deepEqual(bundle.readWings, ['global']);
    await bundle.dispose();
  });
});
