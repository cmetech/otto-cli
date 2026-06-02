import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('coworker-vault barrel', () => {
  it('barrel imports without throwing', async () => {
    const mod = await import('./index.js');
    assert.ok(mod, 'module namespace should load');
  });

  it('exposes expected public API', async () => {
    const mod = await import('./index.js');
    // Spot-check key exports from each submodule.
    assert.equal(typeof mod.LocalDataVault, 'function', 'LocalDataVault class exported');
    assert.equal(typeof mod.EngineRegistry, 'function', 'EngineRegistry class exported');
    assert.equal(typeof mod.CredentialInjector, 'function', 'CredentialInjector class exported');
    assert.equal(typeof mod.clearEnv, 'function', 'clearEnv function exported');
    assert.equal(typeof mod.envVarName, 'function', 'envVarName helper exported');
    assert.equal(typeof mod.BindingNotFound, 'function', 'BindingNotFound error exported');
    assert.equal(typeof mod.BindingRefMalformed, 'function', 'BindingRefMalformed error exported');
    assert.equal(typeof mod.VaultEntryNotFound, 'function', 'VaultEntryNotFound error exported');
    assert.equal(typeof mod.mergeWithSentinel, 'function', 'mergeWithSentinel helper exported');
    assert.equal(typeof mod.VAULT_KEEP, 'string', 'VAULT_KEEP sentinel exported');
  });
});
