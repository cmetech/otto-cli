// packages/coworker-memory/src/scope-resolver.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScope } from './scope-resolver.js';

describe('resolveScope', () => {
  const wing = 'acme-noc-7f3a9c';
  it('global → write global, read [global]', () => {
    const r = resolveScope({ mode: 'global', workspaceId: wing });
    assert.equal(r.writeWing, 'global');
    assert.deepEqual(r.readWings, ['global']);
  });
  it('per-project → write workspace, read [workspace]', () => {
    const r = resolveScope({ mode: 'per-project', workspaceId: wing });
    assert.equal(r.writeWing, wing);
    assert.deepEqual(r.readWings, [wing]);
  });
  it('per-project-tagged → write workspace, read [workspace, global]', () => {
    const r = resolveScope({ mode: 'per-project-tagged', workspaceId: wing });
    assert.equal(r.writeWing, wing);
    assert.deepEqual(r.readWings, [wing, 'global']);
  });
});
