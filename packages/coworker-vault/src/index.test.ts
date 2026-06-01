import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('coworker-vault (phase 0 scaffold)', () => {
  it('barrel imports without throwing', async () => {
    const mod = await import('./index.js');
    assert.ok(mod, 'module namespace should load');
  });

  it('exposes no runtime exports yet', async () => {
    const mod = await import('./index.js');
    assert.deepEqual(Object.keys(mod), [], 'phase 0 scaffold should have an empty barrel');
  });
});
