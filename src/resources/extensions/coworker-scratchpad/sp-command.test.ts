import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSpCommand, type SpDeps } from './sp-command.js';
import { ScratchpadBusyError } from '@otto/coworker-scratchpad';

interface StubEntry {
  live: boolean;
  lastUsedAt: number;
  hasActiveCell: boolean;
}

interface StubMgr {
  list(): Array<{ name: string; live: boolean; lastUsedAt: number; hasActiveCell: boolean }>;
  create(name: string, opts?: { bindings?: string[] }): Promise<unknown>;
  getOrAttach(name: string, opts?: { forceTakeover?: boolean; takeoverReason?: string }): Promise<unknown>;
  remove(name: string): Promise<void>;
  save(name: string): Promise<void>;
  detach(name: string, sessionId: string): Promise<void>;
  clearHistory(name: string): Promise<void>;
  markRecoveryNotesSeen(name: string): Promise<void>;
  evict(name: string, opts?: { force?: boolean }): Promise<{ interrupted: boolean }>;
  // Phase 2 Task 16: bindings operations. Backed by actual meta.json writes
  // in the test root so /sp list and post-create assertions can verify state.
  addBinding(name: string, ref: string): Promise<{ added: boolean }>;
  removeBinding(name: string, ref: string): Promise<{ removed: boolean }>;
  readBindings(name: string): string[];
  rootDir(): string;
  calls: Array<[string, ...unknown[]]>;
  /** Test-only: override per-entry state for /sp list rendering tests. */
  setEntry(name: string, partial: Partial<StubEntry>): void;
}

// Phase 2 Task 16 test helper: read/write meta.json on disk in the test root.
// The stub manager persists meta.json so sp-command's readBindingsFromMeta()
// (which inspects disk directly) observes the same state the manager set.
function writeMetaToDisk(root: string, name: string, patch: Record<string, unknown>): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'meta.json');
  let cur: Record<string, unknown> = {};
  if (existsSync(path)) {
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* drop */ }
  }
  writeFileSync(path, JSON.stringify({ ...cur, ...patch }, null, 2));
}

