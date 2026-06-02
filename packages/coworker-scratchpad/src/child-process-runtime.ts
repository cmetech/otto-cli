import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import type { CredentialInjector } from '@otto/coworker-vault';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';
import {
  isDataLoadEvent,
  isProgressEvent,
  isStartupErrorEvent,
  isSnapshotResult,
  isArtifactCreateEvent,
  isArtifactCreateRequest,
  isArtifactUpdateRequest,
} from './kernel-protocol.js';
import type {
  ArtifactCreateDrawer,
  ArtifactCreateRequest,
  ArtifactCreateResponse,
  ArtifactUpdateRequest,
  ArtifactUpdateResponse,
  DataLoadDrawer,
  KernelFrame,
  RecoveryNote,
  SnapshotResult,
} from './kernel-protocol.js';

export interface CellResult {
  value: unknown;
  stdout: string;
}

export interface ChildProcessRuntimeOptions {
  workspace: string;
  onDataLoad?: (drawer: DataLoadDrawer) => void;
  cellTimeoutMs?: number; // total wall-clock hard cap per cell
  inactivityTimeoutMs?: number; // silence cap before the first progress() heartbeat
  inactivityAfterProgressMs?: number; // silence cap after a progress() heartbeat
  cancelGraceMs?: number; // SIGINT -> SIGTERM/SIGKILL escalation window
  entryPath?: string;
  scratchpadDir?: string;
  /**
   * Phase 2 Task 13: optional vault credential injector. When provided alongside
   * a non-empty `bindings`, the runtime adds OTTO_DS_* env vars to the spawned
   * kernel's environment (after the existing env filter). Absent => no-op; the
   * runtime behaves exactly as it did pre-Phase-2.
   */
  injector?: CredentialInjector;
  bindings?: string[];
  /**
   * Phase 2 Task 13: identifies this runtime's scratchpad for audit records the
   * injector emits. The runtime itself doesn't otherwise use this field.
   */
  scratchpadName?: string;
  /**
   * Phase 2 Task 13: session id stamped on audit records the injector emits.
   * Empty string is a valid no-session value.
   */
  sessionId?: string;
  /**
   * Phase 4 Task 10: Layer-B fan-out for artifact_create events. The kernel
   * emits one of these after every successful otto.artifact.create RPC; the
   * runtime forwards the drawer to this callback so the manager can record it
   * into memory. Absent => artifact_create events are dropped.
   */
  onArtifactCreate?: (drawer: ArtifactCreateDrawer) => void;
  /**
   * Phase 4 Task 10: parent-side handler for `artifact_create` RPC requests.
   * The runtime calls this when it sees an `{type:'request', request:'artifact_create'}`
   * frame on the child's stdout and writes the resolved response (or an error
   * frame) back to the child's stdin. If absent, the request is rejected with
   * "artifacts unavailable" so the cell fails fast instead of hanging.
   */
  handleArtifactCreate?: (req: { kind: string; name: string }) =>
    Promise<{ slug: string; uri: string; primary_path: string }>;
  /**
   * Phase 4 Task 10: parent-side handler for `artifact_update` RPC requests.
   * Mirror of handleArtifactCreate for the update path.
   */
  handleArtifactUpdate?: (req: { slug: string; files: Array<{ path: string; content: string }> }) =>
    Promise<{ files_touched: string[] }>;
}

interface Pending {
  resolve: (result: CellResult) => void;
  reject: (err: Error) => void;
  totalTimer: NodeJS.Timeout;
  inactivityTimer: NodeJS.Timeout;
  inactivityWindowMs: number;
}

const DEFAULT_CELL_TIMEOUT_MS = 120_000;
const DEFAULT_INACTIVITY_MS = 30_000;
const DEFAULT_INACTIVITY_AFTER_PROGRESS_MS = 60_000;
const DEFAULT_CANCEL_GRACE_MS = 2_000;
const MAX_RESTARTS_BEFORE_SUCCESS = 1;

