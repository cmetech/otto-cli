// packages/coworker-memory/src/layer-a-store.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LayerAStore } from './layer-a-store.js';
import { LayerAWriteBlocked } from './errors.js';

function ctx() {
  const root = mkdtempSync(join(tmpdir(), 'la-'));
  return {
    root,
    audit: new AuditLog({ path: join(root, 'audit.jsonl') }),
    scanner: new SecretScanner(),
    dir: join(root, 'memory'),
  };
}

describe('LayerAStore', () => {
  it('append lesson creates lessons.md with frontmatter and bullet', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'lesson', text: 'MTTR target is 30 minutes for P1', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const md = readFileSync(join(c.dir, 'lessons.md'), 'utf8');
    assert.match(md, /^---\nschema_version: 1\n/);
    assert.match(md, /- \(2026-06-02T10:00:00Z\) MTTR target is 30 minutes for P1/);
  });
  it('append profile uses timestamped section', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'profile', text: 'Prefers polars over pandas.', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const md = readFileSync(join(c.dir, 'profile.md'), 'utf8');
    assert.match(md, /## 2026-06-02T10:00:00Z\nPrefers polars over pandas\./);
  });
  it('throws LayerAWriteBlocked when text contains a secret pattern', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await assert.rejects(
      () => store.append({ kind: 'rule', text: 'use AKIAABCDEFGHIJKLMNOP', source: 'user', ts: '2026-06-02T10:00:00Z' }),
      LayerAWriteBlocked,
    );
    assert.equal(existsSync(join(c.dir, 'rules.md')), false);
  });
  it('read returns parsed content with frontmatter stripped', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'rule', text: 'Always include MTTR in RCA.', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const body = await store.read('rule');
    assert.match(body, /Always include MTTR in RCA\./);
    assert.equal(body.startsWith('---'), false);
  });
  it('read returns empty string when file missing', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    assert.equal(await store.read('lesson'), '');
  });
  it('emits write-layer-a audit on success', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'lesson', text: 'short lesson', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const rows: { action: string }[] = [];
    for await (const r of c.audit.read({ producer: 'memory', action: 'write-layer-a' })) rows.push(r as never);
    assert.equal(rows.length, 1);
  });
});
