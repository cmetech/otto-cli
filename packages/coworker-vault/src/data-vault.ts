// packages/coworker-vault/src/data-vault.ts
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { AuditLog, type AuditRecord } from '@otto/coworker-utils';
import type { EntryRef, VaultEntry, VaultScope } from './types.js';
import { BindingRefMalformed, VaultEntryMalformed, VaultEntryNotFound } from './errors.js';

export interface LocalDataVaultOptions {
  globalDir: string;
  workspaceDir?: string;
  audit: AuditLog;
  now?: () => string;
}

export interface ListedEntry {
  engine: string;
  name: string;
  scope: VaultScope;
  fields_set: string[];
  last_modified_at: string;
}

const REF_RE = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/;

export class LocalDataVault {
  private readonly globalRoot: string;
  private readonly workspaceRoot?: string;
  private readonly audit: AuditLog;
  private readonly now: () => string;

  constructor(opts: LocalDataVaultOptions) {
    this.globalRoot = opts.globalDir;
    this.workspaceRoot = opts.workspaceDir;
    this.audit = opts.audit;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.sweepOrphans(this.globalVaultDir());
    const ws = this.workspaceVaultDir();
    if (ws) this.sweepOrphans(ws);
  }

  static parseRef(input: string): EntryRef {
    const m = REF_RE.exec(input);
    if (!m) throw new BindingRefMalformed(input);
    return { engine: m[1]!, name: m[2]! };
  }

  static formatRef(ref: EntryRef): string {
    return `${ref.engine}:${ref.name}`;
  }

  private globalVaultDir(): string {
    return join(this.globalRoot, 'data_vault');
  }

  private workspaceVaultDir(): string | undefined {
    return this.workspaceRoot ? join(this.workspaceRoot, 'data_vault') : undefined;
  }

  private fileNameFor(ref: EntryRef): string {
    return `${ref.engine}-${ref.name}.json`;
  }

  private resolveScope(ref: EntryRef): { dir: string; scope: VaultScope } | null {
    const ws = this.workspaceVaultDir();
    if (ws && existsSync(join(ws, this.fileNameFor(ref)))) {
      return { dir: ws, scope: 'workspace' };
    }
    if (existsSync(join(this.globalVaultDir(), this.fileNameFor(ref)))) {
      return { dir: this.globalVaultDir(), scope: 'global' };
    }
    return null;
  }

  private writeScope(forceWorkspace: boolean): { dir: string; scope: VaultScope } {
    if (forceWorkspace) {
      const ws = this.workspaceVaultDir();
      if (!ws) throw new Error('Workspace scope requested but no workspace root configured.');
      return { dir: ws, scope: 'workspace' };
    }
    const ws = this.workspaceVaultDir();
    if (ws && existsSync(ws)) return { dir: ws, scope: 'workspace' };
    return { dir: this.globalVaultDir(), scope: 'global' };
  }

  async set(
    ref: EntryRef,
    fields: Record<string, string>,
    opts: { forceWorkspace?: boolean } = {},
  ): Promise<void> {
    const target = this.writeScope(opts.forceWorkspace ?? false);
    mkdirSync(target.dir, { recursive: true, mode: 0o700 });
    const path = join(target.dir, this.fileNameFor(ref));
    const tmp = `${path}.tmp`;
    const existing = existsSync(path) ? this.readEntry(path) : null;
    const ts = this.now();
    const entry: VaultEntry = {
      _schema: 1,
      engine: ref.engine,
      name: ref.name,
      fields,
      created_at: existing?.created_at ?? ts,
      last_modified_at: ts,
    };
    writeFileSync(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    this.audit.append({
      _schema: 1,
      ts,
      producer: 'vault',
      action: 'set',
      detail: {
        engine: ref.engine,
        name: ref.name,
        scope: target.scope,
        fields_set: Object.keys(fields),
      },
    } satisfies AuditRecord);
    this.writeSidecar(target.scope, (m) => {
      m[LocalDataVault.formatRef(ref)] = ts;
    });
  }

  async get(ref: EntryRef): Promise<VaultEntry> {
    const r = this.resolveScope(ref);
    if (!r) {
      const searched: string[] = [];
      const ws = this.workspaceVaultDir();
      if (ws) searched.push(join(ws, this.fileNameFor(ref)));
      searched.push(join(this.globalVaultDir(), this.fileNameFor(ref)));
      throw new VaultEntryNotFound(ref.engine, ref.name, searched);
    }
    const entry = this.readEntry(join(r.dir, this.fileNameFor(ref)));
    this.audit.append({
      _schema: 1,
      ts: this.now(),
      producer: 'vault',
      action: 'get',
      detail: { engine: ref.engine, name: ref.name, scope_resolved: r.scope },
    });
    return entry;
  }

  async remove(ref: EntryRef): Promise<void> {
    const r = this.resolveScope(ref);
    if (!r) throw new VaultEntryNotFound(ref.engine, ref.name, []);
    unlinkSync(join(r.dir, this.fileNameFor(ref)));
    this.audit.append({
      _schema: 1,
      ts: this.now(),
      producer: 'vault',
      action: 'remove',
      detail: { engine: ref.engine, name: ref.name, scope: r.scope },
    });
    this.writeSidecar(r.scope, (m) => {
      delete m[LocalDataVault.formatRef(ref)];
    });
  }

  async lookupLastModified(refStr: string): Promise<string | null> {
    const ref = LocalDataVault.parseRef(refStr);
    const r = this.resolveScope(ref);
    if (!r) return null;
    const sidecar = this.readSidecar(this.sidecarPathFor(r.scope));
    return sidecar[refStr] ?? null;
  }

  private sidecarPathFor(scope: VaultScope): string {
    const dir = scope === 'workspace' ? this.workspaceVaultDir()! : this.globalVaultDir();
    return join(dir, '_last_modified.json');
  }

  private readSidecar(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private writeSidecar(scope: VaultScope, mutate: (m: Record<string, string>) => void): void {
    const path = this.sidecarPathFor(scope);
    const data = this.readSidecar(path);
    mutate(data);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  }

  async list(): Promise<ListedEntry[]> {
    const out: ListedEntry[] = [];
    const collect = (dir: string | undefined, scope: VaultScope) => {
      if (!dir || !existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json') || f.startsWith('_')) continue;
        try {
          const entry = this.readEntry(join(dir, f));
          out.push({
            engine: entry.engine,
            name: entry.name,
            scope,
            fields_set: Object.keys(entry.fields),
            last_modified_at: entry.last_modified_at,
          });
        } catch {
          /* skip malformed */
        }
      }
    };
    collect(this.workspaceVaultDir(), 'workspace');
    collect(this.globalVaultDir(), 'global');
    return out;
  }

  private readEntry(path: string): VaultEntry {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      throw new VaultEntryMalformed(path, (err as Error).message);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new VaultEntryMalformed(path, `JSON parse: ${(err as Error).message}`);
    }
    if (!json || typeof json !== 'object' || (json as { _schema?: unknown })._schema !== 1) {
      throw new VaultEntryMalformed(path, 'unexpected _schema');
    }
    return json as VaultEntry;
  }

  private sweepOrphans(dir: string): void {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json.tmp')) {
        try {
          unlinkSync(join(dir, f));
        } catch {
          /* best effort */
        }
      }
    }
  }
}
