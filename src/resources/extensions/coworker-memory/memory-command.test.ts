// src/resources/extensions/coworker-memory/memory-command.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { runMemoryCommand } from './memory-command.js';

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'mc-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'mc-ws-'));
  mkdirSync(ws, { recursive: true });
  return createMemoryBundle({
    globalDir: home, workspaceDir: ws,
    scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
  });
}

describe('/memory command', () => {
  it('note appends a lesson', async () => {
    const b = await setup();
    const out = await runMemoryCommand(b, ['note', 'P1 includes MTTR']);
    assert.match(out.message, /lesson stored/i);
    assert.match(await b.workspaceLayerA.read('lesson'), /P1 includes MTTR/);
    await b.dispose();
  });
  it('status reports workspace_wing + drawer_count', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'x', turnId: 't' });
    const out = await runMemoryCommand(b, ['status']);
    assert.match(out.message, /workspace_wing:/);
    assert.match(out.message, /drawer_count: 1/);
    await b.dispose();
  });
  it('clear --wing deletes drawers', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'x', turnId: 't' });
    const out = await runMemoryCommand(b, ['clear', '--wing', b.writeWing, '--confirm']);
    assert.match(out.message, /deleted: 1/);
    await b.dispose();
  });
  it('clear without --confirm errors', async () => {
    const b = await setup();
    await assert.rejects(() => runMemoryCommand(b, ['clear', '--wing', 'x']));
    await b.dispose();
  });
});
