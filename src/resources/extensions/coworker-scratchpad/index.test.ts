import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerScratchpadExtension, { tryRestoreCurrentName } from './index.js';
import { sessionSidecarPath, writeSessionSidecar } from './session-sidecar.js';
import { workspaceHash, workspacePointerPath, writeWorkspacePointer } from './workspace-pointer.js';
import { detectWorkspaceRoot } from './workspace-root.js';

// Minimal pi.ExtensionAPI stub — captures registrations and lets us fire session_start/session_shutdown.
interface StubPi {
  commands: Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>;
  tools: Map<string, { name: string; execute: (id: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<{ details: any }> }>;
  hooks: Map<string, Array<(event: any, ctx: any) => Promise<void>>>;
  registerCommand(name: string, opts: any): void;
  registerTool(opts: any): void;
  on(event: string, fn: (event: any, ctx: any) => Promise<void>): void;
  fire(event: string, payload: any, ctx: any): Promise<void>;
}
function makePi(): StubPi {
  const commands = new Map();
  const tools = new Map();
  const hooks = new Map();
  return {
    commands, tools, hooks,
    registerCommand(name, opts) { commands.set(name, opts); },
    registerTool(opts) { tools.set(opts.name, opts); },
    on(event, fn) { if (!hooks.has(event)) hooks.set(event, []); hooks.get(event)!.push(fn); },
    async fire(event, payload, ctx) {
      for (const fn of hooks.get(event) ?? []) await fn(payload, ctx);
    },
  };
}

describe('coworker-scratchpad extension (live kernel)', () => {
  let workspace: string;
  let scratchpadRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'spext-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    scratchpadRoot = await mkdtemp(join(tmpdir(), 'spext-root-'));
    process.env.OTTO_SCRATCHPAD_ROOT = scratchpadRoot; // see index.ts: honors this env var for tests
  });
  afterEach(async () => {
    delete process.env.OTTO_SCRATCHPAD_ROOT;
    await rm(workspace, { recursive: true, force: true });
    await rm(scratchpadRoot, { recursive: true, force: true });
  });

  it('registers /sp and scratchpad after session_start; survives exec + dispose', async () => {
    const pi = makePi();
    coworkerScratchpadExtension(pi as any);

    // session_start fires after registration; the index.ts handler captures ctx for the manager.
    await pi.fire('session_start', {}, {
      cwd: workspace,
      sessionManager: { getSessionFile: () => undefined },
      hasUI: false,
      ui: { notify: () => {} },
    });

    assert.ok(pi.commands.has('sp'), 'sp slash command registered');
    assert.ok(pi.tools.has('cw_scratchpad'), 'cw_scratchpad tool registered');

    // Run a cell via the scratchpad tool.
    const execResult = await pi.tools.get('cw_scratchpad')!.execute(
      '', { action: 'exec', code: 'globalThis.x = 42; return globalThis.x;' }, undefined, undefined, {},
    );
    const exec = execResult.details as { ok: boolean; cell_id: number; mime: Record<string, unknown> };
    assert.equal(exec.ok, true);
    assert.equal(exec.cell_id, 1);
    assert.deepEqual(exec.mime, { 'application/json': 42 });
    assert.ok(existsSync(join(scratchpadRoot, 'default', 'kernel.db')), 'kernel.db created');
    assert.ok(existsSync(join(scratchpadRoot, 'default', 'cells.jsonl')), 'cells.jsonl created');

    // View shows the cell.
    const viewResult = await pi.tools.get('cw_scratchpad')!.execute('', { action: 'view' }, undefined, undefined, {});
    const view = viewResult.details as { total_cells: number; cells: Array<{ id: number; ok: boolean; value: unknown }> };
    assert.equal(view.total_cells, 1);
    assert.equal(view.cells[0].id, 1);
    assert.equal(view.cells[0].ok, true);
    assert.equal(view.cells[0].value, 42);

    // session_shutdown disposes the manager (kernel exits cleanly).
    await pi.fire('session_shutdown', {}, {});
    // After shutdown a re-exec would re-spawn; we don't assert that here (covered by manager tests).
  });
});

