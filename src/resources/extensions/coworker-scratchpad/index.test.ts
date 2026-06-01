import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerScratchpadExtension from './index.js';

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
    assert.ok(pi.tools.has('scratchpad'), 'scratchpad tool registered');

    // Run a cell via the scratchpad tool.
    const execResult = await pi.tools.get('scratchpad')!.execute(
      '', { action: 'exec', code: 'globalThis.x = 42; return globalThis.x;' }, undefined, undefined, {},
    );
    const exec = execResult.details as { ok: boolean; cell_id: number; mime: Record<string, unknown> };
    assert.equal(exec.ok, true);
    assert.equal(exec.cell_id, 1);
    assert.deepEqual(exec.mime, { 'application/json': 42 });
    assert.ok(existsSync(join(scratchpadRoot, 'default', 'kernel.db')), 'kernel.db created');
    assert.ok(existsSync(join(scratchpadRoot, 'default', 'cells.jsonl')), 'cells.jsonl created');

    // View shows the cell.
    const viewResult = await pi.tools.get('scratchpad')!.execute('', { action: 'view' }, undefined, undefined, {});
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
