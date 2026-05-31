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

    // The data_load event may arrive moments before the result; allow a tick.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(drawers.length, 1);
    assert.equal(drawers[0].kind, 'data_load');
    assert.equal(drawers[0].collector, 'file');
    assert.equal(drawers[0].uri, uri);
    assert.equal(drawers[0].bytes, 8);
    assert.equal(drawers[0].schema, null);
  });

  it('times out a hung cell and rejects', async () => {
    runtime = new ChildProcessRuntime({ workspace, cellTimeoutMs: 200 });
    await runtime.start();
    await assert.rejects(() => runtime.runCell('return new Promise(() => {});'), /timed out/);
  });
});