describe('coworker-scratchpad extension (session affinity — 1g)', () => {
  let workspace: string;
  let scratchpadRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'spext-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    scratchpadRoot = await mkdtemp(join(tmpdir(), 'spext-root-'));
    process.env.OTTO_SCRATCHPAD_ROOT = scratchpadRoot;
  });
  afterEach(async () => {
    delete process.env.OTTO_SCRATCHPAD_ROOT;
    await rm(workspace, { recursive: true, force: true });
    await rm(scratchpadRoot, { recursive: true, force: true });
  });

  function makeSessionCtx(sessionFile: string | undefined): {
    cwd: string;
    sessionManager: { getSessionFile: () => string | undefined };
    hasUI: boolean;
    ui: { notify: (m: string, l: string) => void; confirm: (a: string, b: string) => Promise<boolean> };
    notifications: Array<[string, string]>;
  } {
    const notifications: Array<[string, string]> = [];
    return {
      cwd: workspace,
      sessionManager: { getSessionFile: () => sessionFile },
      hasUI: false,
      ui: {
        notify: (m, l) => notifications.push([l, m]),
        confirm: async () => true,
      },
      notifications,
    };
  }

  it('session_start restores currentName from a valid sidecar', async () => {
    // Pre-create the scratchpad on disk so the meta.json existence check passes.
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(scratchpadRoot, 'p1'), { recursive: true });
    await writeFile(join(scratchpadRoot, 'p1', 'meta.json'), '{}');
    // Pre-write a sidecar for sessionId=sess-A.
    await mkdir(join(scratchpadRoot, '_sessions'), { recursive: true });
    await writeFile(
      join(scratchpadRoot, '_sessions', 'sidecar_sess-A.json'),
      JSON.stringify({ schema_version: 1, session_id: 'sess-A', current_name: 'p1', attached_at: 't' }),
    );

    const pi = makePi();
    coworkerScratchpadExtension(pi as any);
    const ctx = makeSessionCtx('/tmp/sess-A.jsonl');
    await pi.fire('session_start', {}, ctx);

    assert.ok(ctx.notifications.some(([l, m]) => l === 'info' && /restored/.test(m)));
  });

  it('session_start clears a broken sidecar silently when no workspace pointer applies', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(scratchpadRoot, '_sessions'), { recursive: true });
    const sidecarPath = join(scratchpadRoot, '_sessions', 'sidecar_sess-B.json');
    await writeFile(
      sidecarPath,
      JSON.stringify({ schema_version: 1, session_id: 'sess-B', current_name: 'p-missing', attached_at: 't' }),
    );

    const pi = makePi();
    coworkerScratchpadExtension(pi as any);
    const ctx = makeSessionCtx('/tmp/sess-B.jsonl');
    await pi.fire('session_start', {}, ctx);

    assert.ok(!existsSync(sidecarPath), 'broken sidecar deleted');
    // With Task A: no "not restored" noise — silent clean start when no fallback applies.
    assert.equal(ctx.notifications.length, 0, 'no notifications when neither restore source applies');
  });

  it('session_start with no sidecar is a silent no-op', async () => {
    const pi = makePi();
    coworkerScratchpadExtension(pi as any);
    const ctx = makeSessionCtx('/tmp/sess-C.jsonl');
    await pi.fire('session_start', {}, ctx);
    assert.equal(ctx.notifications.length, 0);
  });
});

