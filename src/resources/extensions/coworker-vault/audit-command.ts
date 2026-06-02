// src/resources/extensions/coworker-vault/audit-command.ts
//
// Programmatic reader for the audit log. Resolves duration tokens like
// '1h', '24h', '7d' into ISO-8601 lower bounds, delegates filtering to
// AuditLog.read, and caps the result at `limit` (default 50). Records are
// returned newest-first because AuditLog yields in descending ts order.
import type { AuditRecord } from '@otto/coworker-utils';
import type { VaultBundle } from './vault-singleton.js';

export interface AuditQuery {
  since?: string;                     // '1h' | '24h' | '7d' | ISO-8601
  producer?: string;
  engine?: string;
  action?: string;
  severity?: 'info' | 'warn';
  limit?: number;                     // default 50
}

const DURATION_RE = /^(\d+)([smhd])$/;
const MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function resolveSince(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const m = DURATION_RE.exec(token);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!;
    return new Date(Date.now() - n * MS[unit]!).toISOString();
  }
  return token; // treat as ISO-8601
}

export async function runAudit(
  bundle: VaultBundle,
  q: AuditQuery,
): Promise<AuditRecord[]> {
  const since = resolveSince(q.since);
  const limit = q.limit ?? 50;
  const out: AuditRecord[] = [];
  for await (const r of bundle.audit.read({
    since,
    producer: q.producer,
    action: q.action,
    severity: q.severity,
    engineId: q.engine,
  })) {
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
