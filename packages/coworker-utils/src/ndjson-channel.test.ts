import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { writeNdjson, readNdjson } from './ndjson-channel.js';

function makeReader(chunks: string[]): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i >= chunks.length) { this.push(null); return; }
      this.push(chunks[i++], 'utf8');
    },
  });
}

function makeWriter(): { stream: Writable; written: () => string } {
  const buf: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { buf.push(chunk.toString('utf8')); cb(); },
  });
  return { stream, written: () => buf.join('') };
}

describe('ndjson channel', () => {
  it('writes one object per line with \\n terminator', async () => {
    const { stream, written } = makeWriter();
    await writeNdjson(stream, { type: 'ready' });
    await writeNdjson(stream, { type: 'exec', cell_id: 'c1' });
    assert.equal(written(), '{"type":"ready"}\n{"type":"exec","cell_id":"c1"}\n');
  });

  it('reads one object per yielded value', async () => {
    const reader = makeReader([
      '{"type":"ready"}\n{"type":"result","cell_id":"c1"}\n',
    ]);
    const got: Array<Record<string, unknown>> = [];
    for await (const msg of readNdjson(reader)) {
      got.push(msg as Record<string, unknown>);
    }
    assert.equal(got.length, 2);
    assert.equal(got[0].type, 'ready');
    assert.equal(got[1].type, 'result');
  });

  it('handles JSON object split across read chunks', async () => {
    const reader = makeReader([
      '{"type":"re',
      'ady","extra":"long string"}\n',
    ]);
    const got: Array<Record<string, unknown>> = [];
    for await (const msg of readNdjson(reader)) {
      got.push(msg as Record<string, unknown>);
    }
    assert.equal(got.length, 1);
    assert.equal(got[0].type, 'ready');
    assert.equal(got[0].extra, 'long string');
  });

  it('skips empty lines silently', async () => {
    const reader = makeReader(['\n\n{"a":1}\n\n{"b":2}\n']);
    const got: Array<Record<string, unknown>> = [];
    for await (const msg of readNdjson(reader)) {
      got.push(msg as Record<string, unknown>);
    }
    assert.equal(got.length, 2);
    assert.equal(got[0].a, 1);
    assert.equal(got[1].b, 2);
  });

  it('throws on malformed JSON with line number', async () => {
    const reader = makeReader(['{"ok":1}\n{not json\n']);
    await assert.rejects(async () => {
      for await (const _ of readNdjson(reader)) { /* drain */ }
    }, /line 2/);
  });
});
