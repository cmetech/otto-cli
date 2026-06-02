import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CredentialInjector } from '@otto/coworker-vault';
import type { AuditLog } from '@otto/coworker-utils';
import { ChildProcessRuntime, type ChildProcessRuntimeOptions } from './child-process-runtime.js';
import { acquireLock, releaseLock, type LockInfo } from './scratchpad-lock.js';
import { CellArchive, type CellEntry } from './cell-archive.js';
import { projectTree, validateLeafId } from './cell-tree.js';
import { redactForJournal } from './kernel-bindings.js';
import type { DataLoadDrawer, RecoveryNote, SnapshotResult } from './kernel-protocol.js';

type RecoveryNoteEntry = RecoveryNote & { at: string };

export class ForkKernelHangError extends Error {
  constructor(public readonly srcName: string, public readonly pid: number) {
    super(`fork: source kernel for '${srcName}' (pid ${pid}) did not exit after SIGTERM + SIGKILL. Destination may be partially populated; clean up with /sp remove <dst>.`);
    this.name = 'ForkKernelHangError';
  }
}

export interface ScratchpadManagerOptions {
  workspace: string;
  root?: string;
  maxLiveKernels?: number;
  idleMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  runtimeOptions?: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  sessionId?: string;
  forkExitTimeoutMs?: number;
  /**
   * Phase 2 Task 13: optional vault credential injector. When provided, each
   * spawned ChildProcessRuntime receives the injector + the scratchpad's
   * meta.bindings list. Absent => runtime spawns with no OTTO_DS_* env vars.
   */
  injector?: CredentialInjector;
  /**
   * Phase 2 Task 14: optional audit sink for SecretScanner redactions on
   * cell-output journal writes. When provided, every cell run's stdout is
   * scanned BEFORE archive.append and emits one `producer: 'secret-scanner'`
   * record per hit. Absent => redaction is a no-op (backward compat).
   *
   * Wiring contract: the caller is expected to pass the SAME AuditLog instance
   * held by the CredentialInjector so secret-scanner records appear alongside
   * vault inject/inject-skipped records in a single audit stream.
   */
  audit?: AuditLog;
  /**
   * Phase 3 Task 19: cross-pillar hook for the memory pillar's MemoryRecorder.
   * Invoked once per `otto.collectors.open(...).load()` call inside a cell,
   * with the kernel's `DataLoadDrawer` and the scratchpad name that produced it.
   * The manager fans this through every spawn of every scratchpad (the callback
   * is closure-bound to the name at spawn time, so multi-scratchpad sessions
   * route loads to the correct room). Absent => data_load events are dropped.
   */
  onDataLoad?: (drawer: DataLoadDrawer, scratchpadName: string) => void;
}

export interface AttachOptions {
  forceTakeover?: boolean;
  takeoverReason?: string;
  /**
   * Phase 2 Task 12: optional list of binding ids (e.g. ['jira:prod']) to record
   * in meta.json on first create. Subsequent meta writes preserve whatever's on
   * disk via prevExtras — once persisted, bindings survive every other meta-write
   * path. Ignored on re-attach if meta.json already has a bindings field.
   */
  bindings?: string[];
}

export interface ScratchpadInfo {
  name: string;
  live: boolean;
  lastUsedAt: number;
  hasActiveCell: boolean; // Task D: true iff warm AND a cell is currently executing
}

interface Entry {
  runtime: ChildProcessRuntime | null; // null when cold (evicted, lock retained)
  lock: LockInfo;
  lastUsedAt: number;
  archive: CellArchive;
  kernelAtCellId: number | null; // 1g2: cell id at which the in-VM kernel state was last mutated
}

const DEFAULT_MAX_LIVE = 8;
const DEFAULT_IDLE_MS = 600_000;
const DEFAULT_SWEEP_MS = 30_000;
const META_SCHEMA_VERSION = 4;
const MAX_RECOVERY_NOTES = 20;
const FORK_EXIT_TIMEOUT_MS = 5000;

