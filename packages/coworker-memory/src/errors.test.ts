// packages/coworker-memory/src/errors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryNotInitialized, BackendUnavailable, DrawerKindRejected,
  LayerAWriteBlocked, RecallQueryMalformed, MemoryEntryMalformed,
} from './errors.js';

describe('memory errors', () => {
  it('MemoryNotInitialized carries reason', () => {
    const e = new MemoryNotInitialized('workspace.json corrupted');
    assert.equal(e.name, 'MemoryNotInitialized');
    assert.equal(e.reason, 'workspace.json corrupted');
    assert.ok(e.message.includes('workspace.json corrupted'));
  });
  it('BackendUnavailable carries reason', () => {
    const e = new BackendUnavailable('SQLITE_BUSY after retries');
    assert.equal(e.name, 'BackendUnavailable');
    assert.equal(e.reason, 'SQLITE_BUSY after retries');
  });
  it('DrawerKindRejected carries kind', () => {
    const e = new DrawerKindRejected('mystery');
    assert.equal(e.name, 'DrawerKindRejected');
    assert.equal(e.kind, 'mystery');
    assert.ok(e.message.includes('mystery'));
  });
  it('LayerAWriteBlocked carries secret_kind', () => {
    const e = new LayerAWriteBlocked('anthropic_api_key');
    assert.equal(e.name, 'LayerAWriteBlocked');
    assert.equal(e.secretKind, 'anthropic_api_key');
    assert.ok(e.message.includes('anthropic_api_key'));
    assert.ok(e.message.includes('/connect'));
  });
  it('RecallQueryMalformed carries reason', () => {
    const e = new RecallQueryMalformed('empty query');
    assert.equal(e.name, 'RecallQueryMalformed');
    assert.equal(e.reason, 'empty query');
  });
  it('MemoryEntryMalformed carries path', () => {
    const e = new MemoryEntryMalformed('/tmp/profile.md', 'bad frontmatter');
    assert.equal(e.name, 'MemoryEntryMalformed');
    assert.equal(e.path, '/tmp/profile.md');
    assert.equal(e.reason, 'bad frontmatter');
  });
});
