import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DefaultCollectorRegistry, uriMatchesPattern } from './collector-registry.js';
import { FileCollector } from './file-collector.js';

describe('uriMatchesPattern', () => {
  it('matches trailing-wildcard prefixes', () => {
    assert.equal(uriMatchesPattern('file:///x/a.csv', 'file://*'), true);
    assert.equal(uriMatchesPattern('http://x/a', 'file://*'), false);
  });
  it('matches exact patterns without a wildcard', () => {
    assert.equal(uriMatchesPattern('mcp://res', 'mcp://res'), true);
    assert.equal(uriMatchesPattern('mcp://other', 'mcp://res'), false);
  });
});

describe('DefaultCollectorRegistry', () => {
  it('registers, lists, and gets collectors by id', () => {
    const reg = new DefaultCollectorRegistry();
    const fc = new FileCollector({ workspace: '/tmp/x' });
    reg.register(fc);
    assert.equal(reg.get('file'), fc);
    assert.equal(reg.get('nope'), null);
    assert.deepEqual(reg.list().map((c) => c.id), ['file']);
  });

  describe('resolve()', () => {
    let workspace: string;
    let inputs: string;

    beforeEach(async () => {
      workspace = await mkdtemp(join(tmpdir(), 'reg-ws-'));
      inputs = join(workspace, '.otto', 'inputs');
      await mkdir(inputs, { recursive: true });
    });
    afterEach(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it('resolves a known file:// uri to its collector + ref', async () => {
      await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n');
      const reg = new DefaultCollectorRegistry();
      reg.register(new FileCollector({ workspace }));
      const uri = pathToFileURL(join(inputs, 'cmdb.csv')).href;
      const hit = await reg.resolve(uri);
      assert.ok(hit);
      assert.equal(hit.collector.id, 'file');
      assert.equal(hit.ref.uri, uri);
      assert.equal(hit.ref.kind, 'csv');
    });

    it('returns null for an unknown file under a matching collector', async () => {
      const reg = new DefaultCollectorRegistry();
      reg.register(new FileCollector({ workspace }));
      const missing = pathToFileURL(join(inputs, 'absent.csv')).href;
      assert.equal(await reg.resolve(missing), null);
    });

    it('returns null when no collector matches the uri scheme', async () => {
      const reg = new DefaultCollectorRegistry();
      reg.register(new FileCollector({ workspace }));
      assert.equal(await reg.resolve('http://example.com/x.csv'), null);
    });
  });
});
