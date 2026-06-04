import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { AuditLog } from '@otto/coworker-utils';
import { CredentialInjector, LocalDataVault } from '@otto/coworker-vault';
import { ChildProcessRuntime } from './child-process-runtime.js';
import type { DataLoadDrawer } from './kernel-protocol.js';
import { encodeNamespace } from './namespace-codec.js';

let workspace: string;
let inputs: string;
let runtime: ChildProcessRuntime;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('ChildProcessRuntime', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'cpr-ws-'));
    inputs = join(workspace, '.otto', 'inputs');
    await mkdir(inputs, { recursive: true });
  });

  afterEach(async () => {
    await runtime?.dispose();
    await rm(workspace, { recursive: true, force: true });
  });

  it('runs a cell and returns value + stdout after start()', async () => {
    runtime = new ChildProcessRuntime({ workspace });
    await runtime.start();
    const { value, stdout } = await runtime.runCell("console.log('hello'); return 6 * 7;");
    assert.equal(value, 42);
    assert.equal(stdout, 'hello');
  });

  it('rejects with the cell error message when a cell throws', async () => {
    runtime = new ChildProcessRuntime({ workspace });
    await runtime.start();
    await assert.rejects(() => runtime.runCell("throw new Error('kaboom');"), /kaboom/);
  });

  it('forwards a data_load drawer to onDataLoad when a cell loads via a collector', async () => {
    await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n1,2\n');
    const uri = pathToFileURL(join(inputs, 'cmdb.csv')).href;
    const drawers: DataLoadDrawer[] = [];
    runtime = new ChildProcessRuntime({ workspace, onDataLoad: (d) => drawers.push(d) });
    await runtime.start();

    const { value } = await runtime.runCell(
      `return await (await otto.collectors.open(${JSON.stringify(uri)})).load();`,
    );
    assert.equal(value, 'a,b\n1,2\n');

    await delay(50);
    assert.equal(drawers.length, 1);
    assert.equal(drawers[0].kind, 'data_load');
    assert.equal(drawers[0].collector, 'file');
    assert.equal(drawers[0].uri, uri);
    assert.equal(drawers[0].bytes, 8);
    assert.equal(drawers[0].schema, null);
  });

  it('times out a hung cell on the total wall-clock cap and rejects', async () => {
    runtime = new ChildProcessRuntime({ workspace, cellTimeoutMs: 200 });
    await runtime.start();
    await assert.rejects(() => runtime.runCell('return new Promise(() => {});'), /timed out/);
  });

  it('times out a silent-but-alive cell on the inactivity cap', async () => {
    runtime = new ChildProcessRuntime({ workspace, inactivityTimeoutMs: 150, cellTimeoutMs: 10_000 });
    await runtime.start();
    await assert.rejects(() => runtime.runCell('return new Promise(() => {});'), /inactivity/);
  });

  it('progress() resets the inactivity timer so a long heartbeating cell completes', async () => {
    runtime = new ChildProcessRuntime({ workspace, inactivityTimeoutMs: 150, cellTimeoutMs: 10_000 });
    await runtime.start();
    const { value } = await runtime.runCell(
      "for (let i = 0; i < 4; i++) { progress('tick' + i); await new Promise((r) => setTimeout(r, 80)); } return 'done';",
    );
    assert.equal(value, 'done');
  });

  it('still enforces the total wall-clock cap even while progress() heartbeats', async () => {
    runtime = new ChildProcessRuntime({
      workspace, cellTimeoutMs: 250, inactivityTimeoutMs: 60_000, inactivityAfterProgressMs: 60_000,
    });
    await runtime.start();
    await assert.rejects(
      () => runtime.runCell("while (true) { progress('busy'); await new Promise((r) => setTimeout(r, 40)); }"),
      /total wall-clock/,
    );
  });

  it('cancel() rejects the active cell and the kernel restarts on the next call', async () => {
    runtime = new ChildProcessRuntime({
      workspace, cancelGraceMs: 100, inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000,
    });
    await runtime.start();
    const p = runtime.runCell('return new Promise(() => {});');
    await delay(50);
    await runtime.cancel();
    await assert.rejects(() => p, /cancelled/);
    const { value } = await runtime.runCell('return 7;');
    assert.equal(value, 7);
  });

  it('a stray SIGINT between cells is ignored (kernel state survives)', async () => {
    runtime = new ChildProcessRuntime({ workspace });
    await runtime.start();
    await runtime.runCell('globalThis.x = 99;');
    await runtime.cancel(); // nothing running: sends SIGINT, which the child ignores
    const { value } = await runtime.runCell('return globalThis.x;');
    assert.equal(value, 99); // 99 (not null) proves the kernel was NOT restarted
  });

  it('hard-fails after a second death without an intervening successful cell', async () => {
    runtime = new ChildProcessRuntime({
      workspace, cancelGraceMs: 80, inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000,
    });
    await runtime.start();
    const p1 = runtime.runCell('return new Promise(() => {});');
    await delay(30);
    await runtime.cancel();
    await assert.rejects(() => p1, /cancelled/);

    const p2 = runtime.runCell('return new Promise(() => {});'); // triggers restart #1
    await delay(30);
    await runtime.cancel();
    await assert.rejects(() => p2, /cancelled/);

    await assert.rejects(() => runtime.runCell('return 1;'), /repeatedly crashed/);
  });

  it('hasActiveCell is true while a cell runs, false otherwise', async () => {
    runtime = new ChildProcessRuntime({ workspace, inactivityTimeoutMs: 10_000, cellTimeoutMs: 10_000 });
    await runtime.start();
    assert.equal(runtime.hasActiveCell, false);
    const p = runtime.runCell('await new Promise((r) => setTimeout(r, 150)); return 5;');
    assert.equal(runtime.hasActiveCell, true);
    assert.equal((await p).value, 5);
    assert.equal(runtime.hasActiveCell, false);
  });
});

