// packages/coworker-memory/src/local-sqlite-backend.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSqliteBackend } from './local-sqlite-backend.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'lb-')); }

describe('LocalSqliteBackend', () => {
  it('bootstraps schema and is ready', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    const st = await be.status();
    assert.equal(st.ready, true);
    assert.equal(st.drawer_count, 0);
    assert.equal(st.schema_version, 2);
    await be.close();
  });
  it('retain + recall round-trip; result includes snippet with <mark>', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'global', room: 'inbox', kind: 'paste',
      content: 'customer said the load balancer started returning 503s around 14:00 UTC',
      metadata: {}, redacted: false });
    const results = await be.recall({ query: 'load balancer' });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.drawer.kind, 'paste');
    assert.match(results[0]!.snippet, /<mark>load<\/mark>/);
    assert.ok(results[0]!.score > 0);
    await be.close();
  });
  it('filters by wing, room, kind, days_back', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'a', room: 'r1', kind: 'turn', content: 'red apples', metadata: {}, redacted: false });
    await be.retain({ wing: 'b', room: 'r2', kind: 'paste', content: 'red apples', metadata: {}, redacted: false });
    const filteredWing = await be.recall({ query: 'apples', wing: 'a' });
    assert.equal(filteredWing.length, 1);
    assert.equal(filteredWing[0]!.drawer.wing, 'a');
    const filteredKind = await be.recall({ query: 'apples', kind: 'paste' });
    assert.equal(filteredKind.length, 1);
    assert.equal(filteredKind[0]!.drawer.kind, 'paste');
    await be.close();
  });
  it('escapes FTS5 special characters in query', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'g', room: 'r', kind: 'note', content: 'CIDR is 10.0.0.0/24', metadata: {}, redacted: false });
    const r = await be.recall({ query: '10.0.0.0/24 "AND" *' });   // would otherwise blow up
    assert.equal(r.length, 1);
    await be.close();
  });
  it('listWings + listRooms reflect inserted data', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'w1', room: 'r1', kind: 'turn', content: 'a', metadata: {}, redacted: false });
    await be.retain({ wing: 'w2', room: 'r2', kind: 'turn', content: 'b', metadata: {}, redacted: false });
    assert.deepEqual((await be.listWings()).sort(), ['w1', 'w2']);
    assert.deepEqual(await be.listRooms('w1'), ['r1']);
    await be.close();
  });
  it('clear({wing}) deletes only that wing\'s drawers', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'w1', room: 'r1', kind: 'turn', content: 'a', metadata: {}, redacted: false });
    await be.retain({ wing: 'w2', room: 'r2', kind: 'turn', content: 'b', metadata: {}, redacted: false });
    const out = await be.clear({ wing: 'w1', confirm: true });
    assert.equal(out.deleted, 1);
    assert.deepEqual(await be.listWings(), ['w2']);
    await be.close();
  });
  it('retain preserves redacted flag', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    const d = await be.retain({ wing: 'g', room: 'r', kind: 'paste', content: 'x [REDACTED:aws_access_key_id] y', metadata: {}, redacted: true });
    assert.equal(d.redacted, true);
    const r = await be.recall({ query: 'REDACTED' });
    assert.equal(r[0]!.drawer.redacted, true);
    await be.close();
  });
});

describe('Local backend migrations (Phase 4 Task 8)', () => {
  it('migration 002 lets us insert kind:artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-mig-'));
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    const st = await be.status();
    assert.equal(st.schema_version, 2);
    const drawer = await be.retain({
      wing: 'g', room: 'r', kind: 'artifact',
      content: JSON.stringify({ slug: 'rca-1', kind: 'report', uri: 'artifact://rca-1' }),
      metadata: { scratchpad: 'p1' }, redacted: false,
    });
    assert.equal(drawer.kind, 'artifact');
    const r = await be.recall({ query: 'rca', kind: 'artifact' });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.drawer.kind, 'artifact');
    await be.close();
  });
});