function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timeout: ${label}`));
    }, ms);
    timer.unref();
    p.then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
    );
  });
}

export class ScratchpadManager {
  protected readonly entries = new Map<string, Entry>();
  protected readonly workspace: string;
  protected readonly root: string;
  protected readonly maxLive: number;
  protected readonly idleMs: number;
  protected readonly sessionId: string | undefined;
  protected readonly now: () => number;
  protected readonly runtimeOptions: Omit<ChildProcessRuntimeOptions, 'workspace'>;
  protected readonly forkExitTimeoutMs: number;
  protected readonly injector: CredentialInjector | undefined;
  protected readonly audit: AuditLog | undefined;
  protected readonly onDataLoad: ((drawer: DataLoadDrawer, scratchpadName: string) => void) | undefined;
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
    this.forkExitTimeoutMs = options.forkExitTimeoutMs ?? FORK_EXIT_TIMEOUT_MS;
    this.injector = options.injector;
    this.audit = options.audit;
    this.onDataLoad = options.onDataLoad;
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

  private payloadSize(dir: string): number {
    let total = 0;
    for (const f of ['kernel.db', 'kernel.db.wal', 'namespace.json', 'cells.jsonl']) {
      try {
        total += statSync(join(dir, f)).size;
      } catch {
        // not present -> skip (no-op contribution)
      }
    }
    return total;
  }

  private writeMetaAtomic(path: string, payload: unknown): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2));
    renameSync(tmp, path);
  }

  private writeMeta(name: string, initialBindings?: string[]): void {
    const dir = this.dirFor(name);
    const path = this.metaPath(name);
    mkdirSync(dir, { recursive: true });
    const nowIso = new Date(this.now()).toISOString();
    let created_at = nowIso;
    let attached_sessions: string[] = [];
    // Phase 2 Task 12: bindings persistence + v3→v4 migration.
    // - On first write (no prev), use the passed-in initialBindings (default []).
    // - On subsequent writes, preserve whatever's on disk (migrating v3 → []).
    let bindings: string[] = Array.isArray(initialBindings) ? [...initialBindings] : [];
    const prevExtras: Record<string, unknown> = {};
    if (existsSync(path)) {
      try {
        const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        if (typeof prev.created_at === 'string') created_at = prev.created_at;
        if (Array.isArray(prev.attached_sessions)) attached_sessions = prev.attached_sessions as string[];
        // v3 → v4 migration: bindings field is missing on v3; default to [].
        bindings = Array.isArray(prev.bindings) ? (prev.bindings as string[]) : [];
        for (const k of [
          'last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes',
          'cell_leaf_id', 'kernel_at_cell_id', 'recovery_notes_seen_at',
        ]) {
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
    const archive = this.entries.get(name)?.archive;
    if (archive && archive.leafId !== null) {
      prevExtras.cell_leaf_id = archive.leafId;
    }
    const liveEntry = this.entries.get(name);
    if (liveEntry && liveEntry.kernelAtCellId !== null) {
      prevExtras.kernel_at_cell_id = liveEntry.kernelAtCellId;
    }
    const meta = {
      name,
      created_at,
      last_used: nowIso,
      attached_sessions,
      bindings,
      size_bytes: this.payloadSize(dir),
      schema_version: META_SCHEMA_VERSION,
      ...prevExtras,
      kernel_db: { present: existsSync(join(dir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dir, 'namespace.json')), schema_version: 1 },
    };
    this.writeMetaAtomic(path, meta);
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
    this.writeMetaAtomic(path, cur);
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
    this.writeMetaAtomic(path, cur);
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

  private restoreLeafOnAttach(name: string, entry: Entry): void {
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    try {
      const cur = JSON.parse(readFileSync(path, 'utf8')) as { cell_leaf_id?: unknown };
      const persisted = cur.cell_leaf_id;
      if (typeof persisted === 'number' && entry.archive.leafId !== persisted) {
        entry.archive.setLeaf(persisted);
      }
    } catch {
      // ignore; leaf falls back to file-max (the constructor's default).
    }
  }

  private restoreKernelAtCellIdOnAttach(name: string, entry: Entry): void {
    // Cold restore: kernel was hydrated from namespace.json, which was written at
    // last_snapshot_cell_id. That's where the in-VM state lives.
    const path = this.metaPath(name);
    if (!existsSync(path)) {
      entry.kernelAtCellId = null;
      return;
    }
    try {
      const cur = JSON.parse(readFileSync(path, 'utf8')) as { last_snapshot_cell_id?: unknown };
      const last = cur.last_snapshot_cell_id;
      entry.kernelAtCellId = typeof last === 'number' ? last : null;
    } catch {
      entry.kernelAtCellId = null;
    }
  }

  private warmCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.runtime !== null) n++;
    return n;
  }

  /**
   * Phase 2 Task 13: read meta.bindings from disk so each fresh spawn picks up
   * the current binding set (bindings can change between attaches via /sp use).
   * Returns [] if meta.json doesn't exist or doesn't have a v4 bindings array.
   *
   * Phase 2 Task 16: also surfaced as a public read for /sp list rendering and
   * staleness-banner emission. Stays a thin read; callers that need to mutate
   * use addBinding / removeBinding (which atomically RMW meta.json).
   */
  readBindings(name: string): string[] {
    const path = this.metaPath(name);
    if (!existsSync(path)) return [];
    try {
      const cur = JSON.parse(readFileSync(path, 'utf8')) as { bindings?: unknown };
      return Array.isArray(cur.bindings) ? (cur.bindings as string[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Phase 2 Task 16: append a binding ref (e.g. 'jira:prod') to meta.bindings.
   * Idempotent — adding a ref already in the list is a no-op (the meta.json
   * write still happens so callers can detect "added" vs "noop" only via the
   * returned tuple). Atomically rewrites meta.json via writeMetaAtomic, so
   * concurrent writers cannot interleave. Caller is responsible for validating
   * `ref` (sp-command uses LocalDataVault.parseRef before invoking).
   */
  async addBinding(name: string, ref: string): Promise<{ added: boolean }> {
    this.assertNotDisposed();
    if (!this.existsOnDisk(name)) throw new Error(`scratchpad not found: ${name}`);
    const path = this.metaPath(name);
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* corrupt -> overwrite */ }
    const bindings = Array.isArray(cur.bindings) ? [...(cur.bindings as string[])] : [];
    if (bindings.includes(ref)) {
      return { added: false };
    }
    bindings.push(ref);
    cur.bindings = bindings;
    if (typeof cur.schema_version !== 'number') cur.schema_version = META_SCHEMA_VERSION;
    this.writeMetaAtomic(path, cur);
    return { added: true };
  }

  /**
   * Phase 2 Task 16: remove a binding ref from meta.bindings. Returns whether
   * a removal happened so callers can emit "no such binding" if needed.
   */
  async removeBinding(name: string, ref: string): Promise<{ removed: boolean }> {
    this.assertNotDisposed();
    if (!this.existsOnDisk(name)) throw new Error(`scratchpad not found: ${name}`);
    const path = this.metaPath(name);
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* corrupt -> overwrite */ }
    const bindings = Array.isArray(cur.bindings) ? [...(cur.bindings as string[])] : [];
    const idx = bindings.indexOf(ref);
    if (idx < 0) {
      return { removed: false };
    }
    bindings.splice(idx, 1);
    cur.bindings = bindings;
    if (typeof cur.schema_version !== 'number') cur.schema_version = META_SCHEMA_VERSION;
    this.writeMetaAtomic(path, cur);
    return { removed: true };
  }

  private async spawnRuntime(name: string): Promise<ChildProcessRuntime> {
    // Phase 3 Task 19: bridge the manager-level onDataLoad (which receives
    // the scratchpad name) to the runtime-level onDataLoad (which doesn't).
    // Closure-bound to `name` here so each spawned runtime tags its drawers
    // with the correct scratchpad even when the manager is shared. If both
    // the manager and runtimeOptions supply an onDataLoad, the manager's
    // wins — runtimeOptions.onDataLoad never had a way to know the name.
    const fanout = this.onDataLoad;
    const onDataLoad = fanout
      ? (drawer: DataLoadDrawer): void => fanout(drawer, name)
      : this.runtimeOptions.onDataLoad;
    const rt = new ChildProcessRuntime({
      workspace: this.workspace,
      scratchpadDir: this.dirFor(name),
      ...this.runtimeOptions,
      onDataLoad,
      // Phase 2 Task 13: env-injection wiring. Injector + bindings are read
      // fresh on every spawn so cold-restarts and re-attaches see the latest
      // bindings list. scratchpadName + sessionId stamp the injector's audit
      // records so /audit can attribute each inject to a scratchpad+session.
      injector: this.injector,
      bindings: this.readBindings(name),
      scratchpadName: name,
      sessionId: this.sessionId ?? '',
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
      this.restoreLeafOnAttach(name, existing);
      this.restoreKernelAtCellIdOnAttach(name, existing);
      return existing.runtime;
    }
    return this.attachUnmanaged(name, opts);
  }

  async runCell(name: string, code: string, opts: AttachOptions = {}): Promise<{ value: unknown; stdout: string }> {
    this.assertNotDisposed();
    const runtime = await this.getOrAttach(name, opts);
    const entry = this.entries.get(name)!;
    entry.lastUsedAt = this.now();
    // Phase 2 Task 14: forecast the id the archive will assign to this cell so
    // any secret-scanner audit records carry the same cell_id the journal entry
    // will get. archive.lastId may be null for an empty archive (id 1 is next).
    const nextCellId = (entry.archive.lastId ?? 0) + 1;
    try {
      const result = await runtime.runCell(code);
      // Phase 2 Task 14: live TUI output is UPSTREAM — `result` flows back to
      // the tool unchanged for display. Only the journal copy of stdout is
      // passed through redactForJournal. When no audit is plumbed, redaction
      // is a pass-through (backward compat).
      const journalStdout = this.redactStdout(result.stdout, name, nextCellId);
      entry.archive.append({ code, ok: true, value: result.value, stdout: journalStdout });
      entry.kernelAtCellId = entry.archive.lastId;
      this.writeMeta(name);
      return result;
    } catch (err) {
      const e = err as Error;
      try {
        // Phase 2 Task 14: redact the error message too — cell exceptions can
        // embed user data in `e.message`. stdout is empty in this branch.
        const journalErrMsg = this.redactStdout(e.message, name, nextCellId);
        entry.archive.append({ code, ok: false, error: { name: e.name, message: journalErrMsg }, stdout: '' });
        entry.kernelAtCellId = entry.archive.lastId;
        this.writeMeta(name);
      } catch {
        // recording the failure must never mask the original cell error
      }
      throw err;
    }
  }

  /**
   * Phase 2 Task 14: redact known-secret patterns from a cell-output string
   * before journaling. No-op (pass-through) when no AuditLog is configured —
   * the manager was constructed in test/legacy mode without vault wiring.
   */
  private redactStdout(raw: string, scratchpadName: string, cellId: number): string {
    if (!this.audit) return raw;
    return redactForJournal(raw, {
      audit: this.audit,
      sessionId: this.sessionId ?? '',
      scratchpadName,
      pid: process.pid,
      cellId: String(cellId),
    });
  }

  /**
   * Task D: Release a warm kernel's process+memory while preserving on-disk state
   * (kernel.db, namespace.json, cells.jsonl, meta.json, lock.json). Cold-restart
   * happens on the next attach.
   *
   * Without --force: refuses if a cell is mid-execution. With --force: cancels the
   * active cell via runtime.cancel() (SIGINT → SIGTERM → SIGKILL escalation handled
   * internally by ChildProcessRuntime). Post-cancel the kernel is dead, so we skip
   * the snapshot — the next attach replays from cells.jsonl.
   */
  async evict(name: string, opts: { force?: boolean } = {}): Promise<{ interrupted: boolean }> {
    this.assertNotDisposed();
    const entry = this.entries.get(name);
    if (!entry || !entry.runtime) {
      throw new Error(`scratchpad ${name} is not warm (already cold)`);
    }
    if (entry.runtime.hasActiveCell) {
      if (!opts.force) {
        throw new Error(`cannot evict ${name}: cell is running (use --force to interrupt)`);
      }
      // --force: cancel via existing SIGINT → SIGTERM → SIGKILL escalation in
      // ChildProcessRuntime.cancel(). After cancel resolves the runtime is dead,
      // so snapshotThenDispose would fail. Skip the snapshot and flip the entry
      // to cold (runtime=null) like snapshotThenDispose would have. The session
      // lock remains held so /sp list still shows the (cold) entry and the next
      // attach cold-restarts from cells.jsonl.
      const rt = entry.runtime;
      await rt.cancel();
      try { await rt.dispose(); } catch { /* already dead — best-effort cleanup */ }
      if (entry.runtime === rt) entry.runtime = null;
      return { interrupted: true };
    }
    await this.snapshotThenDispose(name, entry);
    return { interrupted: false };
  }

  async setLeaf(name: string, id: number): Promise<void> {
    this.assertNotDisposed();
    // Verify the scratchpad exists on disk (works for both warm and cold).
    if (!this.existsOnDisk(name)) throw new Error(`scratchpad not found: ${name}`);
    // Build a tree from the on-disk cells.jsonl so validation works even when cold.
    const cells: CellEntry[] = [];
    const cellsPath = join(this.dirFor(name), 'cells.jsonl');
    if (existsSync(cellsPath)) {
      for (const line of readFileSync(cellsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as { id?: unknown };
          if (typeof obj.id === 'number') cells.push(obj as CellEntry);
        } catch {
          // header or trailing-corrupt line -> skip
        }
      }
    }
    const tree = projectTree(cells);
    validateLeafId(tree, id);
    // Warm path: update the live archive too.
    const entry = this.entries.get(name);
    if (entry) entry.archive.setLeaf(id);
    // Direct meta update so cold scratchpads persist the leaf.
    const path = this.metaPath(name);
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* fall through */ }
    cur.cell_leaf_id = id;
    // Phase 2 Task 12: bumping schema_version here doubles as a migration step
    // for cold-only flows; ensure bindings exists so the v4 invariant holds.
    if (!Array.isArray(cur.bindings)) cur.bindings = [];
    cur.schema_version = META_SCHEMA_VERSION;
    this.writeMetaAtomic(path, cur);
  }

  async fork(srcName: string, dstName: string): Promise<void> {
    this.assertNotDisposed();
    if (this.entries.has(dstName) || this.existsOnDisk(dstName)) {
      throw new Error(`scratchpad ${dstName} already exists`);
    }
    if (!this.existsOnDisk(srcName)) {
      throw new Error(`scratchpad not found: ${srcName}`);
    }
    // Auto-evict src to release the DuckDB kernel.db handle before we copy.
    // Capture the raw child process reference before disposal so we can await its
    // full exit — ensuring DuckDB flushes and closes kernel.db before copyFileSync.
    const srcEntry = this.entries.get(srcName);
    if (srcEntry && srcEntry.runtime) {
      const rawChild = (srcEntry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child;
      await this.snapshotThenDispose(srcName, srcEntry);
      if (rawChild && rawChild.exitCode === null) {
        const exitPromise = new Promise<void>((resolve) => rawChild.once('exit', () => resolve()));
        try {
          await raceWithTimeout(exitPromise, this.forkExitTimeoutMs, 'exit-after-SIGTERM');
        } catch {
          rawChild.kill('SIGKILL');
          const exitPromise2 = new Promise<void>((resolve) => rawChild.once('exit', () => resolve()));
          try {
            await raceWithTimeout(exitPromise2, this.forkExitTimeoutMs, 'exit-after-SIGKILL');
          } catch {
            throw new ForkKernelHangError(srcName, rawChild.pid ?? -1);
          }
        }
      }
    }
    const srcDir = this.dirFor(srcName);
    const dstDir = this.dirFor(dstName);
    mkdirSync(dstDir, { recursive: true });
    for (const file of ['kernel.db', 'kernel.db.wal', 'namespace.json', 'cells.jsonl']) {
      if (existsSync(join(srcDir, file))) {
        copyFileSync(join(srcDir, file), join(dstDir, file));
      }
    }
    // Build dst meta inheriting selected fields from src.
    let srcMeta: Record<string, unknown> = {};
    try { srcMeta = JSON.parse(readFileSync(join(srcDir, 'meta.json'), 'utf8')) as Record<string, unknown>; } catch { /* leave empty */ }
    const nowIso = new Date(this.now()).toISOString();
    const dstMeta = {
      name: dstName,
      created_at: nowIso,
      last_used: nowIso,
      attached_sessions: this.sessionId ? [this.sessionId] : [],
      // Phase 2 Task 16: fork inherits src's bindings so the forked scratchpad
      // spawns its kernel with the same OTTO_DS_* env block. Users can
      // /sp unuse on dst afterwards if they want a different binding shape.
      bindings: Array.isArray(srcMeta.bindings) ? [...(srcMeta.bindings as string[])] : [],
      size_bytes: this.payloadSize(dstDir),
      schema_version: META_SCHEMA_VERSION,
      cell_leaf_id: typeof srcMeta.cell_leaf_id === 'number' ? srcMeta.cell_leaf_id : null,
      last_snapshot_cell_id: typeof srcMeta.last_snapshot_cell_id === 'number' ? srcMeta.last_snapshot_cell_id : null,
      last_snapshot_at: typeof srcMeta.last_snapshot_at === 'string' ? srcMeta.last_snapshot_at : null,
      kernel_at_cell_id: typeof srcMeta.kernel_at_cell_id === 'number'
        ? srcMeta.kernel_at_cell_id
        : (typeof srcMeta.last_snapshot_cell_id === 'number' ? srcMeta.last_snapshot_cell_id : null),
      namespace_skipped: [],
      recovery_notes: [],
      kernel_db: { present: existsSync(join(dstDir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dstDir, 'namespace.json')), schema_version: 1 },
    };
    this.writeMetaAtomic(join(dstDir, 'meta.json'), dstMeta);
    // Claim the new scratchpad for this session by acquiring its lock and registering
    // a cold entry so getOrAttach can re-warm without re-acquiring the lock.
    const dstLock = acquireLock(dstDir, { now: this.now });
    const dstEntry: Entry = {
      runtime: null,
      lock: dstLock,
      lastUsedAt: this.now(),
      archive: new CellArchive(dstDir, this.now),
      kernelAtCellId: dstMeta.kernel_at_cell_id,
    };
    this.entries.set(dstName, dstEntry);
  }

  async clearHistory(name: string): Promise<void> {
    this.assertNotDisposed();
    const entry = this.entries.get(name);
    if (entry?.runtime?.hasActiveCell) {
      throw new Error('cannot clear history while a cell is running');
    }
    if (entry?.archive) {
      entry.archive.reset();
      entry.kernelAtCellId = null;
    } else {
      // Cold path: construct a temp archive solely to reuse its truncation logic.
      const tmpArchive = new CellArchive(this.dirFor(name), this.now);
      tmpArchive.reset();
    }
    // Direct meta read-modify-write; we explicitly do NOT route through writeMeta
    // because writeMeta pulls cell_leaf_id from the live archive — which is exactly
    // what we just nulled, but writeMeta would also re-add this.sessionId, which
    // we want preserved untouched here. Safer to read+merge+write directly.
    const path = this.metaPath(name);
    if (existsSync(path)) {
      let cur: Record<string, unknown> = {};
      try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* drop */ }
      cur.cell_leaf_id = null;
      cur.last_snapshot_cell_id = null;
      cur.last_snapshot_at = null;
      cur.kernel_at_cell_id = null;
      this.writeMetaAtomic(path, cur);
    }
  }

  async save(name: string): Promise<void> {
    this.assertNotDisposed();
    const entry = this.entries.get(name);
    if (!entry || !entry.runtime) {
      throw new Error(`scratchpad ${name} is not warm — nothing to save`);
    }
    if (entry.runtime.hasActiveCell) {
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: 'active cell' }]);
      throw new Error('cannot save while a cell is running');
    }
    const res = await entry.runtime.snapshot();
    if (res.ok) {
      this.applySnapshotToMeta(name, entry, res);
    } else {
      this.appendRecoveryNotes(name, [{ kind: 'snapshot-failed', message: res.error.message }]);
      throw new Error(`save failed: ${res.error.message}`);
    }
  }

  async detach(name: string, sessionId: string): Promise<void> {
    this.assertNotDisposed();
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return; }
    const arr = Array.isArray(cur.attached_sessions) ? (cur.attached_sessions as string[]) : [];
    const idx = arr.indexOf(sessionId);
    if (idx >= 0) {
      cur.attached_sessions = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
      this.writeMetaAtomic(path, cur);
    }
    // Runtime explicitly NOT disposed. Pool LRU/idle eviction owns cleanup.
  }

  async markRecoveryNotesSeen(name: string): Promise<void> {
    this.assertNotDisposed();
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return; }
    cur.recovery_notes_seen_at = new Date(this.now()).toISOString();
    this.writeMetaAtomic(path, cur);
  }

  private async attachUnmanaged(name: string, opts: AttachOptions): Promise<ChildProcessRuntime> {
    const dir = this.dirFor(name);
    const lock = acquireLock(dir, {
      forceTakeover: opts.forceTakeover,
      takeoverReason: opts.takeoverReason,
      now: this.now,
    });
    // Phase 2 Task 12: opts.bindings is only honored on first create; on re-attach
    // the on-disk bindings field wins via prevExtras in writeMeta.
    this.writeMeta(name, opts.bindings);
    await this.evictLruIfNeeded();
    let runtime: ChildProcessRuntime;
    try {
      runtime = await this.spawnRuntime(name);
    } catch (err) {
      releaseLock(dir); // don't leak the lock if spawn fails
      throw err;
    }
    this.writeMeta(name); // refresh: kernel.db is now on disk; payloadSize + kernel_db.present become accurate (Task E / Issue #2)
    const entry: Entry = { runtime, lock, lastUsedAt: this.now(), archive: new CellArchive(dir, this.now), kernelAtCellId: null };
    this.entries.set(name, entry);
    this.ingestRecoveryNotesOnAttach(name, entry);
    this.restoreLeafOnAttach(name, entry);
    this.restoreKernelAtCellIdOnAttach(name, entry);
    return runtime;
  }

  list(): ScratchpadInfo[] {
    return [...this.entries].map(([name, e]) => ({
      name,
      live: e.runtime !== null,
      lastUsedAt: e.lastUsedAt,
      hasActiveCell: e.runtime?.hasActiveCell ?? false,
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