describe('data-lib bindings inside a live kernel', () => {
  let ws: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-libs-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
  });

  it('polars / lodash / zod / date-fns / XLSX / axios / DuckDB are bound', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, inactivityTimeoutMs: 20_000, cellTimeoutMs: 20_000 });
    await rt.start();
    assert.equal((await rt.runCell('return polars.DataFrame({ a: [1, 2, 3] }).height;')).value, 3);
    assert.equal((await rt.runCell('return lodash.chunk([1, 2, 3, 4], 2).length;')).value, 2);
    assert.equal((await rt.runCell('return zod.string().parse("hi");')).value, 'hi');
    assert.equal((await rt.runCell('return dateFns.format(new Date(1970, 0, 1), "yyyy");')).value, '1970');
    assert.equal((await rt.runCell(
      'const wb = XLSX.utils.book_new();' +
      'const ws = XLSX.utils.aoa_to_sheet([[1,2,3]]);' +
      'XLSX.utils.book_append_sheet(wb, ws, "s");' +
      'const buf = XLSX.write(wb, {type:"buffer", bookType:"xlsx"});' +
      'return buf.byteLength > 0;'
    )).value, true);
    assert.equal((await rt.runCell('return typeof axios.get;')).value, 'function');
    assert.equal((await rt.runCell('return typeof DuckDB.DuckDBInstance;')).value, 'function');
  });
});