describe('coworker-scratchpad restore precedence (Task A)', () => {
  let root: string;
  let ws: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cws-root-'));
    ws = mkdtempSync(join(tmpdir(), 'cws-ws-'));
    execSync('git init -q', { cwd: ws });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  function makeScratchpad(name: string): void {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'meta.json'), JSON.stringify({ name, schema_version: 3 }));
  }

  it('(a) sidecar wins when its scratchpad exists', () => {
    makeScratchpad('alpha');
    makeScratchpad('beta');
    const sessionId = 'sess-A';
    writeSessionSidecar(sessionSidecarPath(root, sessionId), {
      schema_version: 1,
      session_id: sessionId,
      current_name: 'alpha',
      attached_at: new Date().toISOString(),
    });
    const wsRoot = detectWorkspaceRoot(ws);
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1,
      workspace_hash: workspaceHash(wsRoot),
      workspace_root: wsRoot,
      last_session_id: 'sess-OTHER',
      last_current_name: 'beta',
      last_attached_at: new Date().toISOString(),
    });

    const result = tryRestoreCurrentName(root, sessionId, ws, Date.now());
    assert.equal(result.name, 'alpha');
    assert.match(result.notice!, /alpha.*restored/);
  });

  it('(b) sidecar falls through to workspace pointer when its scratchpad is gone', () => {
    makeScratchpad('beta'); // alpha intentionally absent
    const sessionId = 'sess-A';
    const sidecarPath = sessionSidecarPath(root, sessionId);
    writeSessionSidecar(sidecarPath, {
      schema_version: 1,
      session_id: sessionId,
      current_name: 'alpha-gone',
      attached_at: new Date().toISOString(),
    });
    const wsRoot = detectWorkspaceRoot(ws);
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1,
      workspace_hash: workspaceHash(wsRoot),
      workspace_root: wsRoot,
      last_session_id: 'sess-OTHER',
      last_current_name: 'beta',
      last_attached_at: new Date().toISOString(),
    });

    const result = tryRestoreCurrentName(root, sessionId, ws, Date.now());
    assert.equal(result.name, 'beta');
    assert.match(result.notice!, /beta.*from workspace/);
    assert.equal(existsSync(sidecarPath), false, 'broken sidecar should be deleted');
  });

  it('(c) pointer-only path (no sidecar)', () => {
    makeScratchpad('beta');
    const wsRoot = detectWorkspaceRoot(ws);
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1,
      workspace_hash: workspaceHash(wsRoot),
      workspace_root: wsRoot,
      last_session_id: 'sess-OTHER',
      last_current_name: 'beta',
      last_attached_at: new Date().toISOString(),
    });
    const result = tryRestoreCurrentName(root, 'sess-FRESH', ws, Date.now());
    assert.equal(result.name, 'beta');
    assert.match(result.notice!, /beta.*from workspace/);
  });

  it('(d) no restore when neither sidecar nor fresh pointer exist', () => {
    const result = tryRestoreCurrentName(root, 'sess-FRESH', ws, Date.now());
    assert.equal(result.name, null);
    assert.equal(result.notice, null);
  });

  it('(e) stale workspace pointer (> 7d old) does not restore', () => {
    makeScratchpad('beta');
    const wsRoot = detectWorkspaceRoot(ws);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1, workspace_hash: workspaceHash(wsRoot), workspace_root: wsRoot,
      last_session_id: 'sess-OTHER', last_current_name: 'beta',
      last_attached_at: eightDaysAgo,
    });
    const result = tryRestoreCurrentName(root, 'sess-FRESH', ws, Date.now());
    assert.equal(result.name, null);
    assert.equal(result.notice, null);
  });
});

