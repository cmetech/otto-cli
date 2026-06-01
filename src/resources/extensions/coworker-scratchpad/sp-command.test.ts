import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSpCommand, type SpDeps } from './sp-command.js';
import { ScratchpadBusyError } from '@otto/coworker-scratchpad';

interface StubMgr {
  list(): Array<{ name: string; live: boolean; lastUsedAt: number }>;
  create(name: string): Promise<unknown>;
  getOrAttach(name: string, opts?: { forceTakeover?: boolean; takeoverReason?: string }): Promise<unknown>;
  remove(name: string): Promise<void>;
  save(name: string): Promise<void>;
  detach(name: string, sessionId: string): Promise<void>;
  clearHistory(name: string): Promise<void>;
  markRecoveryNotesSeen(name: string): Promise<void>;
  rootDir(): string;
  calls: Array<[string, ...unknown[]]>;
}

function makeStub(root: string, existing: string[] = [], busyOnAttach: boolean = false): StubMgr {
  const calls: StubMgr['calls'] = [];
  let busy = busyOnAttach;
  return {
    calls,
    rootDir: () => root,
    list() { calls.push(['list']); return existing.map((n) => ({ name: n, live: false, lastUsedAt: 0 })); },
    async create(name) { calls.push(['create', name]); if (existing.includes(name)) throw new Error(`scratchpad ${name} already exists`); existing.push(name); return null; },
    async getOrAttach(name, opts) {
      calls.push(['getOrAttach', name, opts ?? {}]);
      if (busy && !opts?.forceTakeover) {
        throw new ScratchpadBusyError(name, { pid: 9999, host: 'host-x', acquired_at: '2026-05-31T10:00:00.000Z' });
      }
      busy = false; // takeover succeeded; subsequent attaches are normal
      if (!existing.includes(name)) existing.push(name);
      return null;
    },
    async remove(name) { calls.push(['remove', name]); const i = existing.indexOf(name); if (i >= 0) existing.splice(i, 1); },
    async save(name) { calls.push(['save', name]); if (!existing.includes(name)) throw new Error(`scratchpad ${name} is not warm — nothing to save`); },
    async detach(name, sid) { calls.push(['detach', name, sid]); },
    async clearHistory(name) { calls.push(['clearHistory', name]); },
    async markRecoveryNotesSeen(name) { calls.push(['markRecoveryNotesSeen', name]); },
  };
}

