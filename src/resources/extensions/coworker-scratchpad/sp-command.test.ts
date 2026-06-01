import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSpCommand, type SpDeps } from './sp-command.js';

interface StubMgr {
  list(): Array<{ name: string; live: boolean; lastUsedAt: number }>;
  create(name: string): Promise<unknown>;
  getOrAttach(name: string): Promise<unknown>;
  remove(name: string): Promise<void>;
  rootDir(): string;
  calls: Array<[string, ...unknown[]]>;
}

function makeStub(root: string, existing: string[] = []): StubMgr {
  const calls: StubMgr['calls'] = [];
  return {
    calls,
    rootDir: () => root,
    list() { calls.push(['list']); return existing.map((n) => ({ name: n, live: false, lastUsedAt: 0 })); },
    async create(name) { calls.push(['create', name]); if (existing.includes(name)) throw new Error(`scratchpad ${name} already exists`); existing.push(name); return null; },
    async getOrAttach(name) { calls.push(['getOrAttach', name]); if (!existing.includes(name)) existing.push(name); return null; },
    async remove(name) { calls.push(['remove', name]); const i = existing.indexOf(name); if (i >= 0) existing.splice(i, 1); },
  };
}

interface FakeCtx {
  notifications: Array<[string, string]>;
  hasUI: boolean;
  cwd: string;
  ui: { notify: (msg: string, level: string) => void };
}
function makeCtx(): FakeCtx {
  const notifications: FakeCtx['notifications'] = [];
  return { notifications, hasUI: false, cwd: process.cwd(), ui: { notify: (m, l) => notifications.push([l, m]) } };
}

interface FakePi {
  commands: Map<string, { description: string; handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> }>;
  registerCommand(name: string, opts: { description: string; handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> }): void;
}
function makePi(): FakePi {
  const commands = new Map();
  return { commands, registerCommand(name, opts) { commands.set(name, opts); } };
}

let root: string;

describe('sp-command dispatch (stubbed manager)', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function wire(existing: string[] = []): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const ctx = makeCtx();
    const mgr = makeStub(root, existing);
    const current = { name: null as string | null };
    const deps: SpDeps = {
      getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
    } as SpDeps;
    registerSpCommand(pi as unknown as Parameters<typeof registerSpCommand>[0], deps);
    return { pi, ctx, mgr, current };
  }

  it('/sp with no verb dispatches to list', async () => {
    const { pi, ctx, mgr } = wire(['default']);
    await pi.commands.get('sp')!.handler('', ctx);
    assert.equal(mgr.calls[0][0], 'list');
    assert.ok(ctx.notifications.some(([_l, m]) => m.includes('default')));
  });

  it('/sp new <name> creates and sets currentName', async () => {
    const { pi, ctx, mgr, current } = wire();
    await pi.commands.get('sp')!.handler('new p1', ctx);
    assert.deepEqual(mgr.calls, [['create', 'p1']]);
    assert.equal(current.name, 'p1');
  });

  it('/sp new with invalid name errors before touching manager', async () => {
    const { pi, ctx, mgr, current } = wire();
    await pi.commands.get('sp')!.handler('new 1bad', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /invalid scratchpad name/.test(m)));
  });

  it('/sp attach <name> warms and sets currentName', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.deepEqual(mgr.calls, [['getOrAttach', 'p1']]);
    assert.equal(current.name, 'p1');
  });

  it('/sp reset <name> calls remove then create; preserves currentName when matched', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('reset p1', ctx);
    assert.deepEqual(mgr.calls, [['remove', 'p1'], ['create', 'p1']]);
    assert.equal(current.name, 'p1');
  });

  it('/sp view <name> reads cells.jsonl and emits a summary', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'cells.jsonl'), [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'return 1;', ok: true, value: 1, stdout: '', ts: 't1' }),
    ].join('\n') + '\n');
    await pi.commands.get('sp')!.handler('view p1', ctx);
    assert.ok(ctx.notifications.some(([_l, m]) => m.includes('cell 1') || m.includes('return 1;')));
  });

  it('/sp remove <name> deletes and clears currentName if matched', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('remove p1', ctx);
    assert.deepEqual(mgr.calls, [['remove', 'p1']]);
    assert.equal(current.name, null);
  });

  it('/sp view (no name, no current) auto-attaches to default', async () => {
    const { pi, ctx, mgr, current } = wire();
    await pi.commands.get('sp')!.handler('view', ctx);
    // ensureCurrent returned 'default'; view tries to read cells.jsonl which is missing -> empty result
    assert.equal(current.name, 'default');
    assert.ok(ctx.notifications.some(([_l, m]) => /no cells yet/i.test(m) || /total_cells.*0/.test(m)));
  });

  it('getArgumentCompletions returns existing scratchpad names for verb-2nd-arg', async () => {
    const { pi } = wire();
    await mkdir(join(root, 'investigation-1'), { recursive: true });
    await writeFile(join(root, 'investigation-1', 'meta.json'), JSON.stringify({ name: 'investigation-1' }));
    await mkdir(join(root, 'p1-1234'), { recursive: true });
    await writeFile(join(root, 'p1-1234', 'meta.json'), JSON.stringify({ name: 'p1-1234' }));
    const completions = pi.commands.get('sp')!.getArgumentCompletions!('attach ');
    const values = completions.map((c) => c.value).sort();
    assert.deepEqual(values, ['attach investigation-1', 'attach p1-1234']);
  });
});
