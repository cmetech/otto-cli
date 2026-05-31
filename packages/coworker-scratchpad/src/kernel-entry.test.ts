import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import { resolveKernelEntry, kernelExecArgv, filterEnv } from './kernel-spawn.js';
import type { KernelFrame, ResultResponse } from './kernel-protocol.js';

let workspace: string;
let inputs: string;
let child: ChildProcessWithoutNullStreams;

function startKernel(ws: string): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [...kernelExecArgv(), resolveKernelEntry(), ws],
    { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
  ) as ChildProcessWithoutNullStreams;
}

// Drain frames until `count` result frames have arrived; ignore events.
async function collectResults(c: ChildProcessWithoutNullStreams, count: number): Promise<ResultResponse[]> {
  const results: ResultResponse[] = [];
  for await (const raw of readNdjson(c.stdout)) {
    const frame = raw as KernelFrame;
    if (frame.type === 'result') {
      results.push(frame);
      if (results.length === count) break;
    }
  }
  return results;
}

describe('kernel-entry (child process)', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ke-ws-'));
    inputs = join(workspace, '.otto', 'inputs');
    await mkdir(inputs, { recursive: true });
  });

  afterEach(async () => {
    child?.kill('SIGKILL');
    await rm(workspace, { recursive: true, force: true });
  });

  it('evaluates a cell and returns its value + captured stdout', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: "console.log('hi'); return 1 + 1;" });
    const [res] = await collectResults(child, 1);
    assert.equal(res.ok, true);
    assert.equal((res as { value: unknown }).value, 2);
    assert.equal((res as { stdout: string }).stdout, 'hi');
  });

  it('persists globalThis across cells', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: 'globalThis.counter = 41; return globalThis.counter;' });
    await writeNdjson(child.stdin, { id: 2, type: 'run', code: 'return globalThis.counter + 1;' });
    const results = await collectResults(child, 2);
    assert.equal(results[0].ok, true);
    assert.equal((results[0] as { value: unknown }).value, 41);
    assert.equal((results[1] as { value: unknown }).value, 42);
  });

  it('binds otto.collectors.list() to the workspace inputs dir', async () => {
    await writeFile(join(inputs, 'cmdb.csv'), 'a,b\n1,2\n');
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: 'return (await otto.collectors.list()).map((r) => r.uri);' });
    const [res] = await collectResults(child, 1);
    assert.equal(res.ok, true);
    assert.deepEqual((res as { value: string[] }).value, [pathToFileURL(join(inputs, 'cmdb.csv')).href]);
  });

  it('returns ok:false with the error message when a cell throws', async () => {
    child = startKernel(workspace);
    await writeNdjson(child.stdin, { id: 1, type: 'run', code: "throw new Error('boom');" });
    const [res] = await collectResults(child, 1);
    assert.equal(res.ok, false);
    assert.match((res as { error: { message: string } }).error.message, /boom/);
  });
});
