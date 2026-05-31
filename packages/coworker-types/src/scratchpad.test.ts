import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  DataSourceRef, DataSource, CollectorCapabilities,
  Collector, CollectorRegistry, Unsubscribe,
} from './scratchpad.js';

describe('scratchpad/collector types', () => {
  it('DataSourceRef has collector id + uri + kind + metadata', () => {
    const ref: DataSourceRef = {
      collector: 'file',
      uri: 'file:///workspace/inputs/cmdb.csv',
      kind: 'csv',
      bytes: 1024,
      modified: '2026-05-31T10:00:00Z',
      metadata: {},
    };
    assert.equal(ref.collector, 'file');
  });

  it('CollectorCapabilities advertises supports_uris and supports_kinds', () => {
    const caps: CollectorCapabilities = {
      supports_uris: ['file://*'],
      supports_kinds: ['csv', 'xlsx'],
      supports_streaming: true,
      supports_watching: true,
    };
    assert.equal(caps.supports_streaming, true);
  });

  it('Collector interface has describe + list + open + optional watch', () => {
    const _check: keyof Collector = 'describe';
    const _required: Array<keyof Collector> = ['id', 'kind', 'describe', 'list', 'open'];
    assert.equal(_required.length, 5);
  });

  it('CollectorRegistry has register/list/get/resolve', () => {
    const _methods: Array<keyof CollectorRegistry> = ['register', 'list', 'get', 'resolve'];
    assert.equal(_methods.length, 4);
  });

  it('Unsubscribe is a void-returning function', () => {
    const u: Unsubscribe = () => undefined;
    assert.equal(typeof u, 'function');
  });
});
