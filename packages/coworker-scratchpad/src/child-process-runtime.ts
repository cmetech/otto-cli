import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';
import { isDataLoadEvent } from './kernel-protocol.js';
import type { DataLoadDrawer, KernelFrame } from './kernel-protocol.js';

export interface CellResult {
  value: unknown;
  stdout: string;
}

export interface ChildProcessRuntimeOptions {
  workspace: string;
  onDataLoad?: (drawer: DataLoadDrawer) => void;
  cellTimeoutMs?: number;
  entryPath?: string;
}

interface Pending {
  resolve: (result: CellResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_CELL_TIMEOUT_MS = 30_000;

export class ChildProcessRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private readonly ready: Promise<void>;

  constructor(private readonly options: ChildProcessRuntimeOptions) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  async start(): Promise<void> {
    const entry = this.options.entryPath ?? resolveKernelEntry();
    const child = spawn(
      process.execPath,
      [...kernelExecArgv(), entry, this.options.workspace],
      { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: filterEnv(process.env) },
    ) as unknown as ChildProcessWithoutNullStreams;
    this.child = child;
    child.on('exit', (code, signal) => {
      const err = new Error(`kernel exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      this.rejectReady(err); // no-op if already resolved
      this.failAllPending(err);
    });
    void this.readLoop(child);
    await this.ready;
  }

  private async readLoop(child: ChildProcessWithoutNullStreams): Promise<void> {
    try {
      for await (const raw of readNdjson(child.stdout)) {
        const frame = raw as KernelFrame;
        if (frame.type === 'event') {
          if (frame.event === 'ready') this.resolveReady();
          else if (isDataLoadEvent(frame)) this.options.onDataLoad?.(frame.drawer);
          continue;
        }
        const p = this.pending.get(frame.id);
        if (!p) continue;
        clearTimeout(p.timer);
        this.pending.delete(frame.id);
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

  async runCell(code: string): Promise<CellResult> {
    if (this.disposed) throw new Error('runtime disposed');
    const child = this.child;
    if (!child) throw new Error('kernel not started');
    const id = this.nextId++;
    const timeoutMs = this.options.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
    const result = new Promise<CellResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill();
        reject(new Error(`cell ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    await writeNdjson(child.stdin, { id, type: 'run', code });
    return result;
  }

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private kill(): void {
    this.disposed = true;
    this.child?.kill('SIGKILL');
    this.child = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.failAllPending(new Error('runtime disposed'));
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
  }
}
