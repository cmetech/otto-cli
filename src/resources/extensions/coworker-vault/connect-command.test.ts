// src/resources/extensions/coworker-vault/connect-command.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';
import { runConnect } from './connect-command.js';
import { VAULT_KEEP } from '@otto/coworker-vault';

function answers(map: Record<string, string>): (field: string) => Promise<string> {
  return async (field: string) => map[field] ?? '';
}

async function freshBundle() {
  const root = mkdtempSync(join(tmpdir(), 'connect-cmd-'));
  return createVaultBundle({ globalDir: join(root, 'global') });
}

describe('/connect', () => {
  it('creates a new entry from field prompts', async () => {
    const bundle = await freshBundle();
    await runConnect(bundle, {
      engineId: 'jira',
      entryName: 'prod',
      forceWorkspace: false,
      promptProvider: answers({
        url: 'https://x',
        email: 'a@b',
        token: 'tok',
      }),
    });
    const got = await bundle.vault.get({ engine: 'jira', name: 'prod' });
    assert.deepEqual(got.fields, { url: 'https://x', email: 'a@b', token: 'tok' });
  });

  it('edits an existing entry; sentinel preserves the stored secret', async () => {
    const bundle = await freshBundle();
    await bundle.vault.set(
      { engine: 'jira', name: 'prod' },
      { url: 'u', email: 'e', token: 'OLD' },
    );
    await runConnect(bundle, {
      engineId: 'jira',
      entryName: 'prod',
      forceWorkspace: false,
      promptProvider: answers({
        url: 'NEW_URL',
        email: 'NEW_EMAIL',
        token: VAULT_KEEP,
      }),
    });
    const got = await bundle.vault.get({ engine: 'jira', name: 'prod' });
    assert.deepEqual(got.fields, { url: 'NEW_URL', email: 'NEW_EMAIL', token: 'OLD' });
  });

  it('rejects unknown engine', async () => {
    const bundle = await freshBundle();
    await assert.rejects(
      runConnect(bundle, {
        engineId: 'nope',
        entryName: 'prod',
        forceWorkspace: false,
        promptProvider: answers({}),
      }),
      /Unknown engine/,
    );
  });

  it('rejects sentinel in create-mode secret field', async () => {
    const bundle = await freshBundle();
    await assert.rejects(
      runConnect(bundle, {
        engineId: 'jira',
        entryName: 'prod',
        forceWorkspace: false,
        promptProvider: answers({
          url: 'https://x',
          email: 'a@b',
          token: VAULT_KEEP,
        }),
      }),
      /VAULT_KEEP is reserved/,
    );
  });

  it('errors when a required field is empty', async () => {
    const bundle = await freshBundle();
    await assert.rejects(
      runConnect(bundle, {
        engineId: 'jira',
        entryName: 'prod',
        forceWorkspace: false,
        promptProvider: answers({
          url: '',
          email: 'a@b',
          token: 'tok',
        }),
      }),
      /required/i,
    );
  });
});