export class ChildProcessRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly pendingSnapshots = new Map<number, (res: SnapshotResult) => void>();
  private activeId: number | null = null;
  private nextId = 1;
  private alive = false;
  private childReady = false;
  private disposed = false;
  private restartsSinceSuccess = 0;
  private recoveryNotes_: RecoveryNote[] = [];
  private resolveReady: () => void = () => {};
  private rejectReady: (err: Error) => void = () => {};
  private ready: Promise<void> = Promise.resolve();
  /**
   * Phase 2 Task 13: timestamp of the most recent successful spawn(). Used by
   * higher-level staleness checks (Task 15) to decide whether a warm kernel's
   * env-injected credentials need to be refreshed. Pre-start() value is epoch
   * so callers can distinguish "never spawned" without nullable juggling.
   */
  public spawnTime: Date = new Date(0);

  constructor(private readonly options: ChildProcessRuntimeOptions) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('runtime disposed');
    await this.spawnChild();
  }

  /**
   * Phase 2 Task 13: env construction split out so the injector hop has a clean
   * seam to extend. Existing semantics unchanged: filterEnv applies the kernel's
   * allowlist/denylist, then (when configured) the injector overlays OTTO_DS_*
   * vars from vault entries. Only the spawned child sees the result; the parent
   * process.env is never mutated.
   */
  private async buildBaseEnv(): Promise<NodeJS.ProcessEnv> {
    const base = filterEnv(process.env);
    const { injector, bindings } = this.options;
    if (!injector || !bindings || bindings.length === 0) return base;
    return injector.injectEnv(base, bindings, {
      scratchpadName: this.options.scratchpadName ?? '',
      sessionId: this.options.sessionId ?? '',
      pid: process.pid,
    });
  }

  private async spawnChild(): Promise<void> {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const entry = this.options.entryPath ?? resolveKernelEntry();
    const args = [...kernelExecArgv(), entry, this.options.workspace];
    if (this.options.scratchpadDir !== undefined) args.push(this.options.scratchpadDir);
    const env = await this.buildBaseEnv();
    const child = spawn(
      process.execPath,
      args,
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env },
    ) as unknown as ChildProcessWithoutNullStreams;
    this.child = child;
    this.alive = true;
    this.childReady = false;
    // Phase 2 Task 13: stamp spawnTime immediately after a successful spawn.
    // Done synchronously so the ready promise (which the caller awaits) reflects
    // a non-epoch spawnTime by the time start() returns.
    this.spawnTime = new Date();
    child.on('exit', (code, signal) => {
      if (this.child !== child) return; // superseded by a restart
      this.alive = false;
      this.childReady = false;
      if (this.disposed) return;
      const err = new Error(`kernel exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.rejectReady(err); // no-op if ready already resolved
      this.failAllPending(err);
    });
    void this.readLoop(child);
    return this.ready;
  }

  private async readLoop(child: ChildProcessWithoutNullStreams): Promise<void> {
    try {
      for await (const raw of readNdjson(child.stdout)) {
        if (this.child !== child) break; // superseded by a restart
        const frame = raw as KernelFrame;
        if (frame.type === 'event') {
          if (frame.event === 'ready') {
            if (frame.recovery_notes) this.recoveryNotes_ = [...frame.recovery_notes];
            this.childReady = true;
            this.resolveReady();
          }
          else if (isStartupErrorEvent(frame)) {
            const err = new Error(frame.error.message);
            err.name = `startup_error/${frame.kind}`;
            this.rejectReady(err);
          }
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          else if (isArtifactCreateEvent(frame)) this.options.onArtifactCreate?.(frame.drawer);
          else if (isProgressEvent(frame)) this.resetInactivity();
          continue;
        }
        if (isSnapshotResult(frame)) {
          const resolver = this.pendingSnapshots.get(frame.id);
          if (resolver) {
            this.pendingSnapshots.delete(frame.id);
            resolver(frame);
          }
          continue;
        }
        // Phase 4 Task 10: artifact RPC requests originate from the kernel and
        // are serviced by the manager via handleArtifactCreate/Update. Handle
        // before the result-fallthrough — these frames carry a string `id`
        // (kernel mints `art-<pid>-<seq>`) and would otherwise be miskeyed
        // against the numeric `pending` map.
        if (isArtifactCreateRequest(frame)) {
          void this.handleArtifactCreateRpc(frame);
          continue;
        }
        if (isArtifactUpdateRequest(frame)) {
          void this.handleArtifactUpdateRpc(frame);
          continue;
        }
        if (frame.type !== 'result') continue; // defensive: unknown frame shape
        const p = this.pending.get(frame.id);
        if (!p) continue;
        clearTimeout(p.totalTimer);
        clearTimeout(p.inactivityTimer);
        this.pending.delete(frame.id);
        if (this.activeId === frame.id) this.activeId = null;
        this.restartsSinceSuccess = 0; // a completed cell proves the kernel is healthy
        if (frame.ok) {
          p.resolve({ value: frame.value, stdout: frame.stdout });
        } else {
          const err = new Error(frame.error.message);
          err.name = frame.error.name;
          if (frame.error.stack) err.stack = frame.error.stack;
          p.reject(err);
        }
      }
    } catch (err) {
      this.failAllPending(err as Error);
    }
  }

  private resetInactivity(): void {
    if (this.activeId === null) return;
    const id = this.activeId;
    const p = this.pending.get(id);
    if (!p) return;
    p.inactivityWindowMs =
      this.options.inactivityAfterProgressMs ?? DEFAULT_INACTIVITY_AFTER_PROGRESS_MS;
    clearTimeout(p.inactivityTimer);
    p.inactivityTimer = setTimeout(() => this.onInactivityTimeout(id), p.inactivityWindowMs);
  }

  private onInactivityTimeout(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.totalTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.markDead();
    p.reject(new Error(`cell ${id} timed out after ${p.inactivityWindowMs}ms of inactivity`));
  }

  private onTotalTimeout(id: number, totalMs: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.inactivityTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.markDead();
    p.reject(new Error(`cell ${id} timed out after ${totalMs}ms (total wall-clock)`));
  }

  async runCell(code: string): Promise<CellResult> {
    if (this.disposed) throw new Error('runtime disposed');
    if (!this.alive) {
      if (this.restartsSinceSuccess >= MAX_RESTARTS_BEFORE_SUCCESS) {
        throw new Error(
          `kernel repeatedly crashed (${this.restartsSinceSuccess} restart(s) without a successful cell); giving up`,
        );
      }
      this.restartsSinceSuccess++;
      this.spawnChild(); // start a fresh kernel; the write below waits for its ready
    }
    const id = this.nextId++;
    const totalMs = this.options.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
    const inactivityMs = this.options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_MS;
    const result = new Promise<CellResult>((resolve, reject) => {
      const totalTimer = setTimeout(() => this.onTotalTimeout(id, totalMs), totalMs);
      const inactivityTimer = setTimeout(() => this.onInactivityTimeout(id), inactivityMs);
      this.pending.set(id, { resolve, reject, totalTimer, inactivityTimer, inactivityWindowMs: inactivityMs });
    });
    // Register the active cell synchronously so cancel()/timeouts can act on it even
    // while a restarted kernel is still starting up. Send the code once it's ready.
    this.activeId = id;
    const ready = this.ready;
    void ready
      .then(() => {
        const child = this.child;
        if (child && this.pending.has(id)) return writeNdjson(child.stdin, { id, type: 'run', code });
      })
      .catch(() => {
        // ready rejected (kernel died during startup); the exit handler/cancel rejects this cell.
      });
    return result;
  }

  async cancel(): Promise<void> {
    const child = this.child;
    if (!child || !this.alive) return;
    const id = this.activeId;
    if (!this.childReady) {
      // The kernel is still starting (e.g. a fresh restart). SIGINT would race the
      // child's SIG_IGN handler install and could kill it before it's installed, so
      // escalate straight to a hard kill and reject the active cell as cancelled.
      this.rejectActive(id, `cell ${id} cancelled`);
      this.markDead();
      return;
    }
    child.kill('SIGINT'); // child ignores SIGINT between cells; no-op for sync vm code mid-cell
    if (id === null) return; // nothing running: the gentle signal is harmless
    await new Promise((r) => setTimeout(r, this.options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS));
    const p = this.pending.get(id);
    if (!p) return; // settled within the grace window
    clearTimeout(p.totalTimer);
    clearTimeout(p.inactivityTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.markDead(); // escalate: SIGTERM -> SIGKILL
    p.reject(new Error(`cell ${id} cancelled`));
  }

  async snapshot(): Promise<SnapshotResult> {
    if (this.disposed) {
      return { id: 0, type: 'snapshot_result', ok: false, error: { name: 'RuntimeDisposed', message: 'runtime disposed' } };
    }
    if (!this.alive || !this.child) {
      return { id: 0, type: 'snapshot_result', ok: false, error: { name: 'RuntimeDead', message: 'kernel is not alive' } };
    }
    const id = this.nextId++;
    const result = new Promise<SnapshotResult>((resolve) => {
      this.pendingSnapshots.set(id, resolve);
    });
    try {
      await this.ready;
      const child = this.child;
      if (!child) {
        this.pendingSnapshots.delete(id);
        return { id, type: 'snapshot_result', ok: false, error: { name: 'RuntimeDead', message: 'kernel died before snapshot' } };
      }
      await writeNdjson(child.stdin, { id, type: 'snapshot' });
    } catch (err) {
      this.pendingSnapshots.delete(id);
      const e = err as Error;
      return { id, type: 'snapshot_result', ok: false, error: { name: e.name, message: e.message } };
    }
    return result;
  }

  /**
   * Phase 4 Task 10: service an `artifact_create` RPC request from the kernel.
   * Calls the manager-supplied handler (if any), serializes the result into a
   * `{type:'response', request:'artifact_create'}` frame, and writes it back
   * to the child's stdin. Errors are surfaced to the kernel as `ok:false`
   * frames so the awaiting cell rejects cleanly rather than hanging.
   */
  private async handleArtifactCreateRpc(req: ArtifactCreateRequest): Promise<void> {
    const child = this.child;
    if (!child) return;
    let resp: ArtifactCreateResponse;
    try {
      const handler = this.options.handleArtifactCreate;
      if (!handler) throw new Error('artifacts unavailable');
      const result = await handler({ kind: req.kind, name: req.name });
      resp = {
        type: 'response',
        request: 'artifact_create',
        id: req.id,
        ok: true,
        slug: result.slug,
        uri: result.uri,
        primary_path: result.primary_path,
      };
    } catch (err) {
      const e = err as Error;
      resp = {
        type: 'response',
        request: 'artifact_create',
        id: req.id,
        ok: false,
        error: e.message,
      };
    }
    try {
      await writeNdjson(child.stdin, resp);
    } catch {
      // child died between request and response — exit handler fails pending cells.
    }
  }

  /**
   * Phase 4 Task 10: service an `artifact_update` RPC request. Mirror of
   * handleArtifactCreateRpc for the update path.
   */
  private async handleArtifactUpdateRpc(req: ArtifactUpdateRequest): Promise<void> {
    const child = this.child;
    if (!child) return;
    let resp: ArtifactUpdateResponse;
    try {
      const handler = this.options.handleArtifactUpdate;
      if (!handler) throw new Error('artifacts unavailable');
      const result = await handler({ slug: req.slug, files: req.files });
      resp = {
        type: 'response',
        request: 'artifact_update',
        id: req.id,
        ok: true,
        files_touched: result.files_touched,
      };
    } catch (err) {
      const e = err as Error;
      resp = {
        type: 'response',
        request: 'artifact_update',
        id: req.id,
        ok: false,
        error: e.message,
      };
    }
    try {
      await writeNdjson(child.stdin, resp);
    } catch {
      // child died between request and response — exit handler fails pending cells.
    }
  }

  private rejectActive(id: number | null, message: string): void {
    if (id === null) return;
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.totalTimer);
    clearTimeout(p.inactivityTimer);
    this.pending.delete(id);
    if (this.activeId === id) this.activeId = null;
    p.reject(new Error(message));
  }

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.totalTimer);
      clearTimeout(p.inactivityTimer);
      p.reject(err);
    }
    this.pending.clear();
    this.activeId = null;
    for (const resolve of this.pendingSnapshots.values()) {
      resolve({ id: 0, type: 'snapshot_result', ok: false, error: { name: err.name, message: err.message } });
    }
    this.pendingSnapshots.clear();
  }

  private markDead(): void {
    const child = this.child;
    if (!child) return;
    this.alive = false;
    this.childReady = false;
    child.kill('SIGTERM');
    child.kill('SIGKILL');
    // child stays referenced until its 'exit' fires; identity guards in readLoop/exit
    // ignore the dead child once a restart reassigns this.child.
  }

  get hasActiveCell(): boolean {
    return this.activeId !== null;
  }

  get recoveryNotes(): readonly RecoveryNote[] {
    return this.recoveryNotes_;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    this.childReady = false;
    this.failAllPending(new Error('runtime disposed'));
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
  }
}
