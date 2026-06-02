// packages/coworker-artifacts/src/artifact-store.ts
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { join, normalize } from 'node:path';
import type {
  ArtifactHandle, ArtifactKind, ArtifactMetadata, FileWrite,
  Provenance, TurnEntry,
} from './types.js';
import { ARTIFACT_KINDS } from './types.js';
import {
  ArtifactKindRejected, ArtifactNotFound, ArtifactSlugCollision,
} from './errors.js';
import { deriveSlug, nextCollisionSlug } from './slug.js';
import { takeSnapshot, diffSnapshots } from './dir-snapshot.js';
import { renderReadme } from './readme-renderer.js';

export interface ArtifactStoreOptions {
  workspaceDir: string;
  now?: () => string;
}

const ARTIFACTS_DIR_NAME = '.otto/artifacts';
const PRIMARY_FILE = 'report.md';

export class ArtifactStore {
  private readonly workspaceDir: string;
  private readonly now: () => string;

  constructor(opts: ArtifactStoreOptions) {
    this.workspaceDir = opts.workspaceDir;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private rootDir(): string {
    return join(this.workspaceDir, ARTIFACTS_DIR_NAME);
  }

  private existingSlugs(): Set<string> {
    const root = this.rootDir();
    if (!existsSync(root)) return new Set();
    return new Set(readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name));
  }

  private handleFor(slug: string, kind: ArtifactKind, name: string): ArtifactHandle {
    const dir = join(this.rootDir(), slug);
    return {
      slug, kind, name, dir,
      uri: `artifact://${slug}`,
      primaryPath: join(dir, PRIMARY_FILE),
      metadataPath: join(dir, 'metadata.json'),
      provenancePath: join(dir, 'provenance.json'),
      readmePath: join(dir, 'README.md'),
    };
  }

