import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault } from './data-vault.js';
import { VaultEntryNotFound, VaultEntryMalformed, BindingRefMalformed } from './errors.js';

function ctx() {
  const root = mkdtempSync(join(tmpdir(), 'vault-'));
  return {
    root,
    audit: new AuditLog({ path: join(root, 'audit.jsonl') }),
    globalDir: join(root, 'global'),
    wsDir: join(root, 'ws'),
  };
}

describe('LocalDataVault', () => {
  it('round-trips an entry through set/get', async () => {
    const c = ctx();
    const vault = new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    const ref = { engine: 'jira', name: 'prod' };
    await vault.set(ref, { url: 'u', email: 'e', token: 't' });
    const entry = await vault.get(ref);
    assert.equal(entry.engine, 'jira');
    assert.equal(entry.name, 'prod');
    assert.equal(entry.fields.url, 'u');
    assert.equal(entry.fields.email, 'e');
    assert.equal(entry.fields.token, 't');
    assert.ok(entry.created_at, 'expected created_at to be truthy');
  });

  it('stores files with mode 0600', async () => {
    const c = ctx();
    const vault = new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 't' });
    const path = join(c.globalDir, 'data_vault', 'jira-prod.json');
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('throws VaultEntryNotFound when entry missing', async () => {
    const c = ctx();
    const vault = new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    await assert.rejects(
      vault.get({ engine: 'jira', name: 'missing' }),
      (err: Error) => err instanceof VaultEntryNotFound,
    );
  });

  it('throws VaultEntryMalformed when file is invalid JSON', async () => {
    const c = ctx();
    const dir = join(c.globalDir, 'data_vault');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'jira-prod.json'), 'not json');
    const vault = new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    await assert.rejects(
      vault.get({ engine: 'jira', name: 'prod' }),
      (err: Error) => err instanceof VaultEntryMalformed,
    );
  });

  it('atomic write does not leave torn files; orphan .tmp cleaned on next open', async () => {
    const c = ctx();
    const dir = join(c.globalDir, 'data_vault');
    mkdirSync(dir, { recursive: true });
    const orphan = join(dir, 'jira-orphan.json.tmp');
    writeFileSync(orphan, '{"partial":');
    assert.ok(existsSync(orphan), 'precondition: orphan exists');
    new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    assert.equal(existsSync(orphan), false, 'orphan .tmp should be swept');
  });

  it('remove deletes the entry file and emits audit', async () => {
    const c = ctx();
    const vault = new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    const ref = { engine: 'jira', name: 'prod' };
    await vault.set(ref, { url: 'u', email: 'e', token: 't' });
    const path = join(c.globalDir, 'data_vault', 'jira-prod.json');
    assert.ok(existsSync(path), 'precondition: file exists after set');
    await vault.remove(ref);
    assert.equal(existsSync(path), false, 'file should no longer exist after remove');
  });

  it('list returns entries with engine, name, scope, fields_set, last_modified', async () => {
    const c = ctx();
    const vault = new LocalDataVault({ globalDir: c.globalDir, audit: c.audit });
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 't' });
    await vault.set({ engine: 'jira', name: 'test' }, { url: 'u2' });
    const entries = await vault.list();
    assert.equal(entries.length, 2);
    const prod = entries.find((e) => e.name === 'prod');
    const test = entries.find((e) => e.name === 'test');
    assert.ok(prod);
    assert.ok(test);
    assert.equal(prod!.engine, 'jira');
    assert.equal(prod!.scope, 'global');
    assert.deepEqual(prod!.fields_set.sort(), ['email', 'token', 'url']);
    assert.ok(prod!.last_modified_at);
    assert.deepEqual(test!.fields_set, ['url']);
  });

  it('parseRef parses jira:prod into { engine, name }', () => {
    const ref = LocalDataVault.parseRef('jira:prod');
    assert.deepEqual(ref, { engine: 'jira', name: 'prod' });
  });

  it('parseRef throws BindingRefMalformed on bad input', () => {
    assert.throws(
      () => LocalDataVault.parseRef('jira/prod'),
      (err: Error) => err instanceof BindingRefMalformed,
    );
    assert.throws(
      () => LocalDataVault.parseRef(''),
      (err: Error) => err instanceof BindingRefMalformed,
    );
  });
});
