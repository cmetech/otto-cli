import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChildProcessRuntime } from './child-process-runtime.js';
import type { DataLoadDrawer } from './kernel-protocol.js';

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

  it('polars / lodash / zod / date-fns / exceljs / axios / DuckDB are bound', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, inactivityTimeoutMs: 20_000, cellTimeoutMs: 20_000 });
    await rt.start();
    assert.equal((await rt.runCell('return polars.DataFrame({ a: [1, 2, 3] }).height;')).value, 3);
    assert.equal((await rt.runCell('return lodash.chunk([1, 2, 3, 4], 2).length;')).value, 2);
    assert.equal((await rt.runCell('return zod.string().parse("hi");')).value, 'hi');
    assert.equal((await rt.runCell('return dateFns.format(new Date(1970, 0, 1), "yyyy");')).value, '1970');
    assert.equal((await rt.runCell('const wb = new ExcelJS.Workbook(); wb.addWorksheet("s"); const buf = await wb.xlsx.writeBuffer(); return buf.byteLength > 0;')).value, true);
    assert.equal((await rt.runCell('return typeof axios.get;')).value, 'function');
    assert.equal((await rt.runCell('return typeof DuckDB.DuckDBInstance;')).value, 'function');
  });
});
