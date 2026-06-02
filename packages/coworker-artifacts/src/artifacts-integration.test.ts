// packages/coworker-artifacts/src/artifacts-integration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import coworkerVaultExtension from '../../../src/resources/extensions/coworker-vault/index.js';
import coworkerMemoryExtension, { getMemoryRecorder, createMemoryBundle } from '../../../src/resources/extensions/coworker-memory/index.js';
import coworkerArtifactsExtension, { getArtifactStore } from '../../../src/resources/extensions/coworker-artifacts/index.js';
import coworkerScratchpadExtension from '../../../src/resources/extensions/coworker-scratchpad/index.js';
import { makeFakeApi, fireSessionStart, fireSessionShutdown } from '../../../src/resources/extensions/coworker-vault/test-helpers.js';

describe('Phase 4 — cross-extension integration', () => {
  it('artifact created by store surfaces as kind:artifact drawer in memory and persists on disk', async () => {
    const global = mkdtempSync(join(tmpdir(), 'p4-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'p4-w-'));
    const sp = mkdtempSync(join(tmpdir(), 'p4-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const vaultApi = makeFakeApi();
      const memApi = makeFakeApi();
      const artApi = makeFakeApi();
      const spApi = makeFakeApi();
      coworkerVaultExtension(vaultApi.api);
      coworkerMemoryExtension(memApi.api);
      coworkerArtifactsExtension(artApi.api);
      coworkerScratchpadExtension(spApi.api);

      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(memApi, { cwd: ws });
      await fireSessionStart(artApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });

      const store = getArtifactStore();
      const recorder = getMemoryRecorder();
      assert.ok(store);
      assert.ok(recorder);

      // Simulate kernel→manager flow: store.create + recorder.recordArtifact
      const handle = await store.create('report', 'RCA: load balancer 503');
      await store.update(handle, [{ path: 'report.md', content: '# RCA\n\nbody\n' }]);
      await recorder.recordArtifact({
        scratchpadName: 'p1-incident',
        slug: handle.slug,
        kind: handle.kind,
        uri: handle.uri,
        turnId: 'turn-abc',
      });

      // Disk verification
      assert.ok(existsSync(handle.dir));
      assert.match(readFileSync(handle.primaryPath, 'utf8'), /# RCA/);
      assert.match(readFileSync(handle.metadataPath, 'utf8'), /"slug": "rca-load-balancer-503"/);

      // Memory recall via peek bundle
      const peek = await createMemoryBundle({
        globalDir: global, workspaceDir: ws,
        scopeMode: 'per-project-tagged',
        currentScratchpadName: () => null,
      });
      try {
        const r = await peek.backend.recall({ query: 'rca-load-balancer-503', kind: 'artifact' });
        assert.equal(r.length, 1);
        const parsed = JSON.parse(r[0]!.drawer.content);
        assert.equal(parsed.slug, 'rca-load-balancer-503');
        assert.equal(parsed.uri, 'artifact://rca-load-balancer-503');
        assert.equal(r[0]!.drawer.room, 'p1-incident');
      } finally { await peek.dispose(); }

      await fireSessionShutdown(spApi);
      await fireSessionShutdown(artApi);
      await fireSessionShutdown(memApi);
      await fireSessionShutdown(vaultApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('artifact init failure does not break memory or vault', async () => {
    // Skip artifact activation; vault + memory + scratchpad activate normally
    const global = mkdtempSync(join(tmpdir(), 'p4-mix-'));
    const ws = mkdtempSync(join(tmpdir(), 'p4-mix-ws-'));
    const sp = mkdtempSync(join(tmpdir(), 'p4-mix-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const vaultApi = makeFakeApi();
      const memApi = makeFakeApi();
      const spApi = makeFakeApi();
      coworkerVaultExtension(vaultApi.api);
      coworkerMemoryExtension(memApi.api);
      coworkerScratchpadExtension(spApi.api);
      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(memApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });
      assert.equal(getArtifactStore(), null);
      assert.equal(getMemoryRecorder() !== null, true);
      await fireSessionShutdown(spApi);
      await fireSessionShutdown(memApi);
      await fireSessionShutdown(vaultApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });
});
