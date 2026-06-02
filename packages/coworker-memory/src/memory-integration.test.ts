// packages/coworker-memory/src/memory-integration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from '../../../src/resources/extensions/coworker-memory/memory-singleton.js';
import { runMemorize } from '../../../src/resources/extensions/coworker-memory/memorize-tool.js';
import { runRecall } from '../../../src/resources/extensions/coworker-memory/recall-tool.js';
import { onSessionStart, onSessionShutdown } from '../../../src/resources/extensions/coworker-memory/session-hooks.js';

describe('Memory integration — Day-2 verbatim recall', () => {
  it('paste Monday → recall Tuesday in a fresh session', async () => {
    const homeMon = mkdtempSync(join(tmpdir(), 'mem-home-mon-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-mon-'));
    mkdirSync(ws, { recursive: true });

    // ===== MONDAY =====
    const monBundle = await createMemoryBundle({
      globalDir: homeMon, workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => 'p1-1234',
    });
    await monBundle.recorder.recordPaste({
      sessionId: 'sess-mon',
      content: 'customer says the load balancer started returning 503s around 14:00 UTC; the on-call escalated to the network team at 14:18',
      turnId: 't1',
    });
    await onSessionShutdown(monBundle);

    // Simulate a different Otto process by re-creating the bundle with the same workspace.
    // ===== TUESDAY =====
    const tueBundle = await createMemoryBundle({
      globalDir: homeMon /* same as Monday */, workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => null,
    });
    const start = await onSessionStart(tueBundle, { tokenLimit: 3000 });
    // Layer A was empty Monday, so the inject is empty on Tuesday.
    assert.equal(start.contextBlock, '');
    const r = await runRecall(tueBundle, { query: 'load balancer' });
    assert.equal(r.results.length, 1);
    assert.match(r.results[0]!.drawer.content, /load balancer started returning 503s around 14:00 UTC/);
    assert.equal(r.results[0]!.drawer.room, 'p1-1234');
    assert.match(r.markdown, /drawer:\/\//);
    await onSessionShutdown(tueBundle);
  });
  it('memorize lessons → next session_start injects them', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-A-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-A-'));
    mkdirSync(ws, { recursive: true });
    const b1 = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
    });
    await runMemorize(b1, { text: 'MTTR target is 30 minutes for P1', kind: 'lesson' });
    await runMemorize(b1, { text: 'Always escalate to mgr within 5 min on customer-facing P1', kind: 'rule' });
    await onSessionShutdown(b1);

    const b2 = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
    });
    const start = await onSessionStart(b2, { tokenLimit: 3000 });
    assert.match(start.contextBlock, /MTTR target is 30 minutes/);
    assert.match(start.contextBlock, /Always escalate to mgr/);
    await onSessionShutdown(b2);
  });
  it('secret in paste is redacted; recall surrounding context still works', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-B-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-B-'));
    mkdirSync(ws, { recursive: true });
    const b = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
    });
    await b.recorder.recordPaste({
      sessionId: 's',
      content: 'login token AKIAABCDEFGHIJKLMNOP, used for Datadog API',
      turnId: 't',
    });
    const r = await runRecall(b, { query: 'Datadog' });
    assert.equal(r.results.length, 1);
    assert.match(r.results[0]!.drawer.content, /\[REDACTED:aws_access_key_id\]/);
    assert.equal(r.results[0]!.drawer.content.includes('AKIAABCDEFGHIJKLMNOP'), false);
    assert.equal(r.results[0]!.drawer.redacted, true);
    await onSessionShutdown(b);
  });
});
