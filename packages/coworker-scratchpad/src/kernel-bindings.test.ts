import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, type AuditRecord } from '@otto/coworker-utils';
import { buildDataLibBindings, redactForJournal } from './kernel-bindings.js';
import { ChildProcessRuntime } from './child-process-runtime.js';

describe('kernel-bindings', () => {
  it('exposes all seven pre-bound data libraries', () => {
    const b = buildDataLibBindings();
    for (const key of ['polars', 'DuckDB', 'XLSX', 'dateFns', 'lodash', 'zod', 'axios']) {
      assert.ok(key in b, `missing binding: ${key}`);
      assert.notEqual(b[key], undefined, `binding is undefined: ${key}`);
    }
  });

  it('binds usable shapes (polars.DataFrame, zod.string, dateFns.format)', () => {
    const b = buildDataLibBindings() as Record<string, any>;
    assert.equal(typeof b.polars.DataFrame, 'function');
    assert.equal(typeof b.zod.string, 'function');
    assert.equal(typeof b.dateFns.format, 'function');
    assert.equal(typeof b.lodash.chunk, 'function');
    assert.equal(typeof b.axios.get, 'function');
    assert.equal(typeof b.XLSX.utils.book_new, 'function');
  });
});

describe('otto.duckdb.registerDf (Task F)', () => {
  let ws: string;
  let sp: string;
  let rt: ChildProcessRuntime | undefined;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'kb-registerdf-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    sp = await mkdtemp(join(tmpdir(), 'kb-registerdf-sp-'));
    rt = new ChildProcessRuntime({
      workspace: ws,
      scratchpadDir: sp,
      cellTimeoutMs: 30_000,
      inactivityTimeoutMs: 30_000,
    });
    await rt.start();
  });

  afterEach(async () => {
    await rt?.dispose();
    rt = undefined;
    await rm(ws, { recursive: true, force: true });
    await rm(sp, { recursive: true, force: true });
  });

  const runCell = async (code: string): Promise<unknown> => {
    const { value } = await rt!.runCell(code);
    return value;
  };

  it('round-trips an array of records', async () => {
    const result = (await runCell(`
      await otto.duckdb.registerDf('rec', [{a: 1, b: 'x'}, {a: 2, b: 'y'}]);
      const c = await otto.duckdb.connect();
      return (await c.runAndReadAll('SELECT SUM(a) FROM rec')).getRows();
    `)) as unknown[][];
    assert.equal(Number(result[0]![0]), 3);
  });

  it('round-trips a polars DataFrame', async () => {
    const result = (await runCell(`
      const df = polars.DataFrame({ a: [1, 2, 3], b: ['x', 'y', 'z'] });
      await otto.duckdb.registerDf('pdf', df);
      const c = await otto.duckdb.connect();
      return (await c.runAndReadAll('SELECT SUM(a) FROM pdf')).getRows();
    `)) as unknown[][];
    assert.equal(Number(result[0]![0]), 6);
  });

  it('throws TypeError for unsupported input', async () => {
    await assert.rejects(
      runCell(`await otto.duckdb.registerDf('bad', 42);`),
      /must be a polars DataFrame, Arrow Table, or array of records/,
    );
  });

  it('opts.schema override skips inference and uses provided types', async () => {
    const result = (await runCell(`
      await otto.duckdb.registerDf(
        'sized',
        [{n: 1}, {n: 2}, {n: 3}],
        { schema: { n: 'BIGINT' } }
      );
      const c = await otto.duckdb.connect();
      const desc = await c.runAndReadAll('DESCRIBE sized');
      return desc.getRows();
    `)) as unknown[][];
    assert.equal(result[0]![0], 'n');
    assert.equal(String(result[0]![1]).toUpperCase(), 'BIGINT');
  });

  it('null-walk inference picks the first non-null value type', async () => {
    const result = (await runCell(`
      const rows = Array(8).fill({ rev: null }).concat([{ rev: 1200 }, { rev: 980 }]);
      await otto.duckdb.registerDf('rev', rows);
      const c = await otto.duckdb.connect();
      const desc = await c.runAndReadAll('DESCRIBE rev');
      return desc.getRows();
    `)) as unknown[][];
    assert.equal(result[0]![0], 'rev');
    assert.equal(String(result[0]![1]).toUpperCase(), 'DOUBLE');
  });

  it('partial-failure leaves no table behind (all-or-nothing) and names failing column', async () => {
    // First call: BIGINT schema with a non-coercible string value in row 11 → append fails mid-batch.
    // The all-or-nothing semantic should DROP the partially-populated table so the
    // retry below with the same name + clean data succeeds without "Table already exists."
    await assert.rejects(
      runCell(`
        const rows = [];
        for (let i = 0; i < 11; i++) rows.push({ n: i });
        rows.push({ n: 'not-a-number' });
        await otto.duckdb.registerDf('aon', rows, { schema: { n: 'BIGINT' } });
      `),
      /registerDf row 11: append failed for column 'n'/,
    );
    const result = (await runCell(`
      await otto.duckdb.registerDf('aon', [{n: 7}, {n: 8}], { schema: { n: 'BIGINT' } });
      const c = await otto.duckdb.connect();
      // Cast to DOUBLE so the value survives JSON serialization across the
      // child-process boundary (BIGINT sums become BigInt and JSON-stringify-throw).
      return (await c.runAndReadAll('SELECT CAST(SUM(n) AS DOUBLE) FROM aon')).getRows();
    `)) as unknown[][];
    // Sum of clean retry batch — proves both that the first-call table was DROPped
    // (otherwise CREATE TABLE here would fail) and that the retry persisted rows.
    assert.equal(Number(result[0]![0]), 15);
  });
});