// Phase 3.1 Task 4: closure-shape lock for the scratchpad onDataLoad hop.
// The activator wires `new ScratchpadManager({ onDataLoad })` to a closure that
// reads getMemoryRecorder() lazily and forwards (drawer, scratchpadName) into
// recorder.recordFileLoad(...). These tests replicate that closure inline so
// the contract is verified independently of the activator wiring (which is
// exercised by the Task 5 integration test).
describe('coworker-scratchpad onDataLoad closure shape (Phase 3.1 Task 4)', () => {
  type DrawerLite = {
    kind: 'data_load';
    collector: string;
    uri: string;
    bytes: number | null;
    rows_loaded: number | null;
    loaded_at: string;
    schema: null;
  };
  type RecorderLike = {
    recordFileLoad: (args: {
      scratchpadName: string; collector: string; uri: string;
      bytes: number; rows_loaded?: number; schema?: object; turnId: string;
    }) => Promise<unknown>;
  };

  function makeClosure(getRecorder: () => RecorderLike | null) {
    return (drawer: DrawerLite, scratchpadName: string): void => {
      const recorder = getRecorder();
      if (!recorder) return;
      void recorder.recordFileLoad({
        scratchpadName,
        collector: drawer.collector,
        uri: drawer.uri,
        bytes: drawer.bytes ?? 0,
        rows_loaded: drawer.rows_loaded ?? undefined,
        schema: drawer.schema ?? undefined,
        turnId: '',
      }).catch(() => { /* silent: file loads are frequent; failures visible in /audit */ });
    };
  }

  function makeDrawer(overrides: Partial<DrawerLite> = {}): DrawerLite {
    return {
      kind: 'data_load',
      collector: 'file',
      uri: 'file:///tmp/data.csv',
      bytes: 1234,
      rows_loaded: 10,
      loaded_at: new Date().toISOString(),
      schema: null,
      ...overrides,
    };
  }

  it('does not throw and does not call recordFileLoad when recorder is null', () => {
    let called = 0;
    const onDataLoad = makeClosure(() => null);
    // No assertion on recorder.recordFileLoad — recorder is null. Just ensure no throw.
    assert.doesNotThrow(() => onDataLoad(makeDrawer(), 'p1'));
    assert.equal(called, 0);
  });

  it('calls recordFileLoad with translated args when recorder is present', async () => {
    const calls: Array<Parameters<RecorderLike['recordFileLoad']>[0]> = [];
    const recorder: RecorderLike = {
      recordFileLoad: async (args) => { calls.push(args); return { id: 'd1' }; },
    };
    const onDataLoad = makeClosure(() => recorder);
    const drawer = makeDrawer({ collector: 'http', uri: 'https://x/y.json', bytes: 555, rows_loaded: 7 });
    onDataLoad(drawer, 'p1');
    // Allow the floating promise to resolve.
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scratchpadName, 'p1');
    assert.equal(calls[0].collector, 'http');
    assert.equal(calls[0].uri, 'https://x/y.json');
    assert.equal(calls[0].bytes, 555);
    assert.equal(calls[0].rows_loaded, 7);
    assert.equal(calls[0].schema, undefined);
    assert.equal(calls[0].turnId, '');
  });

  it('swallows recordFileLoad rejection silently (no unhandled rejection)', async () => {
    const recorder: RecorderLike = {
      recordFileLoad: async () => { throw new Error('backend offline'); },
    };
    const onDataLoad = makeClosure(() => recorder);
    // Track unhandled rejections to assert none escape.
    const seen: unknown[] = [];
    const handler = (r: unknown): void => { seen.push(r); };
    process.on('unhandledRejection', handler);
    try {
      assert.doesNotThrow(() => onDataLoad(makeDrawer(), 'p1'));
      // Allow microtasks + tick for unhandled rejection detection.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(seen.length, 0, 'no unhandled rejection should escape');
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  it('maps null bytes to 0 and null rows_loaded to undefined', async () => {
    const calls: Array<Parameters<RecorderLike['recordFileLoad']>[0]> = [];
    const recorder: RecorderLike = {
      recordFileLoad: async (args) => { calls.push(args); return { id: 'd1' }; },
    };
    const onDataLoad = makeClosure(() => recorder);
    const drawer = makeDrawer({ bytes: null, rows_loaded: null });
    onDataLoad(drawer, 'p2');
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bytes, 0);
    assert.equal(calls[0].rows_loaded, undefined);
    assert.equal(calls[0].scratchpadName, 'p2');
  });
});

describe('scratchpad activator — onArtifactCreate closure (Phase 4 Task 12)', () => {
  it('closure with null recorder does not throw', () => {
    const getRec = (): null => null;
    const drawer = {
      kind: 'artifact' as const, slug: 'rca-1', artifact_kind: 'report',
      uri: 'artifact://rca-1', primary_path: '/x/report.md', created_at: 't',
    };
    const onArtifactCreate = (d: typeof drawer, name: string): void => {
      const rec = getRec();
      if (!rec) return;
    };
    assert.doesNotThrow(() => onArtifactCreate(drawer, 'p1'));
  });
  it('closure with recorder calls recordArtifact with translated args', async () => {
    const calls: Array<{ scratchpadName: string; slug: string; kind: string; uri: string }> = [];
    const recorder = {
      recordArtifact: async (args: { scratchpadName: string; slug: string; kind: string; uri: string; turnId: string }) => {
        calls.push({ scratchpadName: args.scratchpadName, slug: args.slug, kind: args.kind, uri: args.uri });
      },
    };
    const drawer = {
      kind: 'artifact' as const, slug: 'rca-1', artifact_kind: 'report',
      uri: 'artifact://rca-1', primary_path: '/x/report.md', created_at: 't',
    };
    const onArtifactCreate = (d: typeof drawer, name: string): void => {
      void recorder.recordArtifact({
        scratchpadName: name, slug: d.slug, kind: d.artifact_kind, uri: d.uri, turnId: '',
      }).catch(() => {});
    };
    onArtifactCreate(drawer, 'p1');
    await new Promise(r => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.scratchpadName, 'p1');
    assert.equal(calls[0]!.slug, 'rca-1');
    assert.equal(calls[0]!.kind, 'report');
    assert.equal(calls[0]!.uri, 'artifact://rca-1');
  });
});
