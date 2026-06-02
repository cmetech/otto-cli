import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault } from './data-vault.js';
import { CredentialInjector, clearEnv } from './injector.js';
import { BindingNotFound, BindingRefMalformed } from './errors.js';

function ctx() {
  const root = mkdtempSync(join(tmpdir(), 'vault-inj-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const vault = new LocalDataVault({ globalDir: join(root, 'global'), workspaceDir: undefined, audit });
  return { root, audit, vault };
}

function injCtx() {
  return { scratchpadName: 'sp-test', sessionId: 'sess-test', pid: 1234 };
}

describe('CredentialInjector', () => {
  it('returns OTTO_DS_<ENGINE>_<NAME>__<FIELD> for each field', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x', email: 'a@b', token: 't' });
    const injector = new CredentialInjector({ vault, audit });
    const out = await injector.injectEnv({ PATH: '/bin' }, ['jira:prod'], injCtx());
    assert.equal(out['OTTO_DS_JIRA_PROD__URL'], 'https://x');
    assert.equal(out['OTTO_DS_JIRA_PROD__EMAIL'], 'a@b');
    assert.equal(out['OTTO_DS_JIRA_PROD__TOKEN'], 't');
    assert.equal(out['PATH'], '/bin');
  });

  it('uppercases entry name and replaces hyphens with underscores in env var name', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod-east-1' }, { url: 'https://x' });
    const injector = new CredentialInjector({ vault, audit });
    const out = await injector.injectEnv({}, ['jira:prod-east-1'], injCtx());
    assert.equal(out['OTTO_DS_JIRA_PROD_EAST_1__URL'], 'https://x');
  });

  it('does not mutate baseEnv', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x' });
    const injector = new CredentialInjector({ vault, audit });
    const baseEnv = { PATH: '/bin' };
    const snapshot = { ...baseEnv };
    await injector.injectEnv(baseEnv, ['jira:prod'], injCtx());
    assert.deepEqual(baseEnv, snapshot);
  });

  it('strict mode (default) throws BindingNotFound for missing binding', async () => {
    const { vault, audit } = ctx();
    const injector = new CredentialInjector({ vault, audit });
    await assert.rejects(
      () => injector.injectEnv({}, ['jira:missing'], injCtx()),
      (err: unknown) => err instanceof BindingNotFound,
    );
  });

  it('loose mode (OTTO_VAULT_MISSING_OK=1) skips missing binding and warns', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x' });
    const injector = new CredentialInjector({ vault, audit });
    const prev = process.env.OTTO_VAULT_MISSING_OK;
    process.env.OTTO_VAULT_MISSING_OK = '1';
    try {
      const out = await injector.injectEnv({}, ['jira:prod', 'jira:missing'], injCtx());
      assert.equal(out['OTTO_DS_JIRA_PROD__URL'], 'https://x');
      assert.equal(out['OTTO_DS_JIRA_MISSING__URL'], undefined);
    } finally {
      if (prev === undefined) delete process.env.OTTO_VAULT_MISSING_OK;
      else process.env.OTTO_VAULT_MISSING_OK = prev;
    }
  });

  it('throws BindingRefMalformed on bad ref', async () => {
    const { vault, audit } = ctx();
    const injector = new CredentialInjector({ vault, audit });
    await assert.rejects(
      () => injector.injectEnv({}, ['jira/prod'], injCtx()),
      (err: unknown) => err instanceof BindingRefMalformed,
    );
  });

  it("emits one audit 'inject' record per binding with fields_injected (names only)", async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x', token: 't' });
    const injector = new CredentialInjector({ vault, audit });
    await injector.injectEnv({}, ['jira:prod'], injCtx());
    const records: { action: string; detail: { fields_injected?: string[] } }[] = [];
    for await (const r of audit.read({ producer: 'vault', action: 'inject' })) {
      records.push(r as never);
    }
    assert.equal(records.length, 1);
    assert.deepEqual(records[0]!.detail.fields_injected!.slice().sort(), ['token', 'url']);
  });
});

describe('clearEnv', () => {
  it('removes OTTO_DS_* keys, preserves others, returns count', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/bin', OTTO_DS_JIRA_PROD__URL: 'x', FOO: 'bar' };
    const n = clearEnv(env);
    assert.equal(n, 1);
    assert.equal(env['OTTO_DS_JIRA_PROD__URL'], undefined);
    assert.equal(env['PATH'], '/bin');
    assert.equal(env['FOO'], 'bar');
  });
});