describe('kernel-bindings — secret redaction (Phase 2 Task 14)', () => {
  it('redacts secret patterns in stdout before journaling and emits one audit record per hit', async () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), 'kb-audit-')), 'audit.jsonl');
    const audit = new AuditLog({ path: auditPath });
    // AKIA + 16 [A-Z0-9] chars — matches the aws_access_key_id pattern.
    const raw = 'before AKIAABCDEFGHIJKLMNOP after';
    const result = redactForJournal(raw, {
      audit,
      sessionId: 's',
      scratchpadName: 'sp',
      pid: 1,
      cellId: 'c1',
    });
    assert.equal(result, 'before [REDACTED:aws_access_key_id] after');
    const records: AuditRecord[] = [];
    for await (const r of audit.read({ producer: 'secret-scanner' })) records.push(r);
    assert.equal(records.length, 1);
    const rec = records[0]!;
    assert.equal(rec.action, 'redact');
    assert.equal(rec.severity, 'warn');
    assert.equal(rec.scratchpadName, 'sp');
    assert.equal(rec.sessionId, 's');
    assert.equal(rec.pid, 1);
    // Detail must carry kind/offset/length/cell_id and NOT include the secret value or preview.
    assert.equal(rec.detail.kind, 'aws_access_key_id');
    assert.equal(rec.detail.cell_id, 'c1');
    assert.equal(rec.detail.offset, 'before '.length);
    assert.equal(rec.detail.length, 'AKIAABCDEFGHIJKLMNOP'.length);
    assert.equal('preview' in rec.detail, false);
    // Defense-in-depth: the serialized record must not contain the raw secret substring.
    assert.equal(JSON.stringify(rec).includes('AKIAABCDEFGHIJKLMNOP'), false);
  });

  it('returns input unchanged when no secrets present and writes no audit record', async () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), 'kb-audit-clean-')), 'audit.jsonl');
    const audit = new AuditLog({ path: auditPath });
    const out = redactForJournal('hello world', {
      audit,
      sessionId: 's',
      scratchpadName: 'sp',
      pid: 1,
      cellId: 'c1',
    });
    assert.equal(out, 'hello world');
    const records: AuditRecord[] = [];
    for await (const r of audit.read({ producer: 'secret-scanner' })) records.push(r);
    assert.equal(records.length, 0);
  });
});
