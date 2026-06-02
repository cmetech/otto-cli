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

describe('/memory show (Phase 3.1 follow-up: issue #73)', () => {
  it('show with no args dumps profile + rules + lessons for read scopes (per-project-tagged → workspace first then global)', async () => {
    const b = await setup();
    await b.workspaceLayerA.append({ kind: 'lesson', text: 'mttr is 30m', source: 'user', ts: '2026-06-02T10:00:00Z' });
    await b.workspaceLayerA.append({ kind: 'rule', text: 'escalate P1 to mgr', source: 'user', ts: '2026-06-02T10:00:00Z' });
    await b.globalLayerA.append({ kind: 'profile', text: 'prefer polars', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const out = await runMemoryCommand(b, ['show']);
    assert.match(out.message, /## Lessons \(workspace\)/);
    assert.match(out.message, /mttr is 30m/);
    assert.match(out.message, /## Rules \(workspace\)/);
    assert.match(out.message, /escalate P1 to mgr/);
    assert.match(out.message, /## Profile \(global\)/);
    assert.match(out.message, /prefer polars/);
    // workspace appears before global
    assert.ok(out.message.indexOf('workspace') < out.message.indexOf('global'));
    await b.dispose();
  });
  it('show lessons dumps only lessons.md', async () => {
    const b = await setup();
    await b.workspaceLayerA.append({ kind: 'lesson', text: 'l1', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await b.workspaceLayerA.append({ kind: 'rule', text: 'r1', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const out = await runMemoryCommand(b, ['show', 'lessons']);
    assert.match(out.message, /l1/);
    assert.equal(out.message.includes('r1'), false);
    await b.dispose();
  });
  it('show with --scope global reads global only', async () => {
    const b = await setup();
    await b.workspaceLayerA.append({ kind: 'lesson', text: 'ws-only', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await b.globalLayerA.append({ kind: 'lesson', text: 'global-only', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const out = await runMemoryCommand(b, ['show', 'lessons', '--scope', 'global']);
    assert.match(out.message, /global-only/);
    assert.equal(out.message.includes('ws-only'), false);
    await b.dispose();
  });
  it('show missing layer outputs "(none)"', async () => {
    const b = await setup();
    // No appends — both stores empty
    const out = await runMemoryCommand(b, ['show', 'rules']);
    assert.match(out.message, /\(none\)/);
    await b.dispose();
  });
  it('show with invalid kind errors with usage', async () => {
    const b = await setup();
    await assert.rejects(() => runMemoryCommand(b, ['show', 'banana']));
    await b.dispose();
  });
});

describe('/memory recall (Phase 3.1 follow-up: issue #73)', () => {
  it('recall <query> returns formatted markdown matching the recall LLM tool', async () => {
    const b = await setup();
    await b.recorder.recordPaste({
      sessionId: 's', content: 'load balancer returned 503s around 14:00 UTC', turnId: 't1',
    });
    const out = await runMemoryCommand(b, ['recall', 'load', 'balancer']);
    assert.match(out.message, /Memory recall \(1 matches\)/);
    assert.match(out.message, /<mark>/);
    assert.match(out.message, /drawer:\/\//);
    await b.dispose();
  });
  it('recall with no args errors with usage notice', async () => {
    const b = await setup();
    await assert.rejects(() => runMemoryCommand(b, ['recall']));
    await b.dispose();
  });
  it('recall --kind paste filters to paste drawers', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'short alpha', turnId: 't1' });
    await b.recorder.recordPaste({ sessionId: 's', content: 'long alpha paste body', turnId: 't2' });
    const out = await runMemoryCommand(b, ['recall', 'alpha', '--kind', 'paste']);
    assert.match(out.message, /Memory recall \(1 matches\)/);
    await b.dispose();
  });
  it('recall --limit clamps to [1, 64]', async () => {
    const b = await setup();
    for (let i = 0; i < 10; i++) {
      await b.recorder.recordTurn({ sessionId: 's', userText: `apple ${i}`, turnId: `t${i}` });
    }
    const out = await runMemoryCommand(b, ['recall', 'apple', '--limit', '3']);
    // Markdown header reports actual count, which should be 3 due to clamp
    assert.match(out.message, /Memory recall \(3 matches\)/);
    await b.dispose();
  });
});