interface FakeCtx {
  notifications: Array<[string, string]>;
  hasUI: boolean;
  cwd: string;
  ui: {
    notify: (msg: string, level: string) => void;
    confirm: (title: string, msg: string) => Promise<boolean>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
  };
}
function makeCtx(confirmAnswer: boolean = true, ...rest: Array<string | undefined>): FakeCtx {
  const inputAnswer: string | undefined = rest.length === 0 ? 'because reason' : rest[0];
  const notifications: FakeCtx['notifications'] = [];
  return {
    notifications,
    hasUI: false,
    cwd: process.cwd(),
    ui: {
      notify: (m, l) => notifications.push([l, m]),
      confirm: async (_title: string, _msg: string) => confirmAnswer,
      input: async (_title: string, _placeholder?: string) => inputAnswer,
    },
  };
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
      getSessionId: () => 'sess-1',
    } as SpDeps;
    registerSpCommand(pi as unknown as Parameters<typeof registerSpCommand>[0], deps);
    return { pi, ctx, mgr, current };
  }

  function wireWithConfirm(confirm: boolean, existing: string[] = []): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const ctx = makeCtx(confirm);
    const mgr = makeStub(root, existing);
    const current = { name: null as string | null };
    const deps: SpDeps = {
      getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
      getSessionId: () => 'sess-1',
    } as SpDeps;
    registerSpCommand(pi as unknown as Parameters<typeof registerSpCommand>[0], deps);
    return { pi, ctx, mgr, current };
  }

  function wireWithBusy(confirm: boolean, inputAnswer: string | undefined, existing: string[] = []): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const ctx = makeCtx(confirm, inputAnswer);
    const mgr = makeStub(root, existing, /* busyOnAttach */ true);
    const current = { name: null as string | null };
    const deps: SpDeps = {
      getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
      getSessionId: () => 'sess-1',
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
    assert.deepEqual(mgr.calls, [['getOrAttach', 'p1', {}]]);
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

  it('/sp tree prints the formatted tree of the current scratchpad', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'cells.jsonl'), [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'return 1;', ok: true, value: 1, stdout: '', ts: 't1' }),
      JSON.stringify({ id: 2, parentId: 1, code: 'return 2;', ok: true, value: 2, stdout: '', ts: 't2' }),
    ].join('\n') + '\n');
    await writeFile(join(root, 'p1', 'meta.json'), JSON.stringify({ name: 'p1', cell_leaf_id: 2 }));
    await pi.commands.get('sp')!.handler('tree p1', ctx);
    const text = ctx.notifications.map(([_, m]) => m).join('\n');
    assert.match(text, /#1/);
    assert.match(text, /#2/);
    assert.match(text, /\*/); // current-leaf marker
  });

  it('/sp tree --to <id> calls manager.setLeaf', async () => {
    const setLeafCalls: Array<[string, number]> = [];
    const { pi, ctx, mgr } = wire(['p1']);
    (mgr as unknown as { setLeaf: (n: string, i: number) => Promise<void> }).setLeaf = async (n, i) => { setLeafCalls.push([n, i]); };
    await pi.commands.get('sp')!.handler('tree p1 --to 1', ctx);
    assert.deepEqual(setLeafCalls, [['p1', 1]]);
    assert.ok(ctx.notifications.some(([_, m]) => /set leaf of p1 to cell 1/.test(m)));
  });

  it('/sp tree --to with non-numeric id reports a usage error', async () => {
    const { pi, ctx } = wire(['p1']);
    await pi.commands.get('sp')!.handler('tree p1 --to bogus', ctx);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /Usage: \/sp tree/.test(m)));
  });

  it('/sp tree on a scratchpad with no cells notifies "no cells yet"', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await pi.commands.get('sp')!.handler('tree p1', ctx);
    assert.ok(ctx.notifications.some(([_, m]) => /no cells yet/.test(m)));
  });

  it('/sp fork <src> <dst> calls manager.fork', async () => {
    const forkCalls: Array<[string, string]> = [];
    const { pi, ctx, mgr } = wire(['p1']);
    (mgr as unknown as { fork: (s: string, d: string) => Promise<void> }).fork = async (s, d) => { forkCalls.push([s, d]); };
    await pi.commands.get('sp')!.handler('fork p1 p2', ctx);
    assert.deepEqual(forkCalls, [['p1', 'p2']]);
    assert.ok(ctx.notifications.some(([_, m]) => /forked p1 → p2/.test(m)));
  });

  it('/sp fork without two args reports a usage error', async () => {
    const { pi, ctx } = wire();
    await pi.commands.get('sp')!.handler('fork onlyone', ctx);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /Usage: \/sp fork/.test(m)));
  });

  it('/sp save calls manager.save on current scratchpad', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('save', ctx);
    assert.deepEqual(mgr.calls, [['save', 'p1']]);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /saved p1/.test(m)));
  });

  it('/sp save errors when no current and no arg', async () => {
    const { pi, ctx, mgr } = wire();
    await pi.commands.get('sp')!.handler('save', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /no current scratchpad/.test(m)));
  });

  it('/sp detach removes current and clears currentName', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('detach', ctx);
    assert.deepEqual(mgr.calls, [['detach', 'p1', 'sess-1']]);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /detached from p1/.test(m)));
  });

  it('/sp detach errors when not attached', async () => {
    const { pi, ctx, mgr } = wire();
    await pi.commands.get('sp')!.handler('detach', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /not attached/.test(m)));
  });

  it('/sp clear-history confirms then calls manager.clearHistory', async () => {
    const { pi, ctx, mgr, current } = wireWithConfirm(true, ['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('clear-history', ctx);
    assert.deepEqual(mgr.calls, [['clearHistory', 'p1']]);
  });

  it('/sp clear-history cancels when confirm returns false', async () => {
    const { pi, ctx, mgr, current } = wireWithConfirm(false, ['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('clear-history', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp remove on current scratchpad confirms; --yes skips confirm', async () => {
    // confirm=false => without --yes, remove is blocked
    const { pi: pi1, ctx: ctx1, mgr: mgr1, current: cur1 } = wireWithConfirm(false, ['p1']);
    cur1.name = 'p1';
    await pi1.commands.get('sp')!.handler('remove p1', ctx1);
    assert.deepEqual(mgr1.calls, []);
    assert.ok(ctx1.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));

    // --yes flag bypasses the prompt even with confirm=false
    const { pi: pi2, ctx: ctx2, mgr: mgr2, current: cur2 } = wireWithConfirm(false, ['p1']);
    cur2.name = 'p1';
    await pi2.commands.get('sp')!.handler('remove p1 --yes', ctx2);
    assert.deepEqual(mgr2.calls, [['remove', 'p1']]);
    assert.equal(cur2.name, null);
  });

  it('/sp remove of non-current scratchpad does NOT confirm', async () => {
    const { pi, ctx, mgr, current } = wireWithConfirm(false, ['p1', 'p2']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('remove p2', ctx);
    // confirm=false should not block because p2 != current; remove proceeds.
    assert.deepEqual(mgr.calls, [['remove', 'p2']]);
    assert.equal(current.name, 'p1', 'currentName preserved');
  });

  it('/sp attach happy path attaches normally (no busy)', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.deepEqual(mgr.calls[0], ['getOrAttach', 'p1', {}]);
    assert.equal(current.name, 'p1');
  });

  it('/sp attach on busy without flag: confirm accepted, reason from input → retry with forceTakeover', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(true, 'debugging stuck cell');
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    // First call throws busy; second call has forceTakeover.
    assert.equal(mgr.calls[0][0], 'getOrAttach');
    assert.equal(mgr.calls[1][0], 'getOrAttach');
    const secondOpts = mgr.calls[1][2] as { forceTakeover?: boolean; takeoverReason?: string };
    assert.equal(secondOpts.forceTakeover, true);
    assert.equal(secondOpts.takeoverReason, 'debugging stuck cell');
    assert.equal(current.name, 'p1');
  });

  it('/sp attach on busy with confirm declined: cancelled; no retry', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(false, 'unused');
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    // Only the initial busy call; no retry.
    assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 1);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp attach on busy with input undefined (user escaped): cancelled; no retry', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(true, undefined);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 1);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp attach --force-takeover skips confirm but still prompts for reason via input', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(/* confirm */ false, 'because flag');
    await pi.commands.get('sp')!.handler('attach p1 --force-takeover', ctx);
    // confirm=false but the flag bypasses it
    assert.equal(mgr.calls.length, 2);
    const secondOpts = mgr.calls[1][2] as { forceTakeover?: boolean; takeoverReason?: string };
    assert.equal(secondOpts.forceTakeover, true);
    assert.equal(secondOpts.takeoverReason, 'because flag');
    assert.equal(current.name, 'p1');
  });

  it('/sp attach --force-takeover --reason "..." is fully non-interactive', async () => {
    // Both confirm and input stubs would return non-cancel values, but neither should be invoked.
    const { pi, ctx, mgr, current } = wireWithBusy(false, undefined);
    await pi.commands.get('sp')!.handler('attach p1 --force-takeover --reason "explicit reason"', ctx);
    assert.equal(mgr.calls.length, 2);
    const secondOpts = mgr.calls[1][2] as { forceTakeover?: boolean; takeoverReason?: string };
    assert.equal(secondOpts.forceTakeover, true);
    assert.equal(secondOpts.takeoverReason, 'explicit reason');
    assert.equal(current.name, 'p1');
  });

  it('/sp notes [<name>] reads meta.recovery_notes and prints all', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'meta.json'), JSON.stringify({
      recovery_notes: [
        { kind: 'snapshot-failed', message: 'boom', at: '2026-05-31T10:00:00.000Z' },
        { kind: 'cells-since-snapshot', n: 2, at: '2026-05-31T11:00:00.000Z' },
      ],
    }));
    await pi.commands.get('sp')!.handler('notes p1', ctx);
    const banner = ctx.notifications.find(([l]) => l === 'info');
    assert.ok(banner, 'info notify present');
    assert.match(banner![1], /p1 recovery notes \(2\)/);
    assert.match(banner![1], /snapshot-failed: boom/);
    assert.match(banner![1], /2 cells since last snapshot/);
  });

  it('/sp notes on empty notes emits "no recovery notes"', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'meta.json'), JSON.stringify({}));
    await pi.commands.get('sp')!.handler('notes p1', ctx);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /no recovery notes for p1/.test(m)));
  });
});
