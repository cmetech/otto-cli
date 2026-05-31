import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChildProcessRuntime, type ChildProcessRuntimeOptions } from './child-process-runtime.js';
import { acquireLock, releaseLock, type LockInfo } from './scratchpad-lock.js';
import { CellArchive } from './cell-archive.js';

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
const META_SCHEMA_VERSION = 1;

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
    if (existsSync(path)) {
      try {
        const prev = JSON.parse(readFileSync(path, 'utf8')) as {
          created_at?: string;
          attached_sessions?: string[];
        };
        if (typeof prev.created_at === 'string') created_at = prev.created_at;
        if (Array.isArray(prev.attached_sessions)) attached_sessions = prev.attached_sessions;
      } catch {
        // corrupt meta -> rewrite fresh
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
    };
    writeFileSync(path, JSON.stringify(meta, null, 2));
  }

  private warmCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.runtime !== null) n++;
    return n;
  }

  private async spawnRuntime(): Promise<ChildProcessRuntime> {
    const rt = new ChildProcessRuntime({ workspace: this.workspace, ...this.runtimeOptions });
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
      await victim.runtime!.dispose();
      victim.runtime = null; // cold; lock RETAINED (Model A)
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
      existing.runtime = await this.spawnRuntime(); // cold -> warm; empty globalThis (1d gap)
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
      runtime = await this.spawnRuntime();
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    this.entries.set(name, { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now) });
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
        await e.runtime.dispose();
        e.runtime = null; // cold; lock RETAINED (Model A)
      }
    }
  }

  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    for (const [name, e] of this.entries) {
      await e.runtime?.dispose();
      releaseLock(this.dirFor(name)); // release lock; leave meta.json (durable)
    }
    this.entries.clear();
  }

  protected assertNotDisposed(): void {
    if (this.disposed) throw new Error('scratchpad manager disposed');
  }
}
