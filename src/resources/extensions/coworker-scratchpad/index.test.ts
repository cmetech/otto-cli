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
      join(scratchpadRoot, '_sessions', 'sess-A.json'),
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
    const sidecarPath = join(scratchpadRoot, '_sessions', 'sess-B.json');
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
});
