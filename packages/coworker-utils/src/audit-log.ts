import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditRecord {
  _schema: 1;
  ts: string;
  producer: string;
  action: string;
  severity?: 'info' | 'warn';
  sessionId?: string;
  scratchpadName?: string;
  pid?: number;
  detail: Record<string, unknown>;
}

export interface AuditLogOptions {
  path: string;
  maxBytes?: number;
  maxTails?: number;
}

export interface AuditFilter {
  since?: string;             // ISO-8601 lower bound (inclusive)
  producer?: string;
  action?: string;
  severity?: 'info' | 'warn';
  engineId?: string;          // matches detail.engine if present
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TAILS = 5;

export class AuditLog {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly maxTails: number;

  constructor(opts: AuditLogOptions) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxTails = opts.maxTails ?? DEFAULT_MAX_TAILS;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
  }

  append(record: AuditRecord): void {
    this.rotateIfNeeded();
    const line = JSON.stringify(record) + '\n';
    try {
      appendFileSync(this.path, line, { mode: 0o600 });
    } catch (err) {
      process.stderr.write(`audit: write failed (${(err as Error).message}); continuing\n`);
    }
  }

  async *read(filter: AuditFilter): AsyncIterable<AuditRecord> {
    const files = this.listLogFiles();
    const records: AuditRecord[] = [];
    for (const f of files) {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const rec = JSON.parse(line) as AuditRecord;
          if (!this.matches(rec, filter)) continue;
          records.push(rec);
        } catch { /* skip malformed line */ }
      }
    }
    records.sort((a, b) => (a.ts === b.ts ? 0 : a.ts < b.ts ? 1 : -1));
    for (const r of records) yield r;
  }

  private listLogFiles(): string[] {
    const out = [this.path];
    for (let n = 1; n <= this.maxTails; n++) {
      out.push(`${this.path.replace(/\.jsonl$/, '')}.${n}.jsonl`);
    }
    return out;
  }

  private matches(rec: AuditRecord, f: AuditFilter): boolean {
    if (f.producer && rec.producer !== f.producer) return false;
    if (f.action && rec.action !== f.action) return false;
    if (f.severity && rec.severity !== f.severity) return false;
    if (f.since && rec.ts < f.since) return false;
    if (f.engineId && (rec.detail as { engine?: string }).engine !== f.engineId) return false;
    return true;
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size < this.maxBytes) return;
    // Find next available tail slot; if maxTails full, drop tail N (delete) before shifting.
    const base = this.path.replace(/\.jsonl$/, '');
    const tailN = `${base}.${this.maxTails}.jsonl`;
    if (existsSync(tailN)) unlinkSync(tailN);
    for (let n = this.maxTails - 1; n >= 1; n--) {
      const src = `${base}.${n}.jsonl`;
      const dst = `${base}.${n + 1}.jsonl`;
      if (existsSync(src)) renameSync(src, dst);
    }
    renameSync(this.path, `${base}.1.jsonl`);
    closeSync(openSync(this.path, 'w', 0o600));
  }
}
