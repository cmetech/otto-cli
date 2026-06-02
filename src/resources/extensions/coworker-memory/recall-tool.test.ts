// src/resources/extensions/coworker-memory/recall-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { runRecall } from './recall-tool.js';

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'rt-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'rt-ws-'));
  mkdirSync(ws, { recursive: true });
  return createMemoryBundle({
    globalDir: home, workspaceDir: ws,
    scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
  });
}

describe('recall tool', () => {
  it('returns results with markdown rendering', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'customer paste about load balancer', turnId: 't1' });
    const r = await runRecall(b, { query: 'load balancer' });
    assert.equal(r.results.length, 1);
    assert.match(r.markdown, /Memory recall \(1 matches\)/);
    assert.match(r.markdown, /drawer:\/\//);
    await b.dispose();
  });
  it('honors max_results clamp 1..64', async () => {
    const b = await setup();
    for (let i = 0; i < 100; i++) {
      await b.recorder.recordTurn({ sessionId: 's', userText: `apple ${i}`, turnId: `t${i}` });
    }
    const big = await runRecall(b, { query: 'apple', max_results: 200 });
    assert.ok(big.results.length <= 64);
    const small = await runRecall(b, { query: 'apple', max_results: 0 });
    assert.equal(small.results.length, 1);
    await b.dispose();
  });
  it('filters by kind', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'short alpha', turnId: 't1' });
    await b.recorder.recordPaste({ sessionId: 's', content: 'long alpha paste', turnId: 't2' });
    const onlyPaste = await runRecall(b, { query: 'alpha', kind: 'paste' });
    assert.equal(onlyPaste.results.length, 1);
    assert.equal(onlyPaste.results[0]!.drawer.kind, 'paste');
    await b.dispose();
  });
});