describe('ChildProcessRuntime — persistence (1d2)', () => {
  let ws: string;
  let sp: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-pers-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    sp = await mkdtemp(join(tmpdir(), 'cpr-pers-sp-'));
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
    await rm(sp, { recursive: true, force: true });
  });

  it('binds otto.duckdb as a DuckDBInstance when scratchpadDir is set', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const { value } = await rt.runCell(
      'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (42)"); const r = await c.runAndReadAll("SELECT x FROM t"); return r.getRows().length;',
    );
    assert.equal(value, 1);
    assert.equal(existsSync(join(sp, 'kernel.db')), true);
  });

  it('DuckDB table survives dispose + fresh runtime on the same scratchpadDir', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    await rt.runCell(
      'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (1),(2),(3)");',
    );
    await rt.dispose();

    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const { value } = await rt.runCell(
      'const c = await otto.duckdb.connect(); const r = await c.runAndReadAll("SELECT COUNT(*) AS n FROM t"); return Number(r.getRows()[0][0]);',
    );
    assert.equal(value, 3);
  });

  it('restores globalThis from a pre-written namespace.json (Date + Map roundtrip)', async () => {
    const m = new Map<string, number>([['a', 1], ['b', 2]]);
    const d = new Date(1717180800000);
    const { envelope } = encodeNamespace({ m, d, n: 42 }, () => 0);
    writeFileSync(join(sp, 'namespace.json'), JSON.stringify(envelope));

    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const a = (await rt.runCell('return globalThis.n;')).value;
    const b = (await rt.runCell('return globalThis.m.get("b");')).value;
    const c = (await rt.runCell('return globalThis.d instanceof Date && globalThis.d.getTime();')).value;
    assert.equal(a, 42);
    assert.equal(b, 2);
    assert.equal(c, 1717180800000);
    assert.deepEqual(rt.recoveryNotes, []);
  });

  it('records namespace-absent in recoveryNotes when namespace.json is missing', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    assert.deepEqual(rt.recoveryNotes, [{ kind: 'namespace-absent' }]);
  });

  it('records namespace-corrupt in recoveryNotes when namespace.json is malformed', async () => {
    writeFileSync(join(sp, 'namespace.json'), '{not json');
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    assert.equal(rt.recoveryNotes.length, 1);
    assert.equal(rt.recoveryNotes[0].kind, 'namespace-corrupt');
    assert.ok(
      rt.recoveryNotes[0].kind === 'namespace-corrupt' &&
        rt.recoveryNotes[0].message.length > 0,
      'corrupt note should carry a non-empty parse error message',
    );
  });

  it('legacy mode (no scratchpadDir) leaves otto.duckdb undefined and emits no recovery notes', async () => {
    rt = new ChildProcessRuntime({ workspace: ws });
    await rt.start();
    const v = (await rt.runCell('return typeof otto.duckdb;')).value;
    assert.equal(v, 'undefined');
    assert.deepEqual(rt.recoveryNotes, []);
  });
});

describe('ChildProcessRuntime — snapshot() (1d2)', () => {
  let ws: string;
  let sp: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-snap-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    sp = await mkdtemp(join(tmpdir(), 'cpr-snap-sp-'));
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
    await rm(sp, { recursive: true, force: true });
  });

  it('snapshot() writes namespace.json from live globalThis state and returns ok', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    await rt.runCell('globalThis.cnt = 7; globalThis.who = "noc"; globalThis.when = new Date(0);');
    const res = await rt.snapshot();
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual(res.skipped, []);
      assert.ok(typeof res.snapshotted_at === 'string');
    }
    const envelope = JSON.parse(readFileSync(join(sp, 'namespace.json'), 'utf8'));
    assert.equal(envelope.schema_version, 1);
    assert.equal(typeof envelope.snapshot_b64, 'string');
    // Round-trip in a fresh runtime: globalThis.cnt comes back as 7.
    await rt.dispose();
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    const back = (await rt.runCell('return [globalThis.cnt, globalThis.who, globalThis.when.getTime()];')).value;
    assert.deepEqual(back, [7, 'noc', 0]);
  });

  it('snapshot() records non-serializable values in skipped[]', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    // A function on globalThis is not v8-serializable.
    await rt.runCell('globalThis.fn = function bad() { return 1; }; globalThis.ok = 1;');
    const res = await rt.snapshot();
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.skipped.length, 1);
      assert.equal(res.skipped[0].key, 'fn');
      assert.equal(res.skipped[0].ctor, 'Function');
    }
  });

  it('snapshot() on a legacy runtime (no scratchpadDir) is a no-op and resolves ok', async () => {
    rt = new ChildProcessRuntime({ workspace: ws });
    await rt.start();
    const res = await rt.snapshot();
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.skipped, []);
  });

  it('snapshot() on a disposed runtime resolves with ok:false (does NOT throw)', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: sp, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await rt.start();
    await rt.dispose();
    const res = await rt.snapshot();
    assert.equal(res.ok, false);
  });

  it('start() rejects with a startup_error/duckdb_open tagged error when kernel.db cannot be opened', async () => {
    // Point scratchpadDir at a file (not a dir) so DuckDBInstance.create(join(file,"kernel.db")) fails.
    const blocker = join(sp, 'blocker');
    writeFileSync(blocker, 'x');
    rt = new ChildProcessRuntime({ workspace: ws, scratchpadDir: blocker, cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 });
    await assert.rejects(rt.start(), (e: Error) => /startup_error\/duckdb_open/.test(e.name) || /duckdb/i.test(e.message));
  });
});

