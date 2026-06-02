// packages/coworker-memory/src/context-injection.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LayerAStore } from './layer-a-store.js';
import { buildLayerAContext } from './context-injection.js';

async function makeStores() {
  const root = mkdtempSync(join(tmpdir(), 'ci-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const globalStore = new LayerAStore({ scopeDir: join(root, 'g'), scope: 'global', audit, scanner });
  const workspaceStore = new LayerAStore({ scopeDir: join(root, 'w'), scope: 'workspace', audit, scanner });
  return { root, globalStore, workspaceStore };
}

describe('buildLayerAContext', () => {
  it('returns empty when no Layer A files exist', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    const md = await buildLayerAContext({
      mode: 'per-project-tagged', globalStore, workspaceStore, tokenLimit: 3000,
    });
    assert.equal(md, '');
  });
  it('global mode reads global only', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await globalStore.append({ kind: 'profile', text: 'global profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'profile', text: 'workspace profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'global', globalStore, workspaceStore, tokenLimit: 3000,
    });
    assert.match(md, /global profile/);
    assert.equal(md.includes('workspace profile'), false);
  });
  it('per-project mode reads workspace only', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await globalStore.append({ kind: 'profile', text: 'global profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'profile', text: 'workspace profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'per-project', globalStore, workspaceStore, tokenLimit: 3000,
    });
    assert.match(md, /workspace profile/);
    assert.equal(md.includes('global profile'), false);
  });
  it('per-project-tagged includes both with workspace first', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await globalStore.append({ kind: 'rule', text: 'global rule', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'rule', text: 'workspace rule', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'per-project-tagged', globalStore, workspaceStore, tokenLimit: 3000,
    });
    const wsIdx = md.indexOf('workspace rule');
    const gIdx = md.indexOf('global rule');
    assert.ok(wsIdx > 0 && gIdx > 0);
    assert.ok(wsIdx < gIdx, 'workspace should appear before global');
  });
  it('truncates lower-priority files when token limit exceeded', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await workspaceStore.append({ kind: 'profile', text: 'p'.repeat(1000), source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'rule',    text: 'r'.repeat(1000), source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'lesson',  text: 'l'.repeat(1000), source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'per-project', globalStore, workspaceStore, tokenLimit: 300, // ~1200 chars
    });
    assert.ok(md.includes('p'.repeat(50)));
    // lessons should be dropped because lowest priority
    assert.equal(md.includes('l'.repeat(900)), false);
  });
});
