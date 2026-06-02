import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, type AuditRecord } from './audit-log.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'audit-')); }

describe('AuditLog', () => {
  it('appends a record as one JSONL line', () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    const rec: AuditRecord = {
      _schema: 1, ts: '2026-06-01T00:00:00.000Z',
      producer: 'vault', action: 'set', detail: { engine: 'jira', name: 'prod' },
    };
    log.append(rec);
    const text = readFileSync(join(dir, 'audit.jsonl'), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(text.trim());
    assert.deepEqual(parsed, rec);
  });

  it('reads records back, newest first, with filters', async () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault', action: 'set', detail: {} });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'secret-scanner', action: 'redact', severity: 'warn', detail: {} });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:02.000Z', producer: 'vault', action: 'get', detail: {} });
    const all: AuditRecord[] = [];
    for await (const r of log.read({})) all.push(r);
    assert.deepEqual(all.map(r => r.action), ['get', 'redact', 'set']);
    const vaultOnly: AuditRecord[] = [];
    for await (const r of log.read({ producer: 'vault' })) vaultOnly.push(r);
    assert.deepEqual(vaultOnly.map(r => r.action), ['get', 'set']);
  });

  it('rotates at maxBytes threshold', () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl'), maxBytes: 200 });
    const big = 'x'.repeat(60);
    for (let i = 0; i < 5; i++) {
      log.append({ _schema: 1, ts: `2026-06-01T00:00:0${i}.000Z`, producer: 'vault', action: 'set', detail: { pad: big } });
    }
    assert.equal(existsSync(join(dir, 'audit.1.jsonl')), true);
    assert.ok(statSync(join(dir, 'audit.jsonl')).size < 200);
  });

  it('keeps at most 5 rotated tails', () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl'), maxBytes: 100, maxTails: 5 });
    const pad = 'x'.repeat(40);
    for (let i = 0; i < 50; i++) {
      log.append({ _schema: 1, ts: `2026-06-01T00:00:${String(i).padStart(2,'0')}.000Z`, producer: 'vault', action: 'set', detail: { pad } });
    }
    for (let n = 1; n <= 5; n++) assert.equal(existsSync(join(dir, `audit.${n}.jsonl`)), true);
    assert.equal(existsSync(join(dir, 'audit.6.jsonl')), false);
  });

  it('filters by since (inclusive lower bound)', async () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    const t0 = '2026-06-01T00:00:00.000Z';
    const t1 = '2026-06-01T00:00:01.000Z';
    const t2 = '2026-06-01T00:00:02.000Z';
    log.append({ _schema: 1, ts: t0, producer: 'vault', action: 'set', detail: {} });
    log.append({ _schema: 1, ts: t1, producer: 'vault', action: 'set', detail: {} });
    log.append({ _schema: 1, ts: t2, producer: 'vault', action: 'set', detail: {} });
    const got: AuditRecord[] = [];
    for await (const r of log.read({ since: t1 })) got.push(r);
    assert.deepEqual(got.map(r => r.ts), [t2, t1]);
  });

  it('filters by severity', async () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault', action: 'set', severity: 'info', detail: {} });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'vault', action: 'set', severity: 'warn', detail: {} });
    const got: AuditRecord[] = [];
    for await (const r of log.read({ severity: 'warn' })) got.push(r);
    assert.equal(got.length, 1);
    assert.equal(got[0].severity, 'warn');
  });

  it('filters by engineId via detail.engine', async () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault', action: 'set', detail: { engine: 'jira' } });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'vault', action: 'set', detail: { engine: 'datadog' } });
    const got: AuditRecord[] = [];
    for await (const r of log.read({ engineId: 'jira' })) got.push(r);
    assert.equal(got.length, 1);
    assert.equal((got[0].detail as { engine?: string }).engine, 'jira');
  });

  it('silently skips malformed lines', async () => {
    const dir = tmp();
    const path = join(dir, 'audit.jsonl');
    const log = new AuditLog({ path });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault', action: 'set', detail: { tag: 'first' } });
    appendFileSync(path, '{bad json\n', { mode: 0o600 });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'vault', action: 'set', detail: { tag: 'second' } });
    const got: AuditRecord[] = [];
    for await (const r of log.read({})) got.push(r);
    assert.equal(got.length, 2);
    assert.deepEqual(got.map(r => (r.detail as { tag: string }).tag), ['second', 'first']);
  });

  it('reads records from rotated tail files alongside current file', async () => {
    const dir = tmp();
    const path = join(dir, 'audit.jsonl');
    const log = new AuditLog({ path, maxBytes: 200 });
    const pad = 'x'.repeat(60);
    // Write enough records to force at least one rotation.
    for (let i = 0; i < 8; i++) {
      log.append({
        _schema: 1,
        ts: `2026-06-01T00:00:0${i}.000Z`,
        producer: 'vault',
        action: 'set',
        detail: { idx: i, pad },
      });
    }
    // Confirm rotation actually happened (records exist in both files).
    assert.equal(existsSync(join(dir, 'audit.1.jsonl')), true);
    const currentLines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const tailLines = readFileSync(join(dir, 'audit.1.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.ok(currentLines.length > 0, 'current file should have records');
    assert.ok(tailLines.length > 0, 'rotated tail should have records');

    const got: AuditRecord[] = [];
    for await (const r of log.read({})) got.push(r);
    // All 8 appended records must come back, newest first.
    assert.equal(got.length, 8);
    const indices = got.map(r => (r.detail as { idx: number }).idx);
    assert.deepEqual(indices, [7, 6, 5, 4, 3, 2, 1, 0]);
  });
});
