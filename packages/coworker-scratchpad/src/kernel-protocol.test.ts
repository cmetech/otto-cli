import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDataLoadEvent, isProgressEvent, isStartupErrorEvent, isSnapshotResult } from './kernel-protocol.js';
import type { DataLoadEvent, ProgressEvent, ReadyEvent, ResultOk, KernelFrame } from './kernel-protocol.js';

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

describe('kernel-protocol type guards (1d2 additions)', () => {
  it('isStartupErrorEvent recognises the startup_error event', () => {
    const f: KernelFrame = {
      type: 'event',
      event: 'startup_error',
      kind: 'duckdb_open',
      error: { name: 'Error', message: 'cannot open db' },
    };
    assert.equal(isStartupErrorEvent(f), true);
    assert.equal(isDataLoadEvent(f), false);
    assert.equal(isProgressEvent(f), false);
  });

  it('isSnapshotResult recognises a successful snapshot_result', () => {
    const f: KernelFrame = {
      id: 1,
      type: 'snapshot_result',
      ok: true,
      skipped: [],
      snapshotted_at: '2026-05-31T00:00:00.000Z',
    };
    assert.equal(isSnapshotResult(f), true);
  });

  it('isSnapshotResult recognises a failed snapshot_result', () => {
    const f: KernelFrame = {
      id: 1,
      type: 'snapshot_result',
      ok: false,
      error: { name: 'Error', message: 'disk full' },
    };
    assert.equal(isSnapshotResult(f), true);
  });

  it('a ready event may carry recovery_notes', () => {
    const f: KernelFrame = {
      type: 'event',
      event: 'ready',
      recovery_notes: [{ kind: 'namespace-absent' }],
    };
    assert.equal(f.type, 'event');
    if (f.type === 'event' && f.event === 'ready') {
      assert.equal(f.recovery_notes?.[0]?.kind, 'namespace-absent');
    }
  });
});