  private atomicWrite(path: string, content: string, mode = 0o600): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, content, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  }

  private readMetadata(path: string): ArtifactMetadata {
    return JSON.parse(readFileSync(path, 'utf8')) as ArtifactMetadata;
  }

  private readProvenance(path: string): Provenance {
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Provenance;
    } catch {
      return [];
    }
  }

  private fileStats(dir: string): Array<{ path: string; sizeBytes: number }> {
    const snap = takeSnapshot(dir);
    return [...snap.entries()]
      .filter(([p]) => p !== 'metadata.json' && p !== 'provenance.json' && p !== 'README.md')
      .map(([path, { sizeBytes }]) => ({ path, sizeBytes }));
  }

  async create(kind: ArtifactKind, name: string): Promise<ArtifactHandle> {
    if (!ARTIFACT_KINDS.includes(kind)) throw new ArtifactKindRejected(kind);
    mkdirSync(this.rootDir(), { recursive: true, mode: 0o700 });
    const base = deriveSlug(name);
    const slug = nextCollisionSlug(base, this.existingSlugs());
    const handle = this.handleFor(slug, kind, name);
    // Use mkdirSync (non-recursive) on the artifact dir for race detection,
    // but the parent is created above; if this throws EEXIST, retry with bumped slug.
    try { mkdirSync(handle.dir, { mode: 0o700 }); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Race — recurse with refreshed slug set
        return this.create(kind, name);
      }
      throw err;
    }
    const ts = this.now();
    const meta: ArtifactMetadata = {
      _schema: 1, slug, kind, name,
      created_at: ts, last_updated_at: ts,
      turn_count: 0, primary_file: PRIMARY_FILE,
      uri: handle.uri,
    };
    this.atomicWrite(handle.metadataPath, JSON.stringify(meta, null, 2));
    this.atomicWrite(handle.primaryPath, '');
    this.atomicWrite(handle.provenancePath, '[]');
    this.atomicWrite(handle.readmePath, renderReadme(meta, [], this.fileStats(handle.dir)));
    return handle;
  }

  async update(handle: ArtifactHandle, files: FileWrite[]): Promise<{ files_touched: string[] }> {
    if (!existsSync(handle.dir)) throw new ArtifactNotFound(handle.slug);
    for (const f of files) {
      const normalized = normalize(f.path);
      if (!f.path || !normalized || normalized === '.' ||
          normalized.startsWith('..') || normalized.startsWith('/') ||
          normalized.includes('\0')) {
        throw new Error(`Bad FileWrite path: ${f.path}`);
      }
    }
    const before = takeSnapshot(handle.dir);
    for (const f of files) {
      const abs = join(handle.dir, f.path);
      mkdirSync(join(abs, '..'), { recursive: true, mode: 0o700 });
      this.atomicWrite(abs, f.content);
    }
    const after = takeSnapshot(handle.dir);
    const diff = diffSnapshots(before, after);
    const filesTouched = [...new Set([...diff.added, ...diff.modified])]
      .filter(p => p !== 'metadata.json' && p !== 'provenance.json' && p !== 'README.md')
      .sort();
    // Bump metadata (last_updated_at; turn_count incremented by recordTurn)
    const meta = this.readMetadata(handle.metadataPath);
    meta.last_updated_at = this.now();
    this.atomicWrite(handle.metadataPath, JSON.stringify(meta, null, 2));
    const prov = this.readProvenance(handle.provenancePath);
    this.atomicWrite(handle.readmePath, renderReadme(meta, prov, this.fileStats(handle.dir)));
    return { files_touched: filesTouched };
  }

  async recordTurn(
    handle: ArtifactHandle,
    entry: Omit<TurnEntry, '_schema' | 'ts'> & Partial<Pick<TurnEntry, 'ts'>>,
  ): Promise<void> {
    if (!existsSync(handle.dir)) throw new ArtifactNotFound(handle.slug);
    const prov = this.readProvenance(handle.provenancePath);
    const ts = entry.ts ?? this.now();
    const fullEntry: TurnEntry = {
      _schema: 1, ts,
      action: entry.action,
      turn_id: entry.turn_id,
      user_prompt: entry.user_prompt,
      files_touched: entry.files_touched,
      ...(entry.agent_turn_id !== undefined ? { agent_turn_id: entry.agent_turn_id } : {}),
      ...(entry.scratchpad_name !== undefined ? { scratchpad_name: entry.scratchpad_name } : {}),
    };
    prov.push(fullEntry);
    this.atomicWrite(handle.provenancePath, JSON.stringify(prov, null, 2));
    // Bump metadata
    const meta = this.readMetadata(handle.metadataPath);
    meta.turn_count = prov.length;
    meta.last_updated_at = ts;
    this.atomicWrite(handle.metadataPath, JSON.stringify(meta, null, 2));
    this.atomicWrite(handle.readmePath, renderReadme(meta, prov, this.fileStats(handle.dir)));
  }

  async list(): Promise<ArtifactHandle[]> {
    const root = this.rootDir();
    if (!existsSync(root)) return [];
    const handles: Array<{ handle: ArtifactHandle; created_at: string }> = [];
    for (const slug of this.existingSlugs()) {
      const metaPath = join(root, slug, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      try {
        const meta = this.readMetadata(metaPath);
        const h = this.handleFor(meta.slug, meta.kind, meta.name);
        handles.push({ handle: h, created_at: meta.created_at });
      } catch { /* skip malformed */ }
    }
    handles.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return handles.map(x => x.handle);
  }

  async get(slug: string): Promise<ArtifactHandle | null> {
    const metaPath = join(this.rootDir(), slug, 'metadata.json');
    if (!existsSync(metaPath)) return null;
    const meta = this.readMetadata(metaPath);
    return this.handleFor(meta.slug, meta.kind, meta.name);
  }

  async remove(slug: string, confirm: true): Promise<void> {
    if (confirm !== true) throw new Error(`/artifacts remove requires --confirm`);
    if (!slug || slug.includes('/') || slug.includes('..') || slug === '.') {
      throw new ArtifactNotFound(slug);
    }
    const dir = join(this.rootDir(), slug);
    if (!existsSync(dir)) throw new ArtifactNotFound(slug);
    rmSync(dir, { recursive: true, force: true });
  }
}
