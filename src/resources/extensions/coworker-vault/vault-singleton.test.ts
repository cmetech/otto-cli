// src/resources/extensions/coworker-vault/vault-singleton.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';

describe('vault singleton bundle', () => {
  it('constructs vault, audit, and registry for given roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-bundle-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global'), workspaceDir: undefined });
    assert.ok(b.vault);
    assert.ok(b.audit);
    assert.ok(b.registry);
    assert.ok(b.registry.get('jira'));
  });

  it('honors workspace dir when provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-bundle-ws-'));
    const b = await createVaultBundle({
      globalDir: join(root, 'global'),
      workspaceDir: join(root, 'workspace'),
    });
    assert.deepEqual(await b.vault.list(), []);
  });
});
