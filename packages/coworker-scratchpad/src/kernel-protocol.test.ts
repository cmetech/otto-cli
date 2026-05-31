import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDataLoadEvent, isProgressEvent } from './kernel-protocol.js';
import type { DataLoadEvent, ProgressEvent, ReadyEvent, ResultOk } from './kernel-protocol.js';

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

describe('isProgressEvent', () => {
  it('returns true for a progress frame', () => {
    const frame: ProgressEvent = { type: 'event', event: 'progress', message: 'halfway' };
    assert.equal(isProgressEvent(frame), true);
  });

  it('returns false for ready and data_load and result frames', () => {
    const ready: ReadyEvent = { type: 'event', event: 'ready' };
    const dl: DataLoadEvent = {
      type: 'event',
      event: 'data_load',
      drawer: {
        kind: 'data_load', collector: 'file', uri: 'file:///x', bytes: 1,
        rows_loaded: null, loaded_at: '2026-05-31T00:00:00.000Z', schema: null,
      },
    };
    const res: ResultOk = { id: 1, type: 'result', ok: true, value: 0, stdout: '' };
    assert.equal(isProgressEvent(ready), false);
    assert.equal(isProgressEvent(dl), false);
    assert.equal(isProgressEvent(res), false);
  });
});