function readMetaFromDisk(root: string, name: string): Record<string, unknown> {
  const path = join(root, name, 'meta.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return {}; }
}

function makeStub(root: string, existing: string[] = [], busyOnAttach: boolean = false): StubMgr {
  const calls: StubMgr['calls'] = [];
  let busy = busyOnAttach;
  const entries = new Map<string, StubEntry>();
  for (const n of existing) entries.set(n, { live: false, lastUsedAt: 0, hasActiveCell: false });
  return {
    calls,
    rootDir: () => root,
    list() {
      calls.push(['list']);
      return existing.map((n) => {
        const e = entries.get(n) ?? { live: false, lastUsedAt: 0, hasActiveCell: false };
        return { name: n, live: e.live, lastUsedAt: e.lastUsedAt, hasActiveCell: e.hasActiveCell };
      });
    },
    async create(name, opts) {
      calls.push(opts && Object.keys(opts).length > 0 ? ['create', name, opts] : ['create', name]);
      if (existing.includes(name)) throw new Error(`scratchpad ${name} already exists`);
      existing.push(name);
      // Newly created scratchpad behaves like a fresh warm entry.
      entries.set(name, { live: true, lastUsedAt: Date.now(), hasActiveCell: false });
      // Phase 2 Task 16: persist meta.json so the stub mirrors the real
      // manager's writeMeta(name, opts.bindings) call. bindings default to []
      // matching the v4 schema invariant.
      writeMetaToDisk(root, name, {
        name,
        bindings: Array.isArray(opts?.bindings) ? opts!.bindings : [],
        schema_version: 4,
      });
      return null;
    },
    async getOrAttach(name, opts) {
      calls.push(['getOrAttach', name, opts ?? {}]);
      if (busy && !opts?.forceTakeover) {
        throw new ScratchpadBusyError(name, { pid: 9999, host: 'host-x', acquired_at: '2026-05-31T10:00:00.000Z' });
      }
      busy = false; // takeover succeeded; subsequent attaches are normal
      if (!existing.includes(name)) existing.push(name);
      entries.set(name, { live: true, lastUsedAt: Date.now(), hasActiveCell: false });
      return null;
    },
    async remove(name) {
      calls.push(['remove', name]);
      const i = existing.indexOf(name);
      if (i >= 0) existing.splice(i, 1);
      entries.delete(name);
      // Phase 2 Task 16: also clean up the on-disk meta.json the stub created
      // so subsequent /sp list calls don't see the dead scratchpad.
      try { rmSync(join(root, name), { recursive: true, force: true }); } catch { /* drop */ }
    },
    async save(name) { calls.push(['save', name]); if (!existing.includes(name)) throw new Error(`scratchpad ${name} is not warm — nothing to save`); },
    async detach(name, sid) { calls.push(['detach', name, sid]); },
    async clearHistory(name) { calls.push(['clearHistory', name]); },
    async markRecoveryNotesSeen(name) { calls.push(['markRecoveryNotesSeen', name]); },
    async evict(name, opts) {
      calls.push(['evict', name, opts ?? {}]);
      const e = entries.get(name);
      if (!e || !e.live) throw new Error(`scratchpad ${name} is not warm (already cold)`);
      if (e.hasActiveCell && !opts?.force) {
        throw new Error(`cannot evict ${name}: cell is running (use --force to interrupt)`);
      }
      const interrupted = e.hasActiveCell === true;
      entries.set(name, { live: false, lastUsedAt: e.lastUsedAt, hasActiveCell: false });
      return { interrupted };
    },
    setEntry(name, partial) {
      const cur = entries.get(name) ?? { live: false, lastUsedAt: 0, hasActiveCell: false };
      entries.set(name, { ...cur, ...partial });
    },
    async addBinding(name, ref) {
      calls.push(['addBinding', name, ref]);
      if (!existing.includes(name)) throw new Error(`scratchpad not found: ${name}`);
      const meta = readMetaFromDisk(root, name);
      const bindings = Array.isArray(meta.bindings) ? [...(meta.bindings as string[])] : [];
      if (bindings.includes(ref)) return { added: false };
      bindings.push(ref);
      writeMetaToDisk(root, name, { bindings });
      return { added: true };
    },
    async removeBinding(name, ref) {
      calls.push(['removeBinding', name, ref]);
      if (!existing.includes(name)) throw new Error(`scratchpad not found: ${name}`);
      const meta = readMetaFromDisk(root, name);
      const bindings = Array.isArray(meta.bindings) ? [...(meta.bindings as string[])] : [];
      const idx = bindings.indexOf(ref);
      if (idx < 0) return { removed: false };
      bindings.splice(idx, 1);
      writeMetaToDisk(root, name, { bindings });
      return { removed: true };
    },
    readBindings(name) {
      const meta = readMetaFromDisk(root, name);
      return Array.isArray(meta.bindings) ? (meta.bindings as string[]) : [];
    },
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

  async function seedExistingOnDisk(names: string[]): Promise<void> {
    for (const n of names) {
      await mkdir(join(root, n), { recursive: true });
      await writeFile(join(root, n, 'meta.json'), JSON.stringify({ name: n }));
    }
  }

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
      getWorkspaceCwd: () => '/tmp/test-cwd',
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
      getWorkspaceCwd: () => '/tmp/test-cwd',
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
      getWorkspaceCwd: () => '/tmp/test-cwd',
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
    await seedExistingOnDisk(['p1']);
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
    await seedExistingOnDisk(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.deepEqual(mgr.calls[0], ['getOrAttach', 'p1', {}]);
    assert.equal(current.name, 'p1');
  });

  it('/sp attach on busy without flag: confirm accepted, reason from input → retry with forceTakeover', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(true, 'debugging stuck cell');
    await seedExistingOnDisk(['p1']);
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
    await seedExistingOnDisk(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    // Only the initial busy call; no retry.
    assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 1);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp attach on busy with input undefined (user escaped): cancelled; no retry', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(true, undefined);
    await seedExistingOnDisk(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 1);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /cancelled/.test(m)));
  });

  it('/sp attach --force-takeover skips confirm but still prompts for reason via input', async () => {
    const { pi, ctx, mgr, current } = wireWithBusy(/* confirm */ false, 'because flag');
    await seedExistingOnDisk(['p1']);
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
    await seedExistingOnDisk(['p1']);
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

  describe('/sp list idle-age + /sp evict (Task D)', () => {
    it('list shows "active" for an entry whose lastUsedAt is now', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new t', ctx);
      // /sp new creates a fresh warm entry (lastUsedAt=now); /sp list should label it 'active'.
      await pi.commands.get('sp')!.handler('list', ctx);
      const listMsg = ctx.notifications.filter(([l]) => l === 'info').map(([, m]) => m).join('\n');
      assert.match(listMsg, /● live\s+t\s+active/, 'list should show "● live  t  active" for fresh entry');
    });

    it('list shows "idle Xm" when entry is idle (backdate lastUsedAt by 4 min)', async () => {
      const { pi, ctx, mgr } = wire();
      await pi.commands.get('sp')!.handler('new t', ctx);
      // Backdate lastUsedAt by 4 minutes so the formatter renders 'idle 4m'.
      mgr.setEntry('t', { lastUsedAt: Date.now() - 4 * 60_000 });
      await pi.commands.get('sp')!.handler('list', ctx);
      const listMsg = ctx.notifications.filter(([l]) => l === 'info').map(([, m]) => m).join('\n');
      assert.match(listMsg, /● live\s+t\s+idle 4m/, 'list should show "idle 4m" for backdated entry');
    });

    it('/sp evict t notifies and flips entry to cold', async () => {
      const { pi, ctx, mgr } = wire();
      await pi.commands.get('sp')!.handler('new t', ctx);
      await pi.commands.get('sp')!.handler('evict t', ctx);
      assert.ok(
        ctx.notifications.some(([l, m]) => l === 'info' && /evicted t \(still on disk; \/sp attach t to re-warm\)/.test(m)),
        'evict notification missing',
      );
      // Manager.evict was called with no force flag.
      assert.ok(mgr.calls.some((c) => c[0] === 'evict' && c[1] === 't'), 'manager.evict was not called');
      // Subsequent /sp list should show t as cold.
      await pi.commands.get('sp')!.handler('list', ctx);
      const listMsg = ctx.notifications.filter(([l]) => l === 'info').map(([, m]) => m).join('\n');
      assert.match(listMsg, /○ cold\s+t/, 'list should show t as cold after evict');
    });
  });

  describe('/sp attach existence guard (Task C)', () => {
    it('errors with a helpful suggestion when scratchpad does not exist on disk', async () => {
      const { pi, ctx, mgr, current } = wire();
      await pi.commands.get('sp')!.handler('attach not-a-real-name', ctx);

      const errors = ctx.notifications.filter(([l]) => l === 'error');
      assert.equal(errors.length, 1);
      assert.match(errors[0]![1], /scratchpad not found: not-a-real-name/);
      assert.match(errors[0]![1], /Use \/sp new not-a-real-name to create it/);
      // No phantom scratchpad created on disk and manager never invoked.
      assert.equal(existsSync(join(root, 'not-a-real-name')), false, 'no phantom dir created');
      assert.equal(mgr.calls.filter((c) => c[0] === 'getOrAttach').length, 0, 'getOrAttach not called');
      assert.equal(current.name, null);
    });

    it('still attaches normally when scratchpad exists', async () => {
      const { pi, ctx, mgr, current } = wire(['real']);
      await seedExistingOnDisk(['real']);
      await pi.commands.get('sp')!.handler('attach real', ctx);

      assert.equal(ctx.notifications.filter(([l]) => l === 'error').length, 0);
      assert.ok(ctx.notifications.some(([_l, m]) => /attached to scratchpad: real/.test(m)));
      assert.deepEqual(mgr.calls[0], ['getOrAttach', 'real', {}]);
      assert.equal(current.name, 'real');
    });
  });

  describe('/sp — vault bindings (Phase 2 Task 16)', () => {
    it('/sp new <name> --use jira:prod records bindings in meta.json', async () => {
      const { pi, ctx, mgr, current } = wire();
      await pi.commands.get('sp')!.handler('new p1 --use jira:prod', ctx);
      // Manager.create was invoked with bindings option.
      assert.deepEqual(mgr.calls, [['create', 'p1', { bindings: ['jira:prod'] }]]);
      const meta = readMetaFromDisk(root, 'p1');
      assert.deepEqual(meta.bindings, ['jira:prod']);
      assert.equal(current.name, 'p1');
      // Notification mentions the binding.
      assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /bindings: jira:prod/.test(m)));
    });

    it('/sp new with multiple --use flags records all bindings', async () => {
      const { pi, ctx, mgr } = wire();
      await pi.commands.get('sp')!.handler('new p1 --use jira:prod --use foo:bar', ctx);
      assert.deepEqual(mgr.calls, [['create', 'p1', { bindings: ['jira:prod', 'foo:bar'] }]]);
      const meta = readMetaFromDisk(root, 'p1');
      assert.deepEqual(meta.bindings, ['jira:prod', 'foo:bar']);
    });

    it('/sp new --use with malformed ref errors before touching manager', async () => {
      const { pi, ctx, mgr, current } = wire();
      await pi.commands.get('sp')!.handler('new p1 --use not-a-valid-ref', ctx);
      // create() must NOT have been called.
      assert.deepEqual(mgr.calls, []);
      assert.equal(current.name, null);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /BindingRef|not-a-valid-ref/.test(m)));
    });

    it('/sp use <name> <ref> appends to bindings (idempotent)', async () => {
      const { pi, ctx, mgr } = wire();
      await pi.commands.get('sp')!.handler('new p1', ctx);
      await pi.commands.get('sp')!.handler('use p1 jira:prod', ctx);
      assert.deepEqual(readMetaFromDisk(root, 'p1').bindings, ['jira:prod']);
      assert.ok(mgr.calls.some((c) => c[0] === 'addBinding' && c[1] === 'p1' && c[2] === 'jira:prod'));
      // Second call is idempotent — same ref produces info, not error.
      ctx.notifications.length = 0;
      await pi.commands.get('sp')!.handler('use p1 jira:prod', ctx);
      assert.deepEqual(readMetaFromDisk(root, 'p1').bindings, ['jira:prod']);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /already present/.test(m)));
    });

    it('/sp use emits hint about /sp reset', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1', ctx);
      await pi.commands.get('sp')!.handler('use p1 jira:prod', ctx);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /\/sp reset to inject into the live kernel/.test(m)));
    });

    it('/sp use with malformed ref errors', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1', ctx);
      await pi.commands.get('sp')!.handler('use p1 not-a-valid-ref', ctx);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /BindingRef|not-a-valid-ref/.test(m)));
      assert.deepEqual(readMetaFromDisk(root, 'p1').bindings, []);
    });

    it('/sp use with missing args reports usage error', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('use p1', ctx);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /Usage: \/sp use/.test(m)));
    });

    it('/sp unuse <name> <ref> removes from bindings', async () => {
      const { pi, ctx, mgr } = wire();
      await pi.commands.get('sp')!.handler('new p1 --use jira:prod', ctx);
      await pi.commands.get('sp')!.handler('unuse p1 jira:prod', ctx);
      assert.deepEqual(readMetaFromDisk(root, 'p1').bindings, []);
      assert.ok(mgr.calls.some((c) => c[0] === 'removeBinding' && c[1] === 'p1' && c[2] === 'jira:prod'));
      assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /binding removed: jira:prod from p1/.test(m)));
    });

    it('/sp unuse of absent binding emits "not present" info', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1', ctx);
      await pi.commands.get('sp')!.handler('unuse p1 jira:prod', ctx);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /not present/.test(m)));
    });

    it('/sp unuse with missing args reports usage error', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('unuse p1', ctx);
      assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /Usage: \/sp unuse/.test(m)));
    });

    it('/sp list output includes binding count column for bound scratchpads', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1 --use jira:prod', ctx);
      ctx.notifications.length = 0;
      await pi.commands.get('sp')!.handler('list', ctx);
      const listMsg = ctx.notifications.filter(([l]) => l === 'info').map(([, m]) => m).join('\n');
      assert.match(listMsg, /uses:1/, 'list should show "uses:1" for scratchpad with one binding');
    });

    it('/sp list omits binding column for unbound scratchpads', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1', ctx);
      ctx.notifications.length = 0;
      await pi.commands.get('sp')!.handler('list', ctx);
      const listMsg = ctx.notifications.filter(([l]) => l === 'info').map(([, m]) => m).join('\n');
      assert.doesNotMatch(listMsg, /uses:/, 'list should not show "uses:" for unbound scratchpad');
    });

    it('/sp list shows correct binding count after /sp use', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1', ctx);
      await pi.commands.get('sp')!.handler('use p1 jira:prod', ctx);
      await pi.commands.get('sp')!.handler('use p1 foo:bar', ctx);
      ctx.notifications.length = 0;
      await pi.commands.get('sp')!.handler('list', ctx);
      const listMsg = ctx.notifications.filter(([l]) => l === 'info').map(([, m]) => m).join('\n');
      assert.match(listMsg, /uses:2/);
    });

    it('/sp reset preserves bindings across the respawn', async () => {
      const { pi, ctx } = wire();
      await pi.commands.get('sp')!.handler('new p1 --use jira:prod', ctx);
      assert.deepEqual(readMetaFromDisk(root, 'p1').bindings, ['jira:prod']);
      await pi.commands.get('sp')!.handler('reset p1', ctx);
      // remove() then create() — bindings should survive via the preserved list.
      assert.deepEqual(readMetaFromDisk(root, 'p1').bindings, ['jira:prod']);
    });
  });

  describe('/sp attach staleness banner (Phase 2 Task 16)', () => {
    function wireWithStaleness(lookup: (ref: string) => Promise<string | null>): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
      const pi = makePi();
      const ctx = makeCtx();
      const mgr = makeStub(root, ['p1']);
      const current = { name: null as string | null };
      const deps: SpDeps = {
        getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
        getCurrentName: () => current.name,
        setCurrentName: (n) => { current.name = n; },
        rootDir: () => root,
        getSessionId: () => 'sess-1',
        getWorkspaceCwd: () => '/tmp/test-cwd',
        getStalenessVault: () => ({ lookupLastModified: lookup }),
      } as SpDeps;
      registerSpCommand(pi as unknown as Parameters<typeof registerSpCommand>[0], deps);
      return { pi, ctx, mgr, current };
    }

    it('emits a warning banner when a binding was modified after attach mtime', async () => {
      // Seed p1 with a binding then bump meta.json mtime to a known past time.
      await mkdir(join(root, 'p1'), { recursive: true });
      const metaPath = join(root, 'p1', 'meta.json');
      writeFileSync(metaPath, JSON.stringify({ name: 'p1', bindings: ['jira:prod'], schema_version: 4 }));
      // Backdate the meta mtime by 10 seconds so any "now" lookup is fresher.
      const past = new Date(Date.now() - 10_000);
      const { utimesSync } = await import('node:fs');
      utimesSync(metaPath, past, past);
      // Vault reports the ref was modified just now (after spawn).
      const lookup = async (_ref: string): Promise<string | null> => new Date().toISOString();
      const { pi, ctx } = wireWithStaleness(lookup);
      await pi.commands.get('sp')!.handler('attach p1', ctx);
      const warnings = ctx.notifications.filter(([l]) => l === 'warning');
      assert.equal(warnings.length, 1, 'expected one staleness warning');
      assert.match(warnings[0]![1], /jira:prod was modified after this kernel was spawned/);
    });

    it('does NOT emit a banner when bindings are empty', async () => {
      await mkdir(join(root, 'p1'), { recursive: true });
      writeFileSync(join(root, 'p1', 'meta.json'), JSON.stringify({ name: 'p1', bindings: [], schema_version: 4 }));
      const lookup = async (_ref: string): Promise<string | null> => new Date().toISOString();
      const { pi, ctx } = wireWithStaleness(lookup);
      await pi.commands.get('sp')!.handler('attach p1', ctx);
      assert.equal(ctx.notifications.filter(([l]) => l === 'warning').length, 0);
    });

    it('does NOT emit a banner when getStalenessVault is unset', async () => {
      // wire() does not set getStalenessVault.
      await mkdir(join(root, 'p1'), { recursive: true });
      writeFileSync(join(root, 'p1', 'meta.json'), JSON.stringify({ name: 'p1', bindings: ['jira:prod'], schema_version: 4 }));
      const { pi, ctx } = wire(['p1']);
      await pi.commands.get('sp')!.handler('attach p1', ctx);
      assert.equal(ctx.notifications.filter(([l]) => l === 'warning').length, 0);
    });
  });

  describe('/sp fork bindings copy (Phase 2 Task 16)', () => {
    // The fork-copies-bindings behavior is owned by ScratchpadManager.fork —
    // the sp-command layer just dispatches to manager.fork. The relevant
    // assertion is that manager.fork is invoked (existing test covers that)
    // AND the manager's fork implementation copies meta.bindings (covered by
    // scratchpad-manager.test.ts). Here we add a thin end-to-end check by
    // using a stub fork that mimics the real copy semantics.
    it('/sp fork copies src bindings to dst via manager.fork', async () => {
      const { pi, ctx, mgr } = wire(['p1']);
      // Seed src meta.json with bindings.
      writeMetaToDisk(root, 'p1', { name: 'p1', bindings: ['jira:prod'], schema_version: 4 });
      // Override fork to mimic the real manager: copy src meta.bindings to dst.
      (mgr as unknown as { fork: (s: string, d: string) => Promise<void> }).fork = async (s, d) => {
        const srcMeta = readMetaFromDisk(root, s);
        const srcBindings = Array.isArray(srcMeta.bindings) ? (srcMeta.bindings as string[]) : [];
        writeMetaToDisk(root, d, { name: d, bindings: srcBindings, schema_version: 4 });
      };
      await pi.commands.get('sp')!.handler('fork p1 p2', ctx);
      assert.deepEqual(readMetaFromDisk(root, 'p2').bindings, ['jira:prod']);
    });
  });
});
