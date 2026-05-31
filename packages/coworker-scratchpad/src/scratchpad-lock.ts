import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { hostname } from 'node:os';
import process from 'node:process';

export interface LockInfo {
  pid: number;
  host: string;
  acquired_at: string;
  takeover_from?: { pid: number; host: string; reason: string };
}

export interface AcquireOptions {
  forceTakeover?: boolean;
  takeoverReason?: string;
  now?: () => number;
}

export class ScratchpadBusyError extends Error {
  readonly scratchpadName: string;
  readonly holder: LockInfo;
  constructor(scratchpadName: string, holder: LockInfo) {
    super(`scratchpad ${scratchpadName} is busy in another session`);
    this.name = 'ScratchpadBusyError';
    this.scratchpadName = scratchpadName;
    this.holder = holder;
  }
}

function lockPath(dir: string): string {
  return join(dir, 'lock.json');
}

export function readLock(dir: string): LockInfo | null {
  const path = lockPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null; // corrupt lock is treated as absent (clearable on acquire)
  }
}

function holderIsAlive(holder: LockInfo): boolean {
  if (holder.host !== hostname()) return true; // can't verify a remote PID -> assume alive
  try {
    process.kill(holder.pid, 0);
    return true; // exists and signalable
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'; // ESRCH = no such process (dead); EPERM etc. = alive
  }
}

export function isStaleLock(holder: LockInfo): boolean {
  return !holderIsAlive(holder);
}

export function acquireLock(dir: string, options: AcquireOptions = {}): LockInfo {
  const now = options.now ?? Date.now;
  mkdirSync(dir, { recursive: true });
  const path = lockPath(dir);
  const self: LockInfo = { pid: process.pid, host: hostname(), acquired_at: new Date(now()).toISOString() };

  try {
    writeFileSync(path, JSON.stringify(self), { flag: 'wx' });
    return self; // won the atomic create
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  const holder = readLock(dir);
  if (holder === null || !holderIsAlive(holder)) {
    // corrupt or stale -> clear and retake
    unlinkSync(path);
    writeFileSync(path, JSON.stringify(self), { flag: 'wx' });
    return self;
  }

  if (options.forceTakeover) {
    const taken: LockInfo = {
      ...self,
      takeover_from: { pid: holder.pid, host: holder.host, reason: options.takeoverReason ?? 'force-takeover' },
    };
    writeFileSync(path, JSON.stringify(taken)); // overwrite the live holder
    return taken;
  }

  throw new ScratchpadBusyError(basename(dir), holder);
}

export function releaseLock(dir: string): void {
  const holder = readLock(dir);
  if (holder === null) return;
  if (holder.pid === process.pid && holder.host === hostname()) {
    try {
      unlinkSync(lockPath(dir));
    } catch {
      // already gone
    }
  }
  // not ours (e.g. taken over) -> leave it
}
