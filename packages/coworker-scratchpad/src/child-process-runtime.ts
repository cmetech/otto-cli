import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';
import { isDataLoadEvent, isProgressEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame } from './kernel-protocol.js';

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
  private activeId: number | null = null;
  private nextId = 1;
  private alive = false;
  private childReady = false;
  private disposed = false;
  private restartsSinceSuccess = 0;
  private resolveReady: () => void = () => {};
  private rejectReady: (err: Error) => void = () => {};
  private ready: Promise<void> = Promise.resolve();

  constructor(private readonly options: ChildProcessRuntimeOptions) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('runtime disposed');
    await this.spawnChild();
  }

  private spawnChild(): Promise<void> {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const entry = this.options.entryPath ?? resolveKernelEntry();
    const child = spawn(
      process.execPath,
      [...kernelExecArgv(), entry, this.options.workspace],
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
    ) as unknown as ChildProcessWithoutNullStreams;
    this.child = child;
    this.alive = true;
    this.childReady = false;
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
            this.childReady = true;
            this.resolveReady();
          }
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          else if (isProgressEvent(frame)) this.resetInactivity();
          continue;
        }
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