describe('ChildProcessRuntime — vault env injection (Phase 2)', () => {
  let ws: string;
  let rt: ChildProcessRuntime;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'cpr-env-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
  });
  afterEach(async () => {
    await rt?.dispose();
    await rm(ws, { recursive: true, force: true });
  });

  it('injects OTTO_DS_* env vars from bound vault entries into the spawned child only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpr-env-vault-'));
    const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
    const vault = new LocalDataVault({ globalDir: join(root, 'global'), workspaceDir: undefined, audit });
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x', token: 't' });
    const injector = new CredentialInjector({ vault, audit });

    // Sanity: parent process must NOT have these env vars before spawn.
    assert.equal(process.env.OTTO_DS_JIRA_PROD__URL, undefined);
    assert.equal(process.env.OTTO_DS_JIRA_PROD__TOKEN, undefined);

    rt = new ChildProcessRuntime({
      workspace: ws,
      cellTimeoutMs: 10_000,
      inactivityTimeoutMs: 10_000,
      injector,
      bindings: ['jira:prod'],
      scratchpadName: 'sp-env-test',
      sessionId: 'sess-env-test',
    });
    await rt.start();
    const { value } = await rt.runCell(
      'return [process.env.OTTO_DS_JIRA_PROD__URL, process.env.OTTO_DS_JIRA_PROD__TOKEN];',
    );
    assert.deepEqual(value, ['https://x', 't']);

    // Parent process must still be clean post-spawn.
    assert.equal(process.env.OTTO_DS_JIRA_PROD__URL, undefined);
    assert.equal(process.env.OTTO_DS_JIRA_PROD__TOKEN, undefined);

    await rm(root, { recursive: true, force: true });
  });

  it('records spawnTime for staleness checks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpr-env-time-'));
    const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
    const vault = new LocalDataVault({ globalDir: join(root, 'global'), workspaceDir: undefined, audit });
    const injector = new CredentialInjector({ vault, audit });

    rt = new ChildProcessRuntime({
      workspace: ws,
      cellTimeoutMs: 10_000,
      inactivityTimeoutMs: 10_000,
      injector,
      bindings: [], // empty bindings: still tracks spawnTime, but skips injection
      scratchpadName: 'sp-time-test',
      sessionId: 'sess-time-test',
    });

    // Pre-start: spawnTime is the epoch placeholder.
    assert.equal(rt.spawnTime.getTime(), 0);

    const before = Date.now();
    await rt.start();
    const after = Date.now();

    assert.ok(rt.spawnTime.getTime() >= before, 'spawnTime should be >= before start()');
    assert.ok(rt.spawnTime.getTime() <= after, 'spawnTime should be <= after start()');

    await rm(root, { recursive: true, force: true });
  });
});
