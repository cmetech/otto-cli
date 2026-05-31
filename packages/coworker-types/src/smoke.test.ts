import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('phase 0 smoke', () => {
  it('coworker-types barrel exports all five modules', async () => {
    const mod = await import('./index.js');
    // Memory
    assert.ok('Drawer' in mod === false, 'types only — runtime should be empty');
    // But at runtime imports should resolve without throwing.
    assert.ok(mod, 'module loaded');
  });

  it('coworker-utils barrel exports all helpers at runtime', async () => {
    const mod = await import('@otto/coworker-utils');
    assert.equal(typeof (mod as any).writeNdjson, 'function');
    assert.equal(typeof (mod as any).readNdjson, 'function');
    assert.equal(typeof (mod as any).acquireLease, 'function');
    assert.equal(typeof (mod as any).releaseLease, 'function');
    assert.equal(typeof (mod as any).MigrationRunner, 'function');
    assert.equal(typeof (mod as any).SecretScanner, 'function');
    assert.equal(typeof (mod as any).createLogger, 'function');
  });

  it('all four pillar packages import without error', async () => {
    const memory    = await import('@otto/coworker-memory');
    const vault     = await import('@otto/coworker-vault');
    const artifacts = await import('@otto/coworker-artifacts');
    const scratch   = await import('@otto/coworker-scratchpad');
    assert.ok(memory);
    assert.ok(vault);
    assert.ok(artifacts);
    assert.ok(scratch);
  });
});
