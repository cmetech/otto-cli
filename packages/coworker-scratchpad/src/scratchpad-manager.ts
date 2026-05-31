import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChildProcessRuntime, type ChildProcessRuntimeOptions } from './child-process-runtime.js';
import { acquireLock, releaseLock, type LockInfo } from './scratchpad-lock.js';
import { CellArchive } from './cell-archive.js';
import type { RecoveryNote, SnapshotResult } from './kernel-protocol.js';

type RecoveryNoteEntry = RecoveryNote & { at: string };

export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  idleMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  sessionId?: string;
}

export interface AttachOptions {
  forceTakeover?: boolean;
  takeoverReason?: string;
}

export interface ScratchpadInfo {
  name: string;
  live: boolean;
  lastUsedAt: number;
}

interface Entry {
  runtime: ChildProcessRuntime | null; // null when cold (evicted, lock retained)
  lock: LockInfo;
  lastUsedAt: number;
  archive: CellArchive;
}

const DEFAULT_MAX_LIVE = 8;
const DEFAULT_IDLE_MS = 600_000;
const DEFAULT_SWEEP_MS = 30_000;
const META_SCHEMA_VERSION = 2;
const MAX_RECOVERY_NOTES = 20;

export class ScratchpadManager {
  protected readonly entries = new Map<string, Entry>();
  protected readonly workspace: string;
  protected readonly root: string;
  protected readonly maxLive: number;
  protected readonly idleMs: number;
  protected readonly sessionId: string | undefined;
  protected readonly now: () => number;
  protected readonly runtimeOptions: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  protected disposed = false;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(options: ScratchpadManagerOptions) {
    this.workspace = options.workspace;
    this.root = options.root ?? join(homedir(), '.otto', 'scratchpads');
    this.maxLive = options.maxLiveKernels ?? DEFAULT_MAX_LIVE;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? Date.now;
    this.runtimeOptions = options.runtimeOptions ?? {};
    this.sessionId = options.sessionId;
    this.sweepTimer = setInterval(() => { void this.evictIdle(); }, options.sweepIntervalMs ?? DEFAULT_SWEEP_MS);
    this.sweepTimer.unref();
  }

  protected dirFor(name: string): string {
    return join(this.root, name);
  }

  private metaPath(name: string): string {
    return join(this.dirFor(name), 'meta.json');
  }

  private existsOnDisk(name: string): boolean {
    return existsSync(this.metaPath(name));
  }

  private dirSize(dir: string): number {
    let total = 0;
    try {
      for (const f of readdirSync(dir)) {
        try {
          total += statSync(join(dir, f)).size;
        } catch {
          // file vanished between readdir and stat -> skip
        }
      }
    } catch {
      // dir does not exist yet -> 0
    }
    return total;
  }

  private writeMeta(name: string): void {
    const dir = this.dirFor(name);
    const path = this.metaPath(name);
    mkdirSync(dir, { recursive: true });
    const nowIso = new Date(this.now()).toISOString();
    let created_at = nowIso;
    let attached_sessions: string[] = [];
    const prevExtras: Record<string, unknown> = {};
    if (existsSync(path)) {
      try {
        const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        if (typeof prev.created_at === 'string') created_at = prev.created_at;
        if (Array.isArray(prev.attached_sessions)) attached_sessions = prev.attached_sessions as string[];
        for (const k of ['last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes']) {
          if (k in prev) prevExtras[k] = prev[k];
        }
        if (Array.isArray(prevExtras.recovery_notes)) {
          const rn = prevExtras.recovery_notes as unknown[];
          prevExtras.recovery_notes = rn.slice(Math.max(0, rn.length - MAX_RECOVERY_NOTES));
        }
      } catch {
        // corrupt meta -> drop extras + rewrite fresh
      }
    }
    if (this.sessionId && !attached_sessions.includes(this.sessionId)) {
      attached_sessions.push(this.sessionId);
    }
    const meta = {
      name,
      created_at,
      last_used: nowIso,
      attached_sessions,
      size_bytes: this.dirSize(dir),
      schema_version: META_SCHEMA_VERSION,
      ...prevExtras,
      kernel_db: { present: existsSync(join(dir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dir, 'namespace.json')), schema_version: 1 },
    };
    writeFileSync(path, JSON.stringify(meta, null, 2));
  }

