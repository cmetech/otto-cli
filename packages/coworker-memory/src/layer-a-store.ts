// packages/coworker-memory/src/layer-a-store.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import type { LayerAEntry, LayerAKind } from './types.js';
import { LayerAWriteBlocked, MemoryEntryMalformed } from './errors.js';

const FILE_FOR: Record<LayerAKind, string> = {
  profile: 'profile.md',
  rule: 'rules.md',
  lesson: 'lessons.md',
};

const TITLE_FOR: Record<LayerAKind, string> = {
  profile: 'Profile',
  rule: 'Rules',
  lesson: 'Lessons',
};

export interface LayerAStoreOptions {
  scopeDir: string;             // absolute path to scope's memory dir
  scope: 'global' | 'workspace';
  audit: AuditLog;
  scanner: SecretScanner;
}

export class LayerAStore {
  constructor(private readonly opts: LayerAStoreOptions) {}

  async append(entry: LayerAEntry): Promise<void> {
    const hits = this.opts.scanner.scan(entry.text);
    if (hits.length > 0) {
      this.opts.audit.append({
        _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'block', severity: 'warn',
        detail: { scope: this.opts.scope, kind: entry.kind, reason: 'secret', secret_kind: hits[0]!.kind },
      });
      throw new LayerAWriteBlocked(hits[0]!.kind);
    }
    mkdirSync(this.opts.scopeDir, { recursive: true, mode: 0o700 });
    const path = join(this.opts.scopeDir, FILE_FOR[entry.kind]);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const { body } = existing ? this.split(existing, path) : { body: '' };
    const addition = entry.kind === 'lesson'
      ? `- (${entry.ts}) ${entry.text}\n`
      : `## ${entry.ts}\n${entry.text}\n\n`;
    const newBody = (body && !body.endsWith('\n') ? body + '\n' : body) + addition;
    const newFile = this.composeFile(entry.kind, newBody, entry.ts, entry.source);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, newFile, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    this.opts.audit.append({
      _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'write-layer-a',
      detail: { scope: this.opts.scope, kind: entry.kind, source: entry.source, byte_count: Buffer.byteLength(entry.text, 'utf8') },
    });
  }

  async read(kind: LayerAKind): Promise<string> {
    const path = join(this.opts.scopeDir, FILE_FOR[kind]);
    if (!existsSync(path)) return '';
    const raw = readFileSync(path, 'utf8');
    const { body } = this.split(raw, path);
    return body.trim();
  }

  private split(raw: string, path: string): { frontmatter: Record<string, unknown>; body: string } {
    if (!raw.startsWith('---')) {
      return { frontmatter: {}, body: raw };
    }
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0) throw new MemoryEntryMalformed(path, 'unterminated frontmatter');
    try {
      const fm = parseYaml(raw.slice(4, end)) as Record<string, unknown>;
      const body = raw.slice(end + 5);
      return { frontmatter: fm ?? {}, body };
    } catch (err) {
      throw new MemoryEntryMalformed(path, `frontmatter parse: ${(err as Error).message}`);
    }
  }

  private composeFile(kind: LayerAKind, body: string, ts: string, source: LayerAEntry['source']): string {
    const fm = { schema_version: 1, last_modified_at: ts, source };
    const fmStr = stringifyYaml(fm).trimEnd();
    const header = `---\n${fmStr}\n---\n\n# ${TITLE_FOR[kind]}\n\n`;
    return header + body.replace(new RegExp(`^\\n?# ${TITLE_FOR[kind]}\\n\\n?`), '');
  }
}
