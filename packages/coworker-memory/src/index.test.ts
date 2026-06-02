import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as memory from './index.js';

describe('@otto/coworker-memory barrel', () => {
  it('exports the key surface', () => {
    assert.equal(typeof memory.LocalSqliteBackend, 'function');
    assert.equal(typeof memory.LayerAStore, 'function');
    assert.equal(typeof memory.MemoryRecorder, 'function');
    assert.equal(typeof memory.resolveWorkspaceId, 'function');
    assert.equal(typeof memory.resolveScope, 'function');
    assert.equal(typeof memory.detectPaste, 'function');
    assert.equal(typeof memory.formatRecall, 'function');
    assert.equal(typeof memory.buildLayerAContext, 'function');
    assert.equal(typeof memory.applyPersonaSeed, 'function');
  });
  it('exports error classes', () => {
    assert.equal(typeof memory.LayerAWriteBlocked, 'function');
    assert.equal(typeof memory.RecallQueryMalformed, 'function');
  });
});
