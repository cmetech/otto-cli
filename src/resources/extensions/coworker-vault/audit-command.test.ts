// src/resources/extensions/coworker-vault/audit-command.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditRecord } from '@otto/coworker-utils';
import { createVaultBundle, type VaultBundle } from './vault-singleton.js';
import { runAudit } from './audit-command.js';

async function freshBundle(): Promise<VaultBundle> {
  const root = mkdtempSync(join(tmpdir(), 'audit-cmd-'));
  return createVaultBundle({ globalDir: join(root, 'global') });
}

function record(overrides: Partial<AuditRecord> & { ts: string }): AuditRecord {
  return {
    _schema: 1,
    producer: 'vault',
    action: 'set',
    detail: {},
    ...overrides,
  };
}

describe('/audit', () => {
  it('returns last 50 records by default, newest first', async () => {
    const bundle = await freshBundle();
    const base = Date.now();
    for (let i = 0; i < 60; i++) {
      bundle.audit.append(
        record({ ts: new Date(base + i * 1000).toISOString() }),
      );
    }
    const out = await runAudit(bundle, {});
    assert.equal(out.length, 50);
    // newest first → ts strictly decreasing
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1]!.ts > out[i]!.ts, `expected ${out[i - 1]!.ts} > ${out[i]!.ts}`);
    }
    // Newest record overall must be first
    const expectedNewest = new Date(base + 59 * 1000).toISOString();
    assert.equal(out[0]!.ts, expectedNewest);
  });

  it('filters by producer', async () => {
    const bundle = await freshBundle();
    const now = Date.now();
    bundle.audit.append(
      record({
        ts: new Date(now).toISOString(),
        producer: 'vault',
        action: 'set',
      }),
    );
    bundle.audit.append(
      record({
        ts: new Date(now + 1000).toISOString(),
        producer: 'secret-scanner',
        action: 'redact',
      }),
    );
    const out = await runAudit(bundle, { producer: 'secret-scanner' });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.producer, 'secret-scanner');
    assert.equal(out[0]!.action, 'redact');
  });

  it('filters by engine via detail.engine', async () => {
    const bundle = await freshBundle();
    const now = Date.now();
    bundle.audit.append(
      record({
        ts: new Date(now).toISOString(),
        producer: 'vault',
        action: 'set',
        detail: { engine: 'jira' },
      }),
    );
    bundle.audit.append(
      record({
        ts: new Date(now + 1000).toISOString(),
        producer: 'vault',
        action: 'set',
        detail: { engine: 'datadog' },
      }),
    );
    const out = await runAudit(bundle, { engine: 'jira' });
    assert.equal(out.length, 1);
    assert.equal((out[0]!.detail as { engine?: string }).engine, 'jira');
  });

  it('--since filter accepts duration tokens (1h, 24h, 7d)', async () => {
    const bundle = await freshBundle();
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const thirtySecondsAgo = new Date(now - 30 * 1000).toISOString();
    bundle.audit.append(
      record({ ts: twoHoursAgo, action: 'old' }),
    );
    bundle.audit.append(
      record({ ts: thirtySecondsAgo, action: 'recent' }),
    );
    const out = await runAudit(bundle, { since: '1h' });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.action, 'recent');
    assert.equal(out[0]!.ts, thirtySecondsAgo);
  });
});
