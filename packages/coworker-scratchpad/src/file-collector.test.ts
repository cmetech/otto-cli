import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileCollector } from './file-collector.js';

let workspace: string;
let inputs: string;

async function collectRefs(it: AsyncIterable<{ uri: string; kind: string; bytes?: number; metadata: unknown }>) {
  const out = [];
  for await (const ref of it) out.push(ref);
  return out;
}

describe('FileCollector', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'fc-ws-'));
    inputs = join(workspace, '.otto', 'inputs');
    await mkdir(inputs, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('describe() advertises file:// support, the six kinds, watching, no streaming', () => {
    const fc = new FileCollector({ workspace });
    const cap = fc.describe();
    assert.deepEqual(cap.supports_uris, ['file://*']);
    assert.deepEqual([...cap.supports_kinds].sort(), ['csv', 'json', 'md', 'parquet', 'txt', 'xlsx']);
    assert.equal(cap.supports_streaming, false);
    assert.equal(cap.supports_watching, true);
  });

  it('list() yields refs only for supported files, recursively, skipping unsupported', async () => {
    await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n1,2\n');
    await writeFile(join(inputs, 'notes.txt'), 'hi');
    await writeFile(join(inputs, 'ignore.pdf'), 'x');
    await mkdir(join(inputs, 'nested'), { recursive: true });
    await writeFile(join(inputs, 'nested', 'data.json'), '{"k":1}');

    const fc = new FileCollector({ workspace });
    const refs = await collectRefs(fc.list());
    const byKind = Object.fromEntries(refs.map((r) => [r.kind, r]));

    assert.deepEqual(Object.keys(byKind).sort(), ['csv', 'json', 'txt']);
    assert.equal(byKind.csv.collector, 'file');
    assert.equal(byKind.csv.uri, pathToFileURL(join(inputs, 'cmdb.csv')).href);
    assert.equal(byKind.csv.bytes, 8);
    assert.deepEqual(byKind.csv.metadata, {});
    assert.equal(typeof byKind.csv.modified, 'string');
  });

  it('list() honors the limit option', async () => {
    await writeFile(join(inputs, 'a.csv'), 'x');
    await writeFile(join(inputs, 'b.csv'), 'x');
    await writeFile(join(inputs, 'c.csv'), 'x');
    const fc = new FileCollector({ workspace });
    const refs = await collectRefs(fc.list({ limit: 2 }));
    assert.equal(refs.length, 2);
  });

  it('list() yields nothing when the inputs dir does not exist', async () => {
    await rm(inputs, { recursive: true, force: true });
    const fc = new FileCollector({ workspace });
    const refs = await collectRefs(fc.list());
    assert.deepEqual(refs, []);
  });

  it('open().load() parses JSON, returns text as string, and binary as Buffer', async () => {
    await writeFile(join(inputs, 'd.json'), '{"hello":"world"}');
    await writeFile(join(inputs, 'd.csv'), 'a,b\n1,2\n');
    await writeFile(join(inputs, 'd.parquet'), Buffer.from([0x50, 0x41, 0x52, 0x31]));
    const fc = new FileCollector({ workspace });

    const byKind = Object.fromEntries((await collectRefs(fc.list())).map((r) => [r.kind, r]));

    const json = await (await fc.open(byKind.json as never)).load();
    assert.deepEqual(json, { hello: 'world' });

    const csv = await (await fc.open(byKind.csv as never)).load();
    assert.equal(csv, 'a,b\n1,2\n');

    const parquet = await (await fc.open(byKind.parquet as never)).load();
    assert.ok(Buffer.isBuffer(parquet));
    assert.deepEqual(parquet, Buffer.from([0x50, 0x41, 0x52, 0x31]));
  });

  it('watch() invokes onChange when the file is modified and unsubscribe stops it', async () => {
    const file = join(inputs, 'live.csv');
    await writeFile(file, 'v1');
    const fc = new FileCollector({ workspace });
    const ref = (await collectRefs(fc.list()))[0];

    const changed = new Promise<void>((resolve) => {
      const unsub = fc.watch(ref as never, () => {
        unsub();
        resolve();
      });
      // Give chokidar a moment to register before mutating.
      setTimeout(() => void writeFile(file, 'v2-longer'), 300);
    });

    await changed; // test times out (and fails) if onChange never fires
  });
});
