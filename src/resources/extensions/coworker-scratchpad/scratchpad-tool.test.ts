import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerScratchpadTool } from './scratchpad-tool.js';

interface StubMgr {
  runCell(name: string, code: string): Promise<{ value: unknown; stdout: string }>;
  calls: Array<['runCell', string, string]>;
  nextResult: { value: unknown; stdout: string } | { throw: Error };
}
function makeStub(): StubMgr {
  const calls: StubMgr['calls'] = [];
  return {
    calls,
    nextResult: { value: undefined, stdout: '' },
    async runCell(name, code) {
      calls.push(['runCell', name, code]);
      if ('throw' in this.nextResult) throw this.nextResult.throw;
      return this.nextResult;
    },
  };
}

interface FakePi {
  tools: Map<string, { name: string; execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ details: unknown }> }>;
  registerTool(opts: { name: string; execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ details: unknown }>; [k: string]: unknown }): void;
}
function makePi(): FakePi {
  const tools = new Map();
  return { tools, registerTool(opts) { tools.set(opts.name, opts); } };
}

let root: string;

describe('scratchpad-tool dispatch (stubbed manager)', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'stool-root-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function wire(currentName: string | null = null): { pi: FakePi; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const mgr = makeStub();
    const current = { name: currentName };
    registerScratchpadTool(pi as unknown as Parameters<typeof registerScratchpadTool>[0], {
      getManager: () => mgr as unknown as Parameters<typeof registerScratchpadTool>[1]['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
    } as Parameters<typeof registerScratchpadTool>[1]);
    return { pi, mgr, current };
  }

  it('exec without name uses currentName (or auto-default)', async () => {
    const { pi, mgr, current } = wire(null);
    mgr.nextResult = { value: 42, stdout: '' };
    const res = (await pi.tools.get('scratchpad')!.execute('', { action: 'exec', code: 'return 42;' }, undefined, undefined, {})).details as { ok: boolean; mime: Record<string, unknown> };
    assert.equal(current.name, 'default');
    assert.deepEqual(mgr.calls, [['runCell', 'default', 'return 42;']]);
    assert.equal(res.ok, true);
    assert.equal(res.mime['application/json'], 42);
  });

  it('exec with explicit name does NOT change currentName', async () => {
    const { pi, mgr, current } = wire('p1');
    mgr.nextResult = { value: 'ok', stdout: '' };
    await pi.tools.get('scratchpad')!.execute('', { action: 'exec', name: 'side', code: 'return "ok";' }, undefined, undefined, {}).then(r => r.details);
    assert.deepEqual(mgr.calls, [['runCell', 'side', 'return "ok";']]);
    assert.equal(current.name, 'p1');
  });

  it('exec returns ok:false when manager throws', async () => {
    const { pi, mgr } = wire('p1');
    mgr.nextResult = { throw: Object.assign(new Error('boom'), { name: 'BoomError' }) } as any;
    const res = (await pi.tools.get('scratchpad')!.execute('', { action: 'exec', code: 'throw new Error("boom");' }, undefined, undefined, {})).details as { ok: boolean; error: { name: string; message: string } };
    assert.equal(res.ok, false);
    assert.equal(res.error.name, 'BoomError');
    assert.match(res.error.message, /boom/);
  });

  it('view returns tail-5 by default and the right total_cells', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const lines = [JSON.stringify({ type: 'header', version: 1 })];
    for (let i = 1; i <= 8; i++) {
      lines.push(JSON.stringify({ id: i, parentId: i === 1 ? null : i - 1, code: `return ${i};`, ok: true, value: i, stdout: '', ts: `t${i}` }));
    }
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = (await pi.tools.get('scratchpad')!.execute('', { action: 'view' }, undefined, undefined, {})).details as { cells: Array<{ id: number }>; total_cells: number };
    assert.equal(res.total_cells, 8);
    assert.equal(res.cells.length, 5);
    assert.deepEqual(res.cells.map((c) => c.id), [4, 5, 6, 7, 8]);
  });

  it('view caps tail at 20', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const lines = [JSON.stringify({ type: 'header', version: 1 })];
    for (let i = 1; i <= 30; i++) {
      lines.push(JSON.stringify({ id: i, parentId: i === 1 ? null : i - 1, code: 'x', ok: true, value: i, stdout: '', ts: 't' }));
    }
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = (await pi.tools.get('scratchpad')!.execute('', { action: 'view', tail: 100 }, undefined, undefined, {})).details as { cells: unknown[] };
    assert.equal(res.cells.length, 20);
  });

  it('view with from_id returns cells with id >= from_id', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const lines = [JSON.stringify({ type: 'header', version: 1 })];
    for (let i = 1; i <= 10; i++) {
      lines.push(JSON.stringify({ id: i, parentId: i === 1 ? null : i - 1, code: 'x', ok: true, value: i, stdout: '', ts: 't' }));
    }
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = (await pi.tools.get('scratchpad')!.execute('', { action: 'view', from_id: 7 }, undefined, undefined, {})).details as { cells: Array<{ id: number }> };
    assert.deepEqual(res.cells.map((c) => c.id), [7, 8, 9, 10]);
  });

  it('view truncates value strings to 200 chars and stdout to 500 chars', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const longValue = 'x'.repeat(500);
    const longStdout = 'y'.repeat(1000);
    const lines = [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'long', ok: true, value: longValue, stdout: longStdout, ts: 't' }),
    ];
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = (await pi.tools.get('scratchpad')!.execute('', { action: 'view' }, undefined, undefined, {})).details as { cells: Array<{ value: string; stdout: string }> };
    assert.equal(res.cells[0].value.length, 200);
    assert.equal(res.cells[0].stdout.length, 500);
  });
});
