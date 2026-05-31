import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  VaultEntry, EngineDef, EngineField, BoundClient, CredentialInjector,
} from './vault.js';

describe('vault types', () => {
  it('EngineField carries name + secret + name_from flag', () => {
    const f: EngineField = { name: 'password', secret: true };
    assert.equal(f.secret, true);
  });

  it('EngineDef carries engine slug + fields + test_snippet', () => {
    const e: EngineDef = {
      slug: 'servicenow',
      display_name: 'ServiceNow',
      pip: null,
      fields: [{ name: 'instance', secret: false }],
      auth_methods: ['basic'],
      test_snippet: '/* ts code */',
    };
    assert.equal(e.slug, 'servicenow');
  });

  it('VaultEntry has engine + name + values + secure_keys', () => {
    const v: VaultEntry = {
      engine: 'servicenow',
      name: 'prod',
      values: { instance: 'acme.service-now.com' },
      secure_keys: ['password'],
      created_at: '2026-05-31T10:00:00Z',
    };
    assert.equal(v.engine, 'servicenow');
  });

  it('CredentialInjector has injectEnv + loadForBinding', () => {
    const _methods: Array<keyof CredentialInjector> = ['injectEnv', 'loadForBinding'];
    assert.equal(_methods.length, 2);
  });

  it('BoundClient is a generic typed wrapper', () => {
    const b: BoundClient<{ ping: () => Promise<string> }> = {
      engine: 'servicenow',
      name: 'prod',
      client: { ping: async () => 'ok' },
    };
    assert.equal(b.engine, 'servicenow');
  });
});
