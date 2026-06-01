import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAMESPACE_SCHEMA_VERSION,
  encodeNamespace,
  decodeNamespace,
} from './namespace-codec.js';

describe('namespace-codec', () => {
  it('round-trips primitives and plain objects', () => {
    const { envelope } = encodeNamespace({ x: 1, s: 'hi', o: { a: [1, 2, 3] } }, () => 0);
    assert.equal(envelope.schema_version, NAMESPACE_SCHEMA_VERSION);
    assert.equal(typeof envelope.snapshot_b64, 'string');
    assert.deepEqual(envelope.skipped, []);
    const { values, skipped } = decodeNamespace(JSON.stringify(envelope));
    assert.equal(values.x, 1);
    assert.equal(values.s, 'hi');
    assert.deepEqual(values.o, { a: [1, 2, 3] });
    assert.deepEqual(skipped, []);
  });

  it('round-trips Date / Map / Set / BigInt with type identity preserved', () => {
    const m = new Map<string, number>([['a', 1], ['b', 2]]);
    const s = new Set<number>([10, 20, 30]);
    const d = new Date(1717180800000);
    const big = 9007199254740993n; // > Number.MAX_SAFE_INTEGER
    const { envelope } = encodeNamespace({ m, s, d, big }, () => 0);
    const { values } = decodeNamespace(JSON.stringify(envelope));
    assert.ok(values.m instanceof Map);
    assert.equal((values.m as Map<string, number>).get('b'), 2);
    assert.ok(values.s instanceof Set);
    assert.equal((values.s as Set<number>).has(20), true);
    assert.ok(values.d instanceof Date);
    assert.equal((values.d as Date).getTime(), 1717180800000);
    assert.equal(values.big, 9007199254740993n);
  });

  it('records non-serializable values in skipped[] without aborting', () => {
    // A function is not v8-serializable.
    const fn = (): number => 1;
    const { envelope, skipped } = encodeNamespace({ ok: 1, badFn: fn }, () => 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].key, 'badFn');
    assert.equal(skipped[0].ctor, 'Function');
    assert.match(skipped[0].reason, /./); // non-empty reason
    assert.equal(envelope.skipped.length, 1);
    assert.equal(envelope.skipped[0].key, 'badFn');
    assert.equal(envelope.skipped[0].ctor, 'Function');
    const { values } = decodeNamespace(JSON.stringify(envelope));
    assert.equal(values.ok, 1);
    assert.equal('badFn' in values, false);
  });

  it('encodes ts from the injected clock', () => {
    const { envelope } = encodeNamespace({ x: 1 }, () => 1717180800000);
    assert.equal(envelope.ts, new Date(1717180800000).toISOString());
  });

  it('decodeNamespace throws on a wrong schema_version', () => {
    const bad = JSON.stringify({ schema_version: 99, snapshot_b64: 'AAAA', skipped: [], ts: '...' });
    assert.throws(() => decodeNamespace(bad), /schema_version/);
  });

  it('decodeNamespace throws on a malformed envelope (not JSON)', () => {
    assert.throws(() => decodeNamespace('{not json'), /./);
  });

  it('decodeNamespace throws on a base64 payload that is not a valid v8 buffer', () => {
    const bad = JSON.stringify({
      schema_version: NAMESPACE_SCHEMA_VERSION,
      snapshot_b64: Buffer.from('not-a-v8-buffer').toString('base64'),
      skipped: [],
      ts: '2026-05-31T00:00:00.000Z',
    });
    assert.throws(() => decodeNamespace(bad), /./);
  });

  it('demotes survivors to skipped[] when bulk serialize throws (defensive — never throws)', () => {
    // A getter that throws only on its second invocation: passes the per-key probe,
    // explodes on the final bulk serialize. The codec must demote all survivors and
    // return cleanly rather than letting the exception propagate.
    const evilObj: Record<string, unknown> = {};
    let calls = 0;
    Object.defineProperty(evilObj, 'x', {
      enumerable: true,
      configurable: true,
      get() {
        calls++;
        if (calls > 1) throw new Error('second-call boom');
        return 1;
      },
    });
    const result = encodeNamespace({ evil: evilObj, plain: 42 }, () => 0);
    assert.ok(result.skipped.length >= 1);
    assert.ok(result.skipped.some((s) => s.reason.startsWith('bulk-serialize-failed')));
    // The envelope is still well-formed — empty snapshot, well-typed.
    assert.equal(typeof result.envelope.snapshot_b64, 'string');
    const { values } = decodeNamespace(JSON.stringify(result.envelope));
    assert.equal('evil' in values, false);
    assert.equal('plain' in values, false); // demoted alongside in the bulk fallback
  });
});