  private appendRecoveryNotes(name: string, notes: RecoveryNote[]): void {
    if (notes.length === 0) return;
    const path = this.metaPath(name);
    if (!existsSync(path)) return; // no meta yet; nothing to attach notes to
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      // corrupt meta -> do NOT rewrite as a fragment that destroys other fields.
      // The next successful writeMeta call will re-establish a coherent shape.
      return;
    }
    const prior = Array.isArray(cur.recovery_notes) ? (cur.recovery_notes as RecoveryNoteEntry[]) : [];
    const stamped: RecoveryNoteEntry[] = notes.map((n) => ({ at: new Date(this.now()).toISOString(), ...n }));
    const merged = [...prior, ...stamped];
    cur.recovery_notes = merged.slice(Math.max(0, merged.length - MAX_RECOVERY_NOTES));
    writeFileSync(path, JSON.stringify(cur, null, 2));
  }

  private applySnapshotToMeta(name: string, entry: Entry, res: Extract<SnapshotResult, { ok: true }>): void {
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    cur.last_snapshot_cell_id = entry.archive.lastId;
    cur.last_snapshot_at = res.snapshotted_at;
    cur.namespace_skipped = res.skipped;
    cur.namespace = { present: true, schema_version: 1 };
    cur.kernel_db = { present: existsSync(join(this.dirFor(name), 'kernel.db')), path: 'kernel.db' };
    writeFileSync(path, JSON.stringify(cur, null, 2));
  }

  private async snapshotThenDispose(name: string, entry: Entry): Promise<void> {
    const rt = entry.runtime;
    if (!rt) return;
    if (rt.hasActiveCell) {
      // An active cell would block the snapshot indefinitely until cellTimeoutMs fires
      // (kernel processes one NDJSON frame at a time). Skip the snapshot and dispose
      // straight away; the next attach will see cells-since-snapshot divergence.
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: 'skipped: active cell would block snapshot' }]);
      await rt.dispose();
      if (entry.runtime === rt) entry.runtime = null;
      return;
    }
    const res = await rt.snapshot();
    if (res.ok) {
      this.applySnapshotToMeta(name, entry, res);
    } else {
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: res.error.message }]);
    }
    await rt.dispose();
    // Only null the field if no concurrent caller has already replaced or cleared it.
    if (entry.runtime === rt) entry.runtime = null;
  }

  private ingestRecoveryNotesOnAttach(name: string, entry: Entry): void {
    const notes: RecoveryNote[] = [...entry.runtime!.recoveryNotes];
    // Divergence: compare archive.lastId to last_snapshot_cell_id on disk.
    const path = this.metaPath(name);
    if (existsSync(path)) {
      try {
        const cur = JSON.parse(readFileSync(path, 'utf8')) as { last_snapshot_cell_id?: unknown };
        const last = cur.last_snapshot_cell_id;
        const archiveId = entry.archive.lastId;
        if (typeof last === 'number' && typeof archiveId === 'number' && archiveId > last) {
          notes.push({ kind: 'cells-since-snapshot', n: archiveId - last });
        }
      } catch {
        // ignore; covered by the namespace-corrupt note path
      }
    }
    this.appendRecoveryNotes(name, notes);
  }

  private warmCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.runtime !== null) n++;
    return n;
  }

  private async spawnRuntime(name: string): Promise<ChildProcessRuntime> {
    const rt = new ChildProcessRuntime({
      workspace: this.workspace,
      scratchpadDir: this.dirFor(name),
      ...this.runtimeOptions,
    });
    await rt.start();
    return rt;
  }

  private async evictLruIfNeeded(): Promise<void> {
    while (this.warmCount() >= this.maxLive) {
      let victim: Entry | null = null;
      for (const e of this.entries.values()) {
        if (e.runtime === null) continue; // already cold
        if (e.runtime.hasActiveCell) continue; // never evict a busy kernel
        if (victim === null || e.lastUsedAt < victim.lastUsedAt) victim = e;
      }
      if (victim === null) break; // every warm kernel is busy; pool may momentarily exceed (documented)
      // The map key for the LRU victim is needed for snapshotThenDispose; find it now.
      let victimName: string | null = null;
      for (const [n, e] of this.entries) { if (e === victim) { victimName = n; break; } }
      if (victimName === null) break; // defensive; should be impossible
      await this.snapshotThenDispose(victimName, victim);
    }
  }

  async create(name: string, opts: AttachOptions = {}): Promise<ChildProcessRuntime> {
    this.assertNotDisposed();
    if (this.entries.has(name) || this.existsOnDisk(name)) {
      throw new Error(`scratchpad ${name} already exists`);
    }
    return this.attachUnmanaged(name, opts);
  }

  async getOrAttach(name: string, opts: AttachOptions = {}): Promise<ChildProcessRuntime> {
    this.assertNotDisposed();
    const existing = this.entries.get(name);
    if (existing) {
      existing.lastUsedAt = this.now();
      if (existing.runtime) return existing.runtime;
      await this.evictLruIfNeeded();
      existing.runtime = await this.spawnRuntime(name); // cold -> warm; namespace restored from disk (1d2)
      this.ingestRecoveryNotesOnAttach(name, existing);
      return existing.runtime;
    }
    return this.attachUnmanaged(name, opts);
  }

  async runCell(name: string, code: string, opts: AttachOptions = {}): Promise<{ value: unknown; stdout: string }> {
    this.assertNotDisposed();
    const runtime = await this.getOrAttach(name, opts);
    const entry = this.entries.get(name)!;
    entry.lastUsedAt = this.now();
    try {
      const result = await runtime.runCell(code);
      entry.archive.append({ code, ok: true, value: result.value, stdout: result.stdout });
      this.writeMeta(name);
      return result;
    } catch (err) {
      const e = err as Error;
      try {
        entry.archive.append({ code, ok: false, error: { name: e.name, message: e.message }, stdout: '' });
        this.writeMeta(name);
      } catch {
        // recording the failure must never mask the original cell error
      }
      throw err;
    }
  }

  private async attachUnmanaged(name: string, opts: AttachOptions): Promise<ChildProcessRuntime> {
    const dir = this.dirFor(name);
    const lock = acquireLock(dir, {
      forceTakeover: opts.forceTakeover,
      takeoverReason: opts.takeoverReason,
      now: this.now,
    });
    this.writeMeta(name);
    await this.evictLruIfNeeded();
    let runtime: ChildProcessRuntime;
    try {
      runtime = await this.spawnRuntime(name);
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    const entry: Entry = { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now) };
    this.entries.set(name, entry);
    this.ingestRecoveryNotesOnAttach(name, entry);
    return runtime;
  }

  list(): ScratchpadInfo[] {
    return [...this.entries].map(([name, e]) => ({
      name,
      live: e.runtime !== null,
      lastUsedAt: e.lastUsedAt,
    }));
  }

  async remove(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (entry) {
      await entry.runtime?.dispose();
      this.entries.delete(name);
    }
    rmSync(this.dirFor(name), { recursive: true, force: true }); // deletes lock.json + meta.json
  }

  async evictIdle(): Promise<void> {
    if (this.disposed) return;
    const cutoff = this.now() - this.idleMs;
    for (const e of this.entries.values()) {
      if (e.runtime === null) continue;
      if (e.runtime.hasActiveCell) continue; // never evict a busy kernel
      if (e.lastUsedAt <= cutoff) {
        // Find the name for this entry to feed snapshotThenDispose.
        let entryName: string | null = null;
        for (const [n, ent] of this.entries) { if (ent === e) { entryName = n; break; } }
        if (entryName !== null) await this.snapshotThenDispose(entryName, e);
      }
    }
  }

  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    for (const [name, e] of this.entries) {
      if (e.runtime) await this.snapshotThenDispose(name, e);
      releaseLock(this.dirFor(name)); // release lock; leave meta.json (durable)
    }
    this.entries.clear();
  }

  protected assertNotDisposed(): void {
    if (this.disposed) throw new Error('scratchpad manager disposed');
  }
}
