// packages/coworker-artifacts/src/artifact-store.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from './artifact-store.js';
import { ArtifactKindRejected, ArtifactNotFound, ArtifactSlugCollision } from './errors.js';

function tmpWs(): string {
  return mkdtempSync(join(tmpdir(), 'art-store-'));
}

function fixedNow(): () => string {
  let n = Date.parse('2026-06-02T14:00:00Z');
  return () => {
    const v = new Date(n).toISOString();
    n += 60_000;
    return v;
  };
}

describe('ArtifactStore.create', () => {
  it('creates dir + metadata + empty primary + initial provenance + README', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'RCA: load balancer 503');
    assert.equal(h.slug, 'rca-load-balancer-503');
    assert.equal(h.kind, 'report');
    assert.equal(h.uri, 'artifact://rca-load-balancer-503');
    assert.ok(existsSync(h.dir));
    assert.ok(existsSync(h.primaryPath));
    assert.ok(existsSync(h.metadataPath));
    assert.ok(existsSync(h.provenancePath));
    assert.ok(existsSync(h.readmePath));
    const meta = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    assert.equal(meta._schema, 1);
    assert.equal(meta.slug, 'rca-load-balancer-503');
    assert.equal(meta.kind, 'report');
    assert.equal(meta.primary_file, 'report.md');
    assert.equal(meta.turn_count, 0);
  });
  it('rejects non-report kind', async () => {
    const store = new ArtifactStore({ workspaceDir: tmpWs() });
    await assert.rejects(() => store.create('workbook' as never, 'x'), ArtifactKindRejected);
  });
  it('suffixes slug on collision', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const a = await store.create('report', 'RCA');
    const b = await store.create('report', 'RCA');
    const c = await store.create('report', 'RCA');
    assert.equal(a.slug, 'rca');
    assert.equal(b.slug, 'rca-2');
    assert.equal(c.slug, 'rca-3');
  });
  it('throws ArtifactSlugCollision after exhausting suffixes', async () => {
    const ws = tmpWs();
    mkdirSync(join(ws, '.otto', 'artifacts'), { recursive: true });
    mkdirSync(join(ws, '.otto', 'artifacts', 'rca'));
    for (let n = 2; n <= 101; n++) mkdirSync(join(ws, '.otto', 'artifacts', `rca-${n}`));
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    await assert.rejects(() => store.create('report', 'RCA'), ArtifactSlugCollision);
  });
  it('writes files at mode 0o600 and dir at 0o700', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'sec');
    const dirStat = statSync(h.dir);
    const fileStat = statSync(h.metadataPath);
    assert.equal((dirStat.mode & 0o777), 0o700);
    assert.equal((fileStat.mode & 0o777), 0o600);
  });
});

describe('ArtifactStore.update', () => {
  it('writes files atomically; returns files_touched', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    const out = await store.update(h, [{ path: 'report.md', content: '# hi\n' }]);
    assert.deepEqual(out.files_touched.sort(), ['report.md']);
    assert.equal(readFileSync(h.primaryPath, 'utf8'), '# hi\n');
  });
  it('rejects FileWrite path with .. or /', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await assert.rejects(() => store.update(h, [{ path: '../escape', content: 'x' }]));
    await assert.rejects(() => store.update(h, [{ path: '/abs', content: 'x' }]));
  });
  it('detects added + modified files via DirSnapshot diff', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await store.update(h, [{ path: 'report.md', content: '# v1\n' }]);
    await new Promise(r => setTimeout(r, 20));
    const out = await store.update(h, [
      { path: 'report.md', content: '# v2\n' },
      { path: 'appendix.md', content: '## A\n' },
    ]);
    assert.deepEqual(out.files_touched.sort(), ['appendix.md', 'report.md']);
  });
  it('bumps last_updated_at + turn_count when paired with recordTurn', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    const meta1 = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    await store.recordTurn(h, {
      action: 'create', turn_id: 't1', user_prompt: 'p1', files_touched: [],
    });
    const meta2 = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    assert.equal(meta2.turn_count, 1);
    assert.notEqual(meta1.last_updated_at, meta2.last_updated_at);
  });
});

describe('ArtifactStore.recordTurn', () => {
  it('appends to provenance.json', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await store.recordTurn(h, {
      action: 'create', turn_id: 't1', user_prompt: 'p1', files_touched: [],
    });
    await store.recordTurn(h, {
      action: 'update', turn_id: 't2', user_prompt: 'p2', files_touched: ['report.md'],
    });
    const prov = JSON.parse(readFileSync(h.provenancePath, 'utf8'));
    assert.equal(prov.length, 2);
    assert.equal(prov[0].turn_id, 't1');
    assert.equal(prov[1].turn_id, 't2');
  });
});

describe('ArtifactStore.list + get + remove', () => {
  it('list returns all artifact handles, sorted by created_at desc', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const a = await store.create('report', 'a');
    const b = await store.create('report', 'b');
    const list = await store.list();
    assert.equal(list.length, 2);
    // fixedNow increments — b is created after a, so b should be first
    assert.equal(list[0]!.slug, 'b');
    assert.equal(list[1]!.slug, 'a');
  });
  it('get returns handle or null', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    assert.equal((await store.get('r'))!.slug, 'r');
    assert.equal(await store.get('missing'), null);
  });
  it('remove deletes directory; throws ArtifactNotFound if missing', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await store.remove('r', true);
    assert.equal(existsSync(h.dir), false);
    await assert.rejects(() => store.remove('r', true), ArtifactNotFound);
  });
  it('remove rejects when confirm is not true', async () => {
    const store = new ArtifactStore({ workspaceDir: tmpWs() });
    await assert.rejects(() => store.remove('x', false as never));
  });
});
