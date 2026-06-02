// packages/coworker-memory/src/memory-recorder.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LocalSqliteBackend } from './local-sqlite-backend.js';
import { MemoryRecorder } from './memory-recorder.js';

async function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-'));
  const audit = new AuditLog({ path: join(dir, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const backend = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
  await backend.open();
  return { dir, audit, scanner, backend };
}

describe('MemoryRecorder', () => {
  it('recordTurn writes kind:turn drawer for short text', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => null,
    });
    await recorder.recordTurn({ sessionId: 's', userText: 'hi', turnId: 't1' });
    const wings = await c.backend.listWings();
    assert.deepEqual(wings, ['global']);
    const rooms = await c.backend.listRooms('global');
    assert.deepEqual(rooms, ['inbox']);
    await c.backend.close();
  });
  it('recordTurn writes kind:paste drawer for long text', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => 'p1',
    });
    // Use whitespace-separated tokens so FTS5 can index/match (single huge token wouldn't match 'x').
    const longText = 'lorem ipsum '.repeat(60); // > 500 chars, tokenizable
    await recorder.recordTurn({ sessionId: 's', userText: longText, turnId: 't1' });
    const r = await c.backend.recall({ query: 'lorem' });
    assert.equal(r[0]!.drawer.kind, 'paste');
    assert.equal(r[0]!.drawer.room, 'p1');
    await c.backend.close();
  });
  it('redacts secret content and sets redacted=true', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => null,
    });
    await recorder.recordPaste({ sessionId: 's', content: 'token AKIAABCDEFGHIJKLMNOP', turnId: 't1' });
    const r = await c.backend.recall({ query: 'token' });
    assert.equal(r[0]!.drawer.redacted, true);
    assert.match(r[0]!.drawer.content, /\[REDACTED:aws_access_key_id\]/);
    const rows: { action: string }[] = [];
    for await (const x of c.audit.read({ producer: 'memory', action: 'redact' })) rows.push(x as never);
    assert.equal(rows.length, 1);
    await c.backend.close();
  });
  it('recordFileLoad stores structured JSON in content', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => 'p1',
    });
    await recorder.recordFileLoad({
      scratchpadName: 'p1', collector: 'file', uri: 'file:///x.csv',
      bytes: 1000, rows_loaded: 50, schema: { cols: ['a','b'] }, turnId: 't1',
    });
    const r = await c.backend.recall({ query: 'file' });
    assert.equal(r[0]!.drawer.kind, 'file_load');
    const parsed = JSON.parse(r[0]!.drawer.content);
    assert.equal(parsed.uri, 'file:///x.csv');
    assert.equal(parsed.rows_loaded, 50);
    await c.backend.close();
  });
});
