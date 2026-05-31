import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDataLoadEvent } from './kernel-protocol.js';
import type { DataLoadEvent, ReadyEvent, ResultOk } from './kernel-protocol.js';

describe('isDataLoadEvent', () => {
  it('returns true for a data_load event frame', () => {
    const frame: DataLoadEvent = {
      type: 'event',
      event: 'data_load',
      drawer: {
        kind: 'data_load',
        collector: 'file',
        uri: 'file:///x/a.csv',
        bytes: 8,
        rows_loaded: null,
        loaded_at: '2026-05-31T00:00:00.000Z',
        schema: null,
      },
    };
    assert.equal(isDataLoadEvent(frame), true);
  });

  it('returns false for the ready event frame', () => {
    const frame: ReadyEvent = { type: 'event', event: 'ready' };
    assert.equal(isDataLoadEvent(frame), false);
  });

  it('returns false for a result frame', () => {
    const frame: ResultOk = { id: 1, type: 'result', ok: true, value: 42, stdout: '' };
    assert.equal(isDataLoadEvent(frame), false);
  });
});
