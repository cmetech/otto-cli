// src/resources/extensions/coworker-vault/datasource-command.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';
import {
  runDatasourceList,
  runDatasourceRemove,
  runDatasourceTest,
} from './datasource-command.js';

async function freshBundle() {
  const root = mkdtempSync(join(tmpdir(), 'datasource-cmd-'));
  const globalDir = join(root, 'global');
  const bundle = await createVaultBundle({ globalDir });
  return { bundle, globalDir };
}

describe('/datasource', () => {
  it('list returns rows with engine, name, scope, fields_set (secret fields marked)', async () => {
    const { bundle } = await freshBundle();
    await bundle.vault.set(
      { engine: 'jira', name: 'prod' },
      { url: 'u', email: 'e', token: 't' },
    );
    const rows = await runDatasourceList(bundle, {});
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.engine, 'jira');
    assert.equal(row.name, 'prod');
    assert.equal(row.scope, 'global');
    const sortedFields = [...row.fields].sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(sortedFields, [
      { name: 'email', secret: false, display: 'e' },
      { name: 'token', secret: true, display: '••••••' },
      { name: 'url', secret: false, display: 'u' },
    ]);
  });

  it('list filters by --engine', async () => {
    const { bundle } = await freshBundle();
    await bundle.vault.set(
      { engine: 'jira', name: 'prod' },
      { url: 'u', email: 'e', token: 't' },
    );
    const jiraRows = await runDatasourceList(bundle, { engine: 'jira' });
    assert.equal(jiraRows.length, 1);
    const datadogRows = await runDatasourceList(bundle, { engine: 'datadog' });
    assert.equal(datadogRows.length, 0);
  });

  it('remove deletes entry file', async () => {
    const { bundle, globalDir } = await freshBundle();
    await bundle.vault.set(
      { engine: 'jira', name: 'prod' },
      { url: 'u', email: 'e', token: 't' },
    );
    const path = join(globalDir, 'data_vault', 'jira-prod.json');
    assert.equal(existsSync(path), true);
    await runDatasourceRemove(bundle, { ref: 'jira:prod' });
    assert.equal(existsSync(path), false);
  });

  it('test returns OTTO_DS_* env-var names that would inject (no network)', async () => {
    const { bundle } = await freshBundle();
    await bundle.vault.set(
      { engine: 'jira', name: 'prod' },
      { url: 'u', email: 'e', token: 't' },
    );
    const preview = await runDatasourceTest(bundle, { ref: 'jira:prod' });
    const sorted = [...preview.envVarNames].sort();
    assert.deepEqual(sorted, [
      'OTTO_DS_JIRA_PROD__EMAIL',
      'OTTO_DS_JIRA_PROD__TOKEN',
      'OTTO_DS_JIRA_PROD__URL',
    ]);
  });
});
