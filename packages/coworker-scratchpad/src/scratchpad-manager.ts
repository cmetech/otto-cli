import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChildProcessRuntime, type ChildProcessRuntimeOptions } from './child-process-runtime.js';
import { acquireLock, releaseLock, type LockInfo } from './scratchpad-lock.js';

export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
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
}

const DEFAULT_MAX_LIVE = 8;

export class ScratchpadManager {
  protected readonly entries = new Map<string, Entry>();
  protected readonly workspace: string;
  protected readonly root: string;
  protected readonly maxLive: number;
  protected readonly now: () => number;
  protected readonly runtimeOptions: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  protected disposed = false;

  constructor(options: ScratchpadManagerOptions) {
    this.workspace = options.workspace;
    this.root = options.root ?? join(homedir(), '.otto', 'scratchpads');
    this.maxLive = options.maxLiveKernels ?? DEFAULT_MAX_LIVE;
    this.now = options.now ?? Date.now;
    this.runtimeOptions = options.runtimeOptions ?? {};
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

  private writeMetaIfAbsent(name: string): void {
    const path = this.metaPath(name);
    if (existsSync(path)) return;
    mkdirSync(this.dirFor(name), { recursive: true });
    writeFileSync(path, JSON.stringify({ name, created_at: new Date(this.now()).toISOString() }, null, 2));
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

  private async attachUnmanaged(name: string, opts: AttachOptions): Promise<ChildProcessRuntime> {
    const dir = this.dirFor(name);
    const lock = acquireLock(dir, {
      forceTakeover: opts.forceTakeover,
      takeoverReason: opts.takeoverReason,
      now: this.now,
    });
    this.writeMetaIfAbsent(name);
    await this.evictLruIfNeeded();
    let runtime: ChildProcessRuntime;
    try {
      runtime = await this.spawnRuntime();
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    this.entries.set(name, { runtime, lock, lastUsedAt: this.now() });
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

  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
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
